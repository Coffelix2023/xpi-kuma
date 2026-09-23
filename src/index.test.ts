import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BeforeProviderRequestEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  MessageUpdateEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import Sqlite from "better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readConfigTemplate, resolveConfigPath } from "./config.ts";
import {
  clearServiceState,
  readServiceState,
  serviceStatePath,
} from "./service/state.ts";
import { Database, defaultDatabasePath } from "./storage/database.ts";
import type { AttributionDimension } from "./types.ts";

/** 从源码里取 `VERSION` 常量，用来和 package.json 对表。 */
const VERSION_PATTERN = /const VERSION = "([^"]+)"/;

/** 版本号形状；发布号必须是 `X.Y.Z`。 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** 面板 URL 形状：`http://127.0.0.1:<端口>/#<凭据>`。 */
const DASHBOARD_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d+\/#/;

/**
 * 记录浏览器打开请求。
 *
 * 测试里一律让打开失败，这样既不会真的弹出浏览器，又可以从 Pi 通知里拿到
 * 本机 URL —— 这条降级路径本身就是 spec 要求的行为。
 */
const openBrowser = vi.fn();

vi.mock("./lib/open-browser.ts", () => ({
  openInBrowser: (url: string) => openBrowser(url),
}));

const cleanups: (() => void)[] = [];
let extensionFactory: (pi: ExtensionAPI) => void;

/** 记录注册结果的假 ExtensionAPI。 */
function fakePi() {
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const commands = new Map<
    string,
    {
      description?: string;
      handler: (args: string, ctx: ExtensionContext) => Promise<void>;
    }
  >();
  const api = {
    on: (event: string, handler: never) => handlers.set(event, handler),
    registerCommand: (name: string, options: never) => commands.set(name, options),
  } as unknown as ExtensionAPI;
  return {
    api,
    commands,
    handlers,
  };
}

function fakeCtx(cwd: string) {
  const notify = vi.fn();
  return {
    ctx: {
      cwd,
      ui: {
        notify,
      },
    } as unknown as ExtensionContext,
    notify,
  };
}

/** 建一个带有效配置的临时项目根。 */
function setupCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-index-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  // 配置只从全局目录读：临时项目目录同时充当 agent 目录
  process.env.PI_CODING_AGENT_DIR = dir;
  const configPath = resolveConfigPath();
  mkdirSync(dirname(configPath), {
    recursive: true,
  });
  writeFileSync(configPath, readConfigTemplate());
  return dir;
}

async function sessionStart(
  handlers: ReturnType<typeof fakePi>["handlers"],
  ctx: ExtensionContext,
  reason = "startup",
): Promise<void> {
  await handlers.get("session_start")?.(
    {
      reason,
      type: "session_start",
    } as unknown as SessionStartEvent,
    ctx,
  );
}

async function sessionShutdown(
  handlers: ReturnType<typeof fakePi>["handlers"],
  ctx: ExtensionContext,
  reason = "quit",
): Promise<void> {
  await handlers.get("session_shutdown")?.(
    {
      reason,
      type: "session_shutdown",
    } as unknown as SessionShutdownEvent,
    ctx,
  );
}

async function runCommand(
  commands: ReturnType<typeof fakePi>["commands"],
  ctx: ExtensionContext,
  args = "",
): Promise<void> {
  const handler = commands.get("xpi-kuma")?.handler;
  if (!handler) {
    throw new Error("/xpi-kuma 命令未注册");
  }
  await handler(args, ctx);
}

function messageEnd(
  handlers: ReturnType<typeof fakePi>["handlers"],
  usage: unknown,
  ctx: ExtensionContext,
  content: unknown[] = [],
  stopReason = "stop",
) {
  handlers.get("message_end")?.(
    {
      type: "message_end",
      message: {
        content,
        model: "gpt-4o-mini",
        provider: "openai",
        role: "assistant",
        stopReason,
        usage,
      },
    } as unknown as MessageEndEvent,
    ctx,
  );
}

/**
 * 直接读扩展写出的那个 usage.db，按维度取出分组键。
 *
 * 归因数据只落库，因此断言必须查库；测试之间的记录会累积，
 * 所以一律用 `toContain` 而不是全等。
 */
function readAttributionKeys(dimension: AttributionDimension): string[] {
  const db = new Database({
    dbPath: defaultDatabasePath(),
  });
  try {
    return db.getAttribution("24h", dimension).map((row) => row.key);
  } finally {
    db.close();
  }
}

/** 读回 usage.db 里工具调用次数的合计；测试间的记录会累积，断言只看增量。 */
function readToolCalls(): number {
  const db = new Database({
    dbPath: defaultDatabasePath(),
  });
  try {
    return db.getUsageStats("24h").reduce((sum, row) => sum + row.toolCalls, 0);
  } finally {
    db.close();
  }
}

/** usage.db 当前的使用量总条数（跨时间范围求和）。 */
function readUsageCount(): number {
  const db = new Database({
    dbPath: defaultDatabasePath(),
  });
  try {
    return db.getUsageStats("30d").reduce((sum, row) => sum + row.requestCount, 0);
  } finally {
    db.close();
  }
}

/** 读最新一条使用量记录的四个时间/状态列，用于 NULL 语义断言。 */
function readLatestTiming(): {
  completed_at: number | null;
  first_token_at: number | null;
  result_status: string | null;
  started_at: number | null;
} {
  const db = new Sqlite(defaultDatabasePath(), {
    readonly: true,
  });
  try {
    const row = db
      .prepare(
        "SELECT started_at, first_token_at, completed_at, result_status FROM usage_records ORDER BY id DESC LIMIT 1",
      )
      .get() as
      | {
          completed_at: number | null;
          first_token_at: number | null;
          result_status: string | null;
          started_at: number | null;
        }
      | undefined;
    return (
      row ?? {
        completed_at: null,
        first_token_at: null,
        result_status: null,
        started_at: null,
      }
    );
  } finally {
    db.close();
  }
}

describe("真实时间点采集", () => {
  const usage = {
    cacheRead: 10,
    cacheWrite: 5,
    input: 100,
    output: 50,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0.001,
      output: 0.002,
      total: 0.003,
    },
  };

  it("事件链完整：开始/首字/完成时间与结果状态入库", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    handlers.get("before_provider_request")?.(
      {
        payload: {},
        type: "before_provider_request",
      } as unknown as BeforeProviderRequestEvent,
      ctx,
    );
    handlers.get("message_update")?.(
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
        },
        message: {
          role: "assistant",
        },
      } as unknown as MessageUpdateEvent,
      ctx,
    );
    messageEnd(handlers, usage, ctx);

    const timing = readLatestTiming();
    expect(timing.started_at).toEqual(expect.any(Number));
    expect(timing.first_token_at).toEqual(expect.any(Number));
    expect(timing.completed_at).toEqual(expect.any(Number));
    expect(timing.result_status).toBe("stop");
  });

  it("缺失时间点：只收到 message_end 时开始/首字为 NULL，完成与状态照常", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    messageEnd(handlers, usage, ctx);

    const timing = readLatestTiming();
    expect(timing.started_at).toBeNull();
    expect(timing.first_token_at).toBeNull();
    expect(timing.completed_at).toEqual(expect.any(Number));
    expect(timing.result_status).toBe("stop");
  });

  it("非 assistant 消息不写记录，也不消费在途时间点", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);
    const before = readUsageCount();

    handlers.get("before_provider_request")?.(
      {
        payload: {},
        type: "before_provider_request",
      } as unknown as BeforeProviderRequestEvent,
      ctx,
    );
    handlers.get("message_end")?.(
      {
        type: "message_end",
        message: {
          content: "hi",
          role: "user",
        },
      } as unknown as MessageEndEvent,
      ctx,
    );
    expect(readUsageCount()).toBe(before);

    messageEnd(handlers, usage, ctx);
    expect(readUsageCount()).toBe(before + 1);
    // 在途时间点未被非 assistant 消息消费
    expect(readLatestTiming().started_at).toEqual(expect.any(Number));
  });
});

describe("消息时间与对账指纹", () => {
  const usage = {
    cacheRead: 10,
    cacheWrite: 5,
    input: 100,
    output: 50,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0.001,
      output: 0.002,
      total: 0.003,
    },
  };

  function messageEndAt(
    handlers: ReturnType<typeof fakePi>["handlers"],
    ctx: ExtensionContext,
    messageTimestamp: number,
  ): void {
    handlers.get("message_end")?.(
      {
        type: "message_end",
        message: {
          content: [],
          model: "gpt-4o-mini",
          provider: "openai",
          role: "assistant",
          stopReason: "stop",
          timestamp: messageTimestamp,
          usage,
        },
      } as unknown as MessageEndEvent,
      ctx,
    );
  }

  function readIdentity(): {
    completed_at: number | null;
    message_at: number | null;
    reconcile_fingerprint: string | null;
  }[] {
    const db = new Sqlite(defaultDatabasePath(), {
      readonly: true,
    });
    try {
      // 测试间的记录会累积：只取本用例写入的尾部两行
      return db
        .prepare(
          "SELECT message_at, reconcile_fingerprint, completed_at FROM usage_records ORDER BY id DESC LIMIT 2",
        )
        .all() as {
        completed_at: number | null;
        message_at: number | null;
        reconcile_fingerprint: string | null;
      }[];
    } finally {
      db.close();
    }
  }

  it("两次相同 token 但不同消息分别入账：消息时间与完成时间正确区分", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    messageEndAt(handlers, ctx, 1_727_000_000);
    messageEndAt(handlers, ctx, 1_727_000_050);

    const rows = readIdentity();
    expect(rows).toHaveLength(2);
    // 消息时间来自 message.timestamp，完成时间来自 message_end 到达观测：不同且都有效
    expect(rows[0]?.message_at).toBe(1_727_000_050);
    expect(rows[1]?.message_at).toBe(1_727_000_000);
    for (const row of rows) {
      expect(row.completed_at).toEqual(expect.any(Number));
      expect(row.completed_at).not.toBe(row.message_at);
    }
    // 相同 token、不同消息 → 指纹不同（未来日志对账可精确匹配）
    expect(rows[0]?.reconcile_fingerprint).not.toBe(rows[1]?.reconcile_fingerprint);
  });
});

describe("off 与用量采集解耦", () => {
  it("off 只关网页与探测：off 后 message_end 仍写入数据库", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);
    await runCommand(commands, ctx, "off");
    const before = readUsageCount();

    messageEnd(
      handlers,
      {
        input: 7,
        output: 3,
        cost: {
          total: 0.1,
        },
      },
      ctx,
    );

    expect(readUsageCount()).toBe(before + 1);
  });
});

describe("session_start 日志补录", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  /** 在测试 agent 目录下写一份会话日志（扩展的扫描器按 getAgentDir()/sessions 找） */
  function writeSessionLog(
    agentDir: string,
    sessionId: string,
    cwd: string,
    entries: {
      entryId: string;
      messageAt: number;
    }[],
  ): void {
    const projectDir = join(agentDir, "sessions", "--proj--");
    mkdirSync(projectDir, {
      recursive: true,
    });
    const lines = [
      JSON.stringify({
        cwd,
        id: sessionId,
        timestamp: new Date().toISOString(),
        type: "session",
      }),
      ...entries.map((entry) =>
        JSON.stringify({
          id: entry.entryId,
          parentId: null,
          timestamp: new Date(entry.messageAt).toISOString(),
          type: "message",
          message: {
            content: [],
            model: "gpt-4o-mini",
            provider: "openai",
            role: "assistant",
            stopReason: "stop",
            timestamp: entry.messageAt,
            usage: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 30,
              output: 20,
              cost: {
                cacheRead: 0,
                cacheWrite: 0,
                input: 0.001,
                output: 0.002,
                total: 0.003,
              },
            },
          },
        }),
      ),
    ];
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
  }

  it("历史缺口补齐：会话启动即补入保留期内的日志用量，且延迟字段保持未知", async () => {
    const dir = setupCwd();
    writeSessionLog(dir, "sess-bf", dir, [
      {
        entryId: "bfaa0001",
        messageAt: now - 3_600_000,
      },
    ]);
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(dir);
    const before = readUsageCount();

    await sessionStart(handlers, ctx);

    expect(readUsageCount()).toBe(before + 1);
    expect(readAttributionKeys("project")).toContain(dir);
    // 补录行不推断延迟
    const timing = readLatestTiming();
    expect(timing.started_at).toBeNull();
    expect(timing.completed_at).toBeNull();
    expect(timing.result_status).toBe("stop");
  });

  it("超期日志不回插：补录不与保留期清理打架，重跑也不反复插入", async () => {
    const dir = setupCwd();
    writeSessionLog(dir, "sess-old", dir, [
      {
        entryId: "olda0001",
        messageAt: now - 30 * DAY_MS,
      },
    ]);
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(dir);
    await sessionStart(handlers, ctx);
    const afterFirst = readUsageCount();

    // 第二次会话启动（新会话）：不把超期条目反复插进来
    await sessionStart(handlers, ctx, "new");

    expect(readUsageCount()).toBe(afterFirst);
  });
});
/** 每次新建连接，避免连接池掩盖端口是否真的释放。 */
function rawStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  const parsed = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const req = request(
      {
        agent: false,
        headers,
        host: parsed.hostname,
        method: "GET",
        path: `${parsed.pathname}${parsed.search}`,
        port: parsed.port,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** 发一次可带请求体的请求，拿回状态码与响应体：写接口与热重载断言都要看响应内容。 */
function rawCall(
  url: string,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<{
  body: string;
  status: number;
}> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        agent: false,
        headers: options.headers,
        host: parsed.hostname,
        method: options.method ?? "GET",
        path: `${parsed.pathname}${parsed.search}`,
        port: parsed.port,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: res.statusCode ?? 0,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

function lastUrl(): string {
  return String(openBrowser.mock.calls.at(-1)?.[0] ?? "");
}

/** 自选当前空闲端口：本机默认 5180 常被常驻面板占用，回退随机端口会让同端口复用断言失真。 */
function freePort(): Promise<number> {
  const probe = createServer();
  return new Promise<number>((resolve) => {
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  // Database 与 logger 都从 agent dir 取路径，测试必须隔离到临时目录
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "xpi-kuma-agentdir-"));
  const mod = await import("./index.ts");
  extensionFactory = mod.default;
});

beforeEach(() => {
  openBrowser.mockClear();
  openBrowser.mockImplementation(() =>
    Promise.reject(new Error("测试环境不打开浏览器")),
  );
});

/**
 * 服务现在跨会话常驻：测试之间必须显式 `off`，否则监听端口与数据库连接会串到下个用例。
 */
afterEach(async () => {
  const { api, commands } = fakePi();
  extensionFactory(api);
  const { ctx } = fakeCtx(tmpdir());
  await runCommand(commands, ctx, "off");
});

afterAll(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("扩展注册", () => {
  it("注册四个事件监听器与 /xpi-kuma 命令", () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);

    expect(
      [
        ...handlers.keys(),
      ].sort(),
    ).toEqual([
      "before_provider_request",
      "message_end",
      "message_update",
      "session_start",
    ]);
    expect(commands.has("xpi-kuma")).toBe(true);
    expect(commands.get("xpi-kuma")?.description).toBe(
      "打开监控面板（on / off 开关，缺省等同 on）",
    );
  });

  it("VERSION 常量与 package.json 的 version 保持一致", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf8",
    );
    const declared = VERSION_PATTERN.exec(source)?.[1];
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as {
      version: string;
    };

    expect(declared).toBe(manifest.version);
    expect(manifest.version).toMatch(SEMVER_PATTERN);
  });
});

describe("会话生命周期", () => {
  it("message_end 按 content 里的 toolCall 条数记录工具调用次数", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    const usage = {
      cacheRead: 10,
      cacheWrite: 5,
      input: 100,
      output: 50,
      cost: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0.001,
        output: 0.002,
        total: 0.003,
      },
    };
    const before = readToolCalls();

    messageEnd(handlers, usage, ctx, [
      {
        type: "toolCall",
      },
      {
        type: "toolCall",
      },
    ]);
    expect(readToolCalls()).toBe(before + 2);

    // 纯文本消息不增加工具调用次数
    messageEnd(handlers, usage, ctx, [
      {
        text: "hi",
        type: "text",
      },
    ]);
    expect(readToolCalls()).toBe(before + 2);

    await sessionShutdown(handlers, ctx);
  });

  it("忽略非 assistant 消息与缺少 usage 的 assistant 消息", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    handlers.get("message_end")?.(
      {
        type: "message_end",
        message: {
          content: "hi",
          role: "user",
        },
      } as unknown as MessageEndEvent,
      ctx,
    );
    messageEnd(handlers, undefined, ctx);

    await sessionShutdown(handlers, ctx);
  });

  it("message_end 记录项目路径与会话标识", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const cwd = setupCwd();
    const { ctx } = fakeCtx(cwd);
    await sessionStart(handlers, ctx);

    const withSession = {
      cwd,
      ui: ctx.ui,
      sessionManager: {
        getSessionId: () => "sess-1",
      },
    } as unknown as ExtensionContext;
    messageEnd(
      handlers,
      {
        input: 10,
        output: 5,
        cost: {
          total: 0.5,
        },
      },
      withSession,
    );
    await sessionShutdown(handlers, ctx);

    expect(readAttributionKeys("project")).toContain(cwd);
    expect(readAttributionKeys("session")).toContain("sess-1");
  });

  it("归因元数据取值抛错时仍写入记录，只是归入未知", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    const broken = {
      ui: ctx.ui,
      get cwd() {
        throw new Error("no cwd");
      },
      sessionManager: {
        getSessionId: () => {
          throw new Error("no session");
        },
      },
    } as unknown as ExtensionContext;
    messageEnd(
      handlers,
      {
        input: 1,
        output: 1,
        cost: {
          total: 0.25,
        },
      },
      broken,
    );
    await sessionShutdown(handlers, ctx);

    // 记录仍然写入，只是两个维度都落进「未知」分组
    expect(readAttributionKeys("project")).toContain("");
    expect(readAttributionKeys("session")).toContain("");
  });

  it("配置无法创建时提示用户而不抛错", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-index-"));
    cleanups.push(() =>
      rmSync(dir, {
        force: true,
        recursive: true,
      }),
    );
    // 把 agent 目录指到一个普通文件：loadConfig 既不能建目录也不能写模板
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    process.env.PI_CODING_AGENT_DIR = blocker;
    const { ctx, notify } = fakeCtx(blocker);

    await expect(sessionStart(handlers, ctx)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalled();
  });
});

describe("监控面板服务", () => {
  it("执行命令启动本机服务并打开浏览器", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    await runCommand(commands, ctx);

    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(lastUrl()).toMatch(DASHBOARD_URL_PATTERN);
    await sessionShutdown(handlers, ctx);
  });

  it("重复执行命令复用同一服务与凭据，不创建重复监听器", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    await runCommand(commands, ctx);
    const first = lastUrl();
    await runCommand(commands, ctx);

    expect(openBrowser).toHaveBeenCalledTimes(2);
    expect(lastUrl()).toBe(first);
    await sessionShutdown(handlers, ctx);
  });

  it("浏览器成功打开后提示重开方式，且通知不含 URL 与凭据", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, notify } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    openBrowser.mockResolvedValueOnce(undefined);
    await runCommand(commands, ctx);

    const url = lastUrl();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("再次运行 /xpi-kuma"),
      "info",
    );
    const text = String(notify.mock.calls.at(-1)?.[0] ?? "");
    expect(text).not.toContain("http");
    expect(text).not.toContain(new URL(url).hash.slice(1));
    await sessionShutdown(handlers, ctx);
  });

  it("浏览器无法打开时通过通知给出可复制的本机 URL", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, notify } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    await runCommand(commands, ctx);

    const url = lastUrl();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining(url), "warning");
    await sessionShutdown(handlers, ctx);
  });

  it("会话未初始化时命令也能启动服务", async () => {
    const { api, commands } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());

    await runCommand(commands, ctx, "on");

    expect(openBrowser).toHaveBeenCalledTimes(1);
  });

  it("目标端口被占用时回退随机端口并提示实际端口", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const dir = setupCwd();
    // 占住一个端口，再把它写进配置当目标端口
    const probe = createServer();
    await new Promise<void>((resolve) => {
      probe.listen(0, "127.0.0.1", resolve);
    });
    const address = probe.address();
    const busy = typeof address === "object" && address !== null ? address.port : 0;
    writeFileSync(resolveConfigPath(), `dashboard:\n  port: ${busy}\nvendors: []\n`);
    const { ctx, notify } = fakeCtx(dir);
    await sessionStart(handlers, ctx);

    try {
      await runCommand(commands, ctx);

      const fallback = notify.mock.calls
        .map((call) => String(call[0]))
        .find((text) => text.includes("已被占用"));
      expect(fallback).toBeDefined();
      expect(fallback).toContain(String(busy));
      expect(lastUrl()).toMatch(DASHBOARD_URL_PATTERN);
      expect(new URL(lastUrl()).port).not.toBe(String(busy));
    } finally {
      await new Promise<void>((resolve) => {
        probe.close(() => resolve());
      });
      await sessionShutdown(handlers, ctx);
    }
  });

  it("无配置供应商时仍启动服务并提示配置路径", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const dir = setupCwd();
    const configPath = resolveConfigPath();
    writeFileSync(configPath, "vendors: []\nretention:\n  raw_records: 7\n");
    const { ctx, notify } = fakeCtx(dir);
    await sessionStart(handlers, ctx);

    await runCommand(commands, ctx);

    expect(notify).toHaveBeenCalledWith(
      "未配置任何供应商，请编辑 ~/.pi/agent/data/xpi-kuma/config.yaml",
      "warning",
    );
    expect(openBrowser).toHaveBeenCalledTimes(1);
    await sessionShutdown(handlers, ctx);
  });

  it("保存供应商后热重载：接口立刻返回新模型，定时器数与模型数一致", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const dir = setupCwd();
    const configPath = resolveConfigPath();
    // 两个模型：定时器数必须是 2 而不是「供应商数 1」
    writeFileSync(
      configPath,
      [
        "vendors:",
        '  - name: "Only"',
        '    endpoint: "http://127.0.0.1:1/v1"',
        '    models: ["m1", "m2"]',
      ].join("\n"),
    );
    const { ctx } = fakeCtx(dir);
    await sessionStart(handlers, ctx);
    await runCommand(commands, ctx);

    const origin = new URL(lastUrl()).origin;
    const token = new URL(lastUrl()).hash.slice(1);
    const before = await rawCall(`${origin}/api/dashboard`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(before.status).toBe(200);
    const saved = await rawCall(`${origin}/api/vendors/save`, {
      body: JSON.stringify({
        endpoint: "http://127.0.0.1:1/v1",
        name: "Only",
        probeInterval: "5m",
        probeTimeout: 1000,
        models: [
          "m1",
          "m2",
          "m3",
        ],
      }),
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin,
      },
    });
    expect(saved.status).toBe(200);

    const after = await rawCall(`${origin}/api/dashboard`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(after.status).toBe(200);
    const models = (
      JSON.parse(after.body) as {
        vendors: {
          model: string;
        }[];
      }
    ).vendors.map((v) => v.model);
    // 新增的 m3 立刻可见，无需重启面板
    expect(models).toContain("m3");
    await sessionShutdown(handlers, ctx);
  });
});

describe("常驻与 on/off 开关", () => {
  it("session_shutdown 不释放端口，服务与凭据都还在", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);
    await runCommand(commands, ctx);
    const url = lastUrl();

    await sessionShutdown(handlers, ctx, "quit");

    expect(
      await rawStatus(`${new URL(url).origin}/api/dashboard`, {
        authorization: `Bearer ${new URL(url).hash.slice(1)}`,
      }),
    ).toBe(200);
  });

  it("off 释放端口，on 重新启动并复用同一凭据", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    // 本机默认端口可能被常驻面板占用而回退随机端口：写入自选空闲端口，让断言聚焦复用语义
    writeFileSync(
      resolveConfigPath(),
      `dashboard:\n  port: ${await freePort()}\nvendors: []\n`,
    );
    await sessionStart(handlers, ctx);
    await runCommand(commands, ctx);
    const first = lastUrl();

    await runCommand(commands, ctx, "off");
    await expect(rawStatus(first)).rejects.toThrow();

    await runCommand(commands, ctx, "on");

    expect(lastUrl()).toBe(first);
  });

  it("未知参数只提示，不启动服务", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, notify } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    await runCommand(commands, ctx, "wat");

    expect(openBrowser).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("未知参数"), "warning");
  });
});

describe("独立服务所有权协调", () => {
  const daemonState = {
    owner: "daemon",
    pid: process.pid,
    port: 5199,
    ready: true,
    startedAt: new Date().toISOString(),
    url: "http://127.0.0.1:5199/#tok",
    version: 1,
  };

  it("独立服务先启动：/xpi-kuma 复用其 URL，不启动第二个监听器", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, notify } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    writeFileSync(serviceStatePath(), JSON.stringify(daemonState));
    openBrowser.mockClear();
    await runCommand(commands, ctx, "on");

    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:5199/#tok");
    // openBrowser 默认失败：降级通知给出可复制的独立服务 URL（与 Pi 自有服务同款行为）
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:5199/#tok"),
      "warning",
    );
    expect(readServiceState()?.owner).toBe("daemon");
    clearServiceState();
  });

  // biome-ignore lint/security/noSecrets: 中文高熵误报，测试名不含任何凭据
  it("独立服务运行期间会话启动：Pi 不重复探测，实时采集照常", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());

    writeFileSync(serviceStatePath(), JSON.stringify(daemonState));
    await sessionStart(handlers, ctx);

    messageEnd(
      handlers,
      {
        cacheRead: 0,
        cacheWrite: 0,
        input: 10,
        output: 5,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0.01,
          output: 0.02,
          total: 0.03,
        },
      },
      ctx,
    );
    // 关键：服务由 daemon 持有，但 message_end 仍实时入账（spec：usage-collection）
    expect(readUsageCount()).toBeGreaterThanOrEqual(1);
    clearServiceState();
  });

  it("Pi off 释放所有权登记，独立 CLI 之后可接管", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);
    await runCommand(commands, ctx, "on");

    const piState = readServiceState();
    expect(piState?.owner).toBe("pi");
    expect(piState?.pid).toBe(process.pid);

    await runCommand(commands, ctx, "off");
    expect(readServiceState()).toBeNull();
  });
});
