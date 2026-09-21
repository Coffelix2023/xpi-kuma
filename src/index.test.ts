import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
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
  const setStatus = vi.fn();
  const notify = vi.fn();
  return {
    ctx: {
      cwd,
      ui: {
        notify,
        setStatus,
      },
    } as unknown as ExtensionContext,
    notify,
    setStatus,
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
) {
  handlers.get("message_end")?.(
    {
      type: "message_end",
      message: {
        content,
        model: "gpt-4o-mini",
        provider: "openai",
        role: "assistant",
        usage,
      },
    } as unknown as MessageEndEvent,
    ctx,
  );
}

/**
 * 直接读扩展写出的那个 usage.db，按维度取出分组键。
 *
 * 归因数据只落库、不经过 footer，因此断言必须查库；测试之间的记录会累积，
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

/** 事件内容对被测逻辑无关，只需要触发 footer 刷新。 */
function turnEndEvent(): TurnEndEvent {
  return {
    message: {},
    toolResults: [],
    turnIndex: 1,
    type: "turn_end",
  } as unknown as TurnEndEvent;
}

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

function lastUrl(): string {
  return String(openBrowser.mock.calls.at(-1)?.[0] ?? "");
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
      "message_end",
      "session_shutdown",
      "session_start",
      "turn_end",
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
  it("session_start 后 footer 显示零值统计", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, setStatus } = fakeCtx(setupCwd());

    await sessionStart(handlers, ctx);

    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", "💰 ¥0.00 | 📊 0");
    await sessionShutdown(handlers, ctx);
  });

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

  it("message_end 累加会话统计并写入数据库", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    messageEnd(
      handlers,
      {
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
      },
      ctx,
    );

    const { ctx: turnCtx, setStatus } = fakeCtx(setupCwd());
    handlers.get("turn_end")?.(turnEndEvent(), turnCtx);
    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", "💰 ¥0.00 | 📊 165");
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

    const { ctx: turnCtx, setStatus } = fakeCtx(setupCwd());
    handlers.get("turn_end")?.(turnEndEvent(), turnCtx);
    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", "💰 ¥0.00 | 📊 0");
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

  it("session_shutdown 清除 footer 状态", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, setStatus } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);
    setStatus.mockClear();

    await sessionShutdown(handlers, ctx, "quit");

    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", undefined);
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

describe("统计累加语义", () => {
  it("同一 turn 内多条 assistant 消息都会累加", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);

    const usage = {
      cacheRead: 0,
      cacheWrite: 0,
      input: 10,
      output: 5,
      cost: {
        total: 0.01,
      },
    };
    messageEnd(handlers, usage, ctx);
    messageEnd(handlers, usage, ctx);

    const { ctx: turnCtx, setStatus } = fakeCtx(setupCwd());
    handlers.get("turn_end")?.(turnEndEvent(), turnCtx);
    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", "💰 ¥0.02 | 📊 30");
    await sessionShutdown(handlers, ctx);
  });

  it("重新 session_start 重置累加器", async () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    await sessionStart(handlers, ctx);
    messageEnd(
      handlers,
      {
        input: 1000,
        output: 0,
        cost: {
          total: 1,
        },
      },
      ctx,
    );

    const { ctx: newSessionCtx, setStatus } = fakeCtx(setupCwd());
    await sessionStart(handlers, newSessionCtx, "new");

    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", "💰 ¥0.00 | 📊 0");
    await sessionShutdown(handlers, newSessionCtx);
  });
});
