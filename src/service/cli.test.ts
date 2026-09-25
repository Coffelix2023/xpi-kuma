import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readConfigTemplate, resolveConfigPath } from "../config.ts";
import { main } from "./cli.ts";
import {
  DAEMON_MARKER,
  isProcessAlive,
  readServiceState,
  serviceStatePath,
} from "./state.ts";

// `on --dev` 会真的用系统默认浏览器开页面；测试里换成空实现，只断言 URL 形状
// （vitest 会把 vi.mock 提升到所有 import 之前，位置不影响生效）
vi.mock("../lib/open-browser.ts", () => ({
  openInBrowser: vi.fn(async () => {}),
}));

/** 面板 URL 形状：`http://127.0.0.1:<端口>/#<凭据>`。 */
const DASHBOARD_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d+\/#/;
/**
 * CLI 集成测试：`on` 真实 detached spawn 一个 daemon 子进程（node 直跑 TS 源码），
 * 覆盖 spec「提供独立后台服务命令」与「后台进程不污染调用终端」的场景。
 */

const cleanups: (() => void)[] = [];
const spawned: ChildProcess[] = [];

afterEach(async () => {
  // 逐个确认测试中拉起的 daemon 已退出，避免串扰下一个用例
  while (spawned.length > 0) {
    const child = spawned.pop();
    if (child !== undefined && child.pid !== undefined && isProcessAlive(child.pid)) {
      child.kill("SIGKILL");
    }
  }
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  delete process.env.PI_CODING_AGENT_DIR;
});

/** 隔离 agent 目录 + 有效配置；返回目录路径。 */
function setupAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-cli-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  const configPath = resolveConfigPath();
  mkdirSync(dirname(configPath), {
    recursive: true,
  });
  writeFileSync(configPath, readConfigTemplate());
  return dir;
}

/** 找一个当前空闲的回环端口（绑定后立即释放）。 */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return port;
}

/** 对本机 URL 发 GET；页面外壳无需凭据。 */
function get(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const req = httpRequest(
      url,
      {
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? null);
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/** 等待条件成立；超时抛错。 */
async function waitFor(
  check: () => boolean,
  timeoutMs = 5000,
  message = "条件等待超时",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    // biome-ignore lint/performance/noAwaitInLoops: 测试辅助的间隔轮询，直到条件成立
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

describe("xpi-kuma CLI", () => {
  it("非法端口：启动前报错，不写状态文件", async () => {
    setupAgentDir();
    expect(
      await main([
        "on",
        "--port",
        "abc",
      ]),
    ).toBe(2);
    expect(
      await main([
        "on",
        "--port",
        "0",
      ]),
    ).toBe(2);
    expect(
      await main([
        "on",
        "--port",
        "70000",
      ]),
    ).toBe(2);
    expect(readServiceState()).toBeNull();
  });

  it("未知命令：打印用法并以参数错误退出", async () => {
    setupAgentDir();
    expect(
      await main([
        "reboot",
      ]),
    ).toBe(2);
  });

  it("on：后台服务就绪并监听指定端口；重复 on 幂等复用", async () => {
    setupAgentDir();
    const port = await freePort();

    expect(
      await main([
        "on",
        "--port",
        String(port),
      ]),
    ).toBe(0);

    const state = readServiceState();
    expect(state?.owner).toBe("daemon");
    expect(state?.ready).toBe(true);
    expect(state?.port).toBe(port);
    expect(state?.url).toMatch(DASHBOARD_URL_PATTERN);
    // 网页真实可达：页面外壳 200
    expect(await get(`http://127.0.0.1:${port}/`)).toBe(200);

    // 3.5 复用验证：配置/数据库/持久凭据/状态全部落在 PI_CODING_AGENT_DIR 下，
    // URL fragment 即持久 dashboard 凭据（书签跨重启有效）
    const agentData = join(String(process.env.PI_CODING_AGENT_DIR), "data", "xpi-kuma");
    const token = JSON.parse(
      readFileSync(join(agentData, "dashboard.json"), "utf8"),
    ) as {
      token: string;
    };
    expect(new URL(state?.url ?? "").hash).toContain(token.token);
    expect(existsSync(join(agentData, "usage.db"))).toBe(true);
    expect(serviceStatePath().startsWith(agentData)).toBe(true);
    // 重复 on：复用现有服务，不换端口不换进程
    expect(
      await main([
        "on",
        "--port",
        String(port),
      ]),
    ).toBe(0);
    const again = readServiceState();
    expect(again?.pid).toBe(state?.pid);
    expect(again?.port).toBe(port);

    // 清理：off 后端口释放、状态消失、进程退出
    expect(
      await main([
        "off",
      ]),
    ).toBe(0);
    await waitFor(() => !isProcessAlive(state?.pid ?? -1), 5000, "daemon 未退出");
    expect(await get(`http://127.0.0.1:${port}/`)).toBeNull();
    expect(readServiceState()).toBeNull();
  });

  it("off 幂等：无服务时重复 off 都成功", async () => {
    setupAgentDir();
    expect(
      await main([
        "off",
      ]),
    ).toBe(0);
    expect(
      await main([
        "off",
      ]),
    ).toBe(0);
  });

  it("占用端口：明确失败并清理状态，不静默改端口", async () => {
    setupAgentDir();
    const busy = await freePort();
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(busy, "127.0.0.1", resolve);
    });
    cleanups.push(() => blocker.close());
    try {
      expect(
        await main([
          "on",
          "--port",
          String(busy),
        ]),
      ).toBe(1);
      // 失败后不留下 ready 状态
      expect(readServiceState()?.ready ?? false).toBe(false);
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
    }
  });

  it("Pi 先启动：独立 on 明确拒绝并报告现有所有者", async () => {
    setupAgentDir();
    const port = await freePort();
    // pi 所有者只需存活校验：用当前测试进程模拟
    writeFileSync(
      serviceStatePath(),
      JSON.stringify({
        owner: "pi",
        pid: process.pid,
        port,
        ready: true,
        startedAt: new Date().toISOString(),
        url: "",
        version: 1,
      }),
    );
    expect(
      await main([
        "on",
        "--port",
        String(port),
      ]),
    ).toBe(1);
    // 拒绝后状态仍归 Pi，且没有 daemon 被拉起
    expect(readServiceState()?.owner).toBe("pi");
  });

  it("PID 复用防护：状态指向无标记的存活进程时 off 只清状态不发信号", async () => {
    setupAgentDir();
    // 当前测试进程存活但没有 daemon 标记：模拟 PID 被复用
    writeFileSync(
      serviceStatePath(),
      JSON.stringify({
        owner: "daemon",
        pid: process.pid,
        port: 5000,
        ready: true,
        startedAt: new Date().toISOString(),
        url: "",
        version: 1,
      }),
    );
    expect(
      await main([
        "off",
      ]),
    ).toBe(0);
    expect(readServiceState()).toBeNull();
    // 自身进程安然无恙
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("status：运行中报告 URL 与端口，无服务时报告未运行", async () => {
    setupAgentDir();
    expect(
      await main([
        "status",
      ]),
    ).toBe(0);

    const port = await freePort();
    expect(
      await main([
        "on",
        "--port",
        String(port),
      ]),
    ).toBe(0);
    expect(
      await main([
        "status",
      ]),
    ).toBe(0);

    const state = readServiceState();
    expect(
      await main([
        "off",
      ]),
    ).toBe(0);
    expect(state?.port).toBe(port);
  });

  it("on --dev：服务就绪后用浏览器打开带语义徽标参数的页面", async () => {
    setupAgentDir();
    const { openInBrowser } = await import("../lib/open-browser.ts");
    const opened = vi.mocked(openInBrowser);
    opened.mockClear();

    // 未知参数照旧拒绝：既不启动服务，也不开页面
    expect(
      await main([
        "on",
        "--dev",
        "--bogus",
      ]),
    ).toBe(2);
    expect(opened).not.toHaveBeenCalled();

    const port = await freePort();
    expect(
      await main([
        "on",
        "--port",
        String(port),
        "--dev",
      ]),
    ).toBe(0);
    expect(opened).toHaveBeenCalledTimes(1);
    const url = new URL(opened.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("semantic")).toBe("1");
    expect(url.port).toBe(String(port));
    // 凭据仍在 fragment 里，查询串只多了调试开关
    expect(url.hash).not.toBe("");

    // 服务已在运行时再执行 --dev：复用现有服务并再开一次页面
    opened.mockClear();
    expect(
      await main([
        "on",
        "--dev",
      ]),
    ).toBe(0);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0]?.[0]).toContain("?semantic=1");

    expect(
      await main([
        "off",
      ]),
    ).toBe(0);
  });

  it("宿主 stderr 零字节：daemon 直跑时无任何输出，对照组可检出", {
    timeout: 30_000,
  }, async () => {
    const dir = setupAgentDir();
    const port = await freePort();
    // 直接以文件路径跑真实 CLI 入口（vitest 的 import.meta.url 是本测试文件）
    const self = fileURLToPath(new URL("./cli.ts", import.meta.url));

    // 对照组：一个会写 stderr 的普通进程，证明捕获通道有效
    const control = spawn(
      process.execPath,
      [
        "-e",
        "console.error('boom')",
      ],
      {
        stdio: [
          "ignore",
          "ignore",
          "pipe",
        ],
      },
    );
    spawned.push(control);
    const controlStderr = await new Promise<string>((resolve) => {
      let text = "";
      control.stderr?.on("data", (chunk: Buffer) => {
        text += String(chunk);
      });
      control.on("close", () => resolve(text));
    });
    expect(controlStderr).toContain("boom");

    // daemon 直跑（未经 CLI 重定向）：stderr 必须零字节
    const daemonStderr = await (async () => {
      const child = spawn(
        process.execPath,
        [
          self,
          DAEMON_MARKER,
          "--port",
          String(port),
        ],
        {
          stdio: [
            "ignore",
            "ignore",
            "pipe",
          ],
        },
      );
      spawned.push(child);
      let text = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        text += String(chunk);
      });
      await waitFor(
        () => readServiceState()?.ready === true,
        15_000,
        `daemon 未就绪（stderr: ${text}），目录 ${dir}`,
      );
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("close", resolve);
      });
      return text;
    })();
    expect(daemonStderr).toBe("");
  });
});
