import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readConfigTemplate, resolveConfigPath } from "./config.ts";

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

function sessionStart(
  handlers: ReturnType<typeof fakePi>["handlers"],
  ctx: ExtensionContext,
  reason = "startup",
) {
  handlers.get("session_start")?.(
    {
      reason,
      type: "session_start",
    },
    ctx,
  );
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

/** 事件内容对被测逻辑无关，只需要触发 footer 刷新。 */
function turnEndEvent(): TurnEndEvent {
  return {
    message: {},
    toolResults: [],
    turnIndex: 1,
    type: "turn_end",
  } as unknown as TurnEndEvent;
}

beforeAll(async () => {
  // Database 与 logger 都从 agent dir 取路径，测试必须隔离到临时目录
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "xpi-kuma-agentdir-"));
  const mod = await import("./index.ts");
  extensionFactory = mod.default;
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
    expect(commands.get("xpi-kuma")?.description).toBe("打开监控面板");
  });
});

describe("会话生命周期", () => {
  it("session_start 后 footer 显示零值统计", () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, setStatus } = fakeCtx(setupCwd());

    sessionStart(handlers, ctx);

    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", "💰 ¥0.00 | 📊 0");
  });

  it("message_end 累加会话统计并写入数据库", () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    sessionStart(handlers, ctx);

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
  });

  it("忽略非 assistant 消息与缺少 usage 的 assistant 消息", () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    sessionStart(handlers, ctx);

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
  });

  it("session_shutdown 清除 footer 状态", () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx, setStatus } = fakeCtx(setupCwd());
    sessionStart(handlers, ctx);
    setStatus.mockClear();

    handlers.get("session_shutdown")?.(
      {
        reason: "quit",
        type: "session_shutdown",
      },
      ctx,
    );

    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", undefined);
  });

  it("配置无法创建时提示用户而不抛错", () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const dir = setupCwd();
    // 把 cwd 指向一个普通文件：loadConfig 既不能建目录也不能读文件
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    const { ctx, notify } = fakeCtx(blocker);

    expect(() => sessionStart(handlers, ctx)).not.toThrow();
    expect(notify).toHaveBeenCalled();
  });
});

describe("统计累加语义", () => {
  it("同一 turn 内多条 assistant 消息都会累加", () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    sessionStart(handlers, ctx);

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
  });

  it("重新 session_start 重置累加器", () => {
    const { api, handlers } = fakePi();
    extensionFactory(api);
    const { ctx } = fakeCtx(setupCwd());
    sessionStart(handlers, ctx);
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
    sessionStart(handlers, newSessionCtx, "new");

    expect(setStatus).toHaveBeenCalledWith("xpi-kuma", "💰 ¥0.00 | 📊 0");
  });
});
