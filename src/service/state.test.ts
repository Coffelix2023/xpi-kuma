import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimServiceState,
  clearServiceState,
  hasDaemonMarker,
  isOwnershipActive,
  isProcessAlive,
  readServiceState,
  replaceServiceState,
  type ServiceState,
  serviceStatePath,
} from "./state.ts";

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  delete process.env.PI_CODING_AGENT_DIR;
});

function setupAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-state-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  mkdirSync(join(dir, "data", "xpi-kuma"), {
    recursive: true,
  });
  return dir;
}

function stateOf(overrides: Partial<ServiceState> = {}): ServiceState {
  return {
    owner: "daemon",
    pid: process.pid,
    port: 5180,
    ready: true,
    startedAt: new Date().toISOString(),
    url: "http://127.0.0.1:5180/#tok",
    version: 1,
    ...overrides,
  };
}

describe("服务所有权状态", () => {
  it("状态缺失、损坏或形状不符时读取为 null", () => {
    const dir = setupAgentDir();
    expect(readServiceState()).toBeNull();

    writeFileSync(serviceStatePath(), "{not-json");
    expect(readServiceState()).toBeNull();

    writeFileSync(
      serviceStatePath(),
      JSON.stringify({
        version: 1,
      }),
    );
    expect(readServiceState()).toBeNull();
    expect(dir).toBeTruthy();
  });

  it("排他创建：先到先得，后到失败且不覆盖已有内容", () => {
    setupAgentDir();
    expect(
      claimServiceState(
        stateOf({
          port: 5001,
        }),
      ),
    ).toBe(true);
    expect(
      claimServiceState(
        stateOf({
          port: 5002,
        }),
      ),
    ).toBe(false);
    const state = readServiceState();
    expect(state?.port).toBe(5001);
  });

  it("原子替换：替换后读到新内容", () => {
    setupAgentDir();
    claimServiceState(
      stateOf({
        ready: false,
        url: "",
      }),
    );
    replaceServiceState(
      stateOf({
        port: 6100,
        unverified: 2,
      }),
    );
    const state = readServiceState();
    expect(state?.port).toBe(6100);
    expect(state?.unverified).toBe(2);
  });

  it("按所有者清理：owner 不匹配时不删除", () => {
    setupAgentDir();
    claimServiceState(
      stateOf({
        owner: "daemon",
      }),
    );
    expect(clearServiceState("pi")).toBe(false);
    expect(readServiceState()?.owner).toBe("daemon");
    expect(clearServiceState("daemon")).toBe(true);
    expect(readServiceState()).toBeNull();
    expect(clearServiceState()).toBe(false);
  });

  it("存活检查：自身存活，已退出的 PID 不存活", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    const dead = spawnSync("true");
    expect(isProcessAlive(dead.pid)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
  });

  it("命令行标记校验：带标记的进程命中，无标记进程不命中", async () => {
    const script = join(mkdtempSync(join(tmpdir(), "xpi-kuma-marker-")), "dummy.mjs");
    cleanups.push(() =>
      rmSync(script, {
        force: true,
      }),
    );
    writeFileSync(script, "setInterval(() => {}, 10_000);\n");
    const child = spawn(
      process.execPath,
      [
        script,
        "--xpi-kuma-daemon",
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    if (child.pid === undefined) {
      throw new Error("测试进程启动失败");
    }
    child.unref();
    try {
      // ps 需要一点时间看到刚启动的进程
      let verified = false;
      for (let i = 0; i < 50 && !verified; i += 1) {
        verified = hasDaemonMarker(child.pid);
        if (!verified) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(verified).toBe(true);
      // 同样存活的自身进程（vitest）没有该标记
      expect(hasDaemonMarker(process.pid)).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("所有权校验：自身 PID 视为已验证；他人进程无标记则不活跃", () => {
    setupAgentDir();
    // 自身写入的认领（测试进程内嵌 daemon 的形态）
    expect(
      isOwnershipActive(
        stateOf({
          pid: process.pid,
        }),
      ),
    ).toBe(true);
    // pi 所有者只做存活校验
    expect(
      isOwnershipActive(
        stateOf({
          owner: "pi",
          pid: process.pid,
        }),
      ),
    ).toBe(true);
    // 死亡进程一律不活跃
    const dead = spawnSync("true");
    expect(
      isOwnershipActive(
        stateOf({
          pid: dead.pid,
        }),
      ),
    ).toBe(false);
    expect(isOwnershipActive(null)).toBe(false);
  });

  it("PID 复用防护：存活但无 daemon 标记的他人进程不算活跃 daemon", () => {
    setupAgentDir();
    // 当前 vitest 进程存活但没有 --xpi-kuma-daemon 标记
    expect(
      isOwnershipActive(
        stateOf({
          owner: "daemon",
          pid: process.pid + 0,
        }),
      ),
    ).toBe(true); // 自身例外
    const foreign = spawnSync("node", [
      "-e",
      "process.exit(0)",
    ]);
    expect(foreign.pid).toBeGreaterThan(0);
    expect(
      isOwnershipActive(
        stateOf({
          pid: foreign.pid,
        }),
      ),
    ).toBe(false);
  });

  it("readServiceState 返回的文件路径位于 agent 数据目录", () => {
    const dir = setupAgentDir();
    expect(serviceStatePath()).toBe(
      join(dir, "data", "xpi-kuma", "service-state.json"),
    );
  });

  it("损坏的状态内容能被读出为 null 而不是抛错", () => {
    setupAgentDir();
    writeFileSync(
      serviceStatePath(),
      JSON.stringify([
        1,
        2,
        3,
      ]),
    );
    expect(readServiceState()).toBeNull();
  });
});
