import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfigTemplate, resolveConfigPath } from "./config.ts";
import { Database, defaultDatabasePath } from "./storage/database.ts";
import type { AttributionDimension } from "./types.ts";

/** 从源码里取 `VERSION` 常量，用来和 package.json 对表。 */
const VERSION_PATTERN = /const VERSION = "([^"]+)"/;

/** 版本号形状；发布号必须是 `X.Y.Z`。 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

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
  const configPath = resolveConfigPath(dir);
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
): Promise<void> {
  const handler = commands.get("xpi-kuma")?.handler;
  if (!handler) {
    throw new Error("/xpi-kuma 命令未注册");
  }
  await handler("", ctx);
}

function messageEnd(
  handlers: ReturnType<typeof fakePi>["handlers"],
  usage: unknown,
  ctx: ExtensionContext,
) {
  handlers.get("message_end")?.(
    {
      type: "message_end",
      message: {
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
    expect(commands.get("xpi-kuma")?.description).toBe("打开或重新打开监控面板");
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
    const dir = setupCwd();
    // 把 cwd 指向一个普通文件：loadConfig 既不能建目录也不能读文件
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
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
    expect(lastUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#/);
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

  it("会话未初始化时只提示，不启动服务", async () => {
    const { api, commands } = fakePi();
    extensionFactory(api);
    const { ctx, notify } = fakeCtx(setupCwd());

    await runCommand(commands, ctx);

    expect(openBrowser).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("会话尚未初始化"),
      "warning",
    );
  });

  it("无配置供应商时仍启动服务并提示配置路径", async () => {
    const { api, commands, handlers } = fakePi();
    extensionFactory(api);
    const dir = setupCwd();
    const configPath = resolveConfigPath(dir);
    writeFileSync(configPath, "vendors: []\nretention:\n  raw_records: 7\n");
    const { ctx, notify } = fakeCtx(dir);
    await sessionStart(handlers, ctx);

    await runCommand(commands, ctx);

    expect(notify).toHaveBeenCalledWith(
      "未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml",
      "warning",
    );
    expect(openBrowser).toHaveBeenCalledTimes(1);
    await sessionShutdown(handlers, ctx);
  });
});

describe("会话切换释放服务", () => {
  const reasons = [
    "quit",
    "reload",
    "new",
    "resume",
    "fork",
  ] as const;

  for (const reason of reasons) {
    it(`session_shutdown(${reason}) 释放端口并使旧凭据失效`, async () => {
      const { api, commands, handlers } = fakePi();
      extensionFactory(api);
      const { ctx } = fakeCtx(setupCwd());
      await sessionStart(handlers, ctx);
      await runCommand(commands, ctx);
      const first = lastUrl();
      const oldToken = new URL(first).hash.slice(1);

      await sessionShutdown(handlers, ctx, reason);
      await expect(rawStatus(first)).rejects.toThrow();

      await sessionStart(handlers, ctx, "new");
      await runCommand(commands, ctx);
      const second = lastUrl();

      expect(second).not.toBe(first);
      expect(
        await rawStatus(`${new URL(second).origin}/api/dashboard`, {
          authorization: `Bearer ${oldToken}`,
        }),
      ).toBe(401);
      await sessionShutdown(handlers, ctx);
    });
  }
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
