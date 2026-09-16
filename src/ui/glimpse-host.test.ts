import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { installHostStderrGuard } from "./glimpse-host.ts";

/**
 * AGENTS.md §4 契约：Glimpse 原生宿主的 stderr 不得出现在宿主终端。
 *
 * `glimpseui` 以 `stdio: ['pipe','pipe','inherit']` 派生宿主，宿主一旦写 stderr
 * 就会直接落到 Pi 独占的终端上。`inherit` 是 OS 级的 fd 2 传递，进程内无法
 * 观测，因此必须用子进程 + 重定向来测量，并保留一组「未规避」的对照组，
 * 否则测试无法发现回归。
 */

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
/** 驱动脚本要能解析 `glimpseui`，因此必须落在项目 node_modules 解析链内。 */
const DRIVER_ROOT = join(PROJECT_ROOT, "node_modules", ".cache", "xpi-kuma-tests");
const GUARD_MODULE = pathToFileURL(
  join(PROJECT_ROOT, "src", "ui", "glimpse-host.ts"),
).href;

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function tempDir(): string {
  mkdirSync(DRIVER_ROOT, {
    recursive: true,
  });
  const dir = mkdtempSync(join(DRIVER_ROOT, "run-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  return dir;
}

/**
 * 会往 stderr 写内容的假宿主，模拟真实的 `[glimpse] ...` 诊断输出。
 *
 * 带 shebang 且可执行：转发脚本用 `exec` 直接拉起它。
 */
function writeNoisyHost(dir: string): string {
  const path = join(dir, "noisy-host.mjs");
  writeFileSync(
    path,
    `#!/usr/bin/env node
process.stderr.write("[glimpse] fake host diagnostic\\n");
process.stdout.write(JSON.stringify({ type: "ready", screen: { width: 100, height: 100, scaleFactor: 1 } }) + "\\n");
// 收到任何 stdin 行即回一条 message，证明 stdin/stdout 双向往返都通
process.stdin.resume();
process.stdin.on("data", () => {
  process.stdout.write(JSON.stringify({ type: "message", data: { ack: true } }) + "\\n");
  setTimeout(() => process.exit(0), 50);
});
setTimeout(() => process.exit(0), 2000);
`,
  );
  chmodSync(path, 0o755);
  return path;
}

interface DriverResult {
  status: number | null;
  stderr: string;
  stderrBytes: number;
}

/** 以子进程运行驱动脚本，返回其 stderr（即宿主终端会看到的内容）。 */
function runDriver(source: string, env: Record<string, string>): DriverResult {
  const dir = tempDir();
  const driver = join(dir, "driver.mjs");
  writeFileSync(driver, source);

  // 合并后的 env 先落地为变量：对象字面量里混着 spread 时 biome 无法排序
  const mergedEnv = {
    ...process.env,
    ...env,
  };
  const result = spawnSync(
    process.execPath,
    [
      driver,
    ],
    {
      encoding: "utf8",
      env: mergedEnv,
      timeout: 30_000,
    },
  );

  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    stderr,
    stderrBytes: Buffer.byteLength(stderr),
  };
}

const SIMPLE_DRIVER = `import { open } from "glimpseui";
const win = open("<html></html>", { width: 100, height: 100 });
win.on("message", () => process.exit(0));
win.on("closed", () => process.exit(0));
setTimeout(() => process.exit(2), 4000);
`;

describe("Glimpse 宿主 stderr 隔离", () => {
  it("对照组：未规避时宿主 stderr 泄漏到父进程（证明测试能发现回归）", () => {
    const host = writeNoisyHost(tempDir());

    const result = runDriver(SIMPLE_DRIVER, {
      GLIMPSE_BINARY_PATH: host,
    });

    expect(result.stderr).toContain("[glimpse] fake host diagnostic");
    expect(result.stderrBytes).toBeGreaterThan(0);
  });

  it("规避后：宿主 stderr 零字节，内容改落入日志文件", () => {
    const dir = tempDir();
    const host = writeNoisyHost(dir);
    const dataDir = join(dir, "data", "xpi-kuma");
    const logPath = join(dataDir, "glimpse-host.stderr.log");

    const result = runDriver(
      `import { installHostStderrGuard } from ${JSON.stringify(GUARD_MODULE)};
import { open } from "glimpseui";
const guard = installHostStderrGuard(${JSON.stringify(dataDir)});
const win = open("<html></html>", { width: 100, height: 100 });
win.on("ready", () => { guard.restore(); process.exit(0); });
win.on("closed", () => { guard.restore(); process.exit(0); });
setTimeout(() => { guard.restore(); process.exit(2); }, 4000);
`,
      {
        GLIMPSE_BINARY_PATH: host,
      },
    );

    expect(result.status).toBe(0);
    // 契约：宿主终端零字节
    expect(result.stderr).toBe("");
    expect(result.stderrBytes).toBe(0);
    // 但内容没有被吞掉，仍可从日志追查
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf8")).toContain("[glimpse] fake host diagnostic");
  });

  it("转发脚本透传 stdin/stdout：握手往返不被破坏", () => {
    const dir = tempDir();
    const host = writeNoisyHost(dir);
    const dataDir = join(dir, "data", "xpi-kuma");

    // 只有收到宿主的 message 才以 0 退出：证明 html 下行与 message 上行都穿过 shim
    const result = runDriver(
      `import { installHostStderrGuard } from ${JSON.stringify(GUARD_MODULE)};
import { open } from "glimpseui";
const guard = installHostStderrGuard(${JSON.stringify(dataDir)});
const win = open("<html></html>", { width: 100, height: 100 });
win.on("message", () => { guard.restore(); process.exit(0); });
win.on("closed", () => { guard.restore(); process.exit(3); });
setTimeout(() => { guard.restore(); process.exit(4); }, 4000);
`,
      {
        GLIMPSE_BINARY_PATH: host,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("restore() 把环境变量还原，含原本未设置的情况", () => {
    const dir = tempDir();
    const host = writeNoisyHost(dir);
    const dataDir = join(dir, "data", "xpi-kuma");
    const original = process.env.GLIMPSE_BINARY_PATH;

    process.env.GLIMPSE_BINARY_PATH = host;
    const guard = installHostStderrGuard(dataDir);
    expect(process.env.GLIMPSE_BINARY_PATH).toContain("glimpse-host-shim.sh");
    guard.restore();
    expect(process.env.GLIMPSE_BINARY_PATH).toBe(host);

    delete process.env.GLIMPSE_BINARY_PATH;
    installHostStderrGuard(dataDir).restore();
    expect(process.env.GLIMPSE_BINARY_PATH).toBeUndefined();

    if (original === undefined) {
      delete process.env.GLIMPSE_BINARY_PATH;
    } else {
      process.env.GLIMPSE_BINARY_PATH = original;
    }
  });

  it("转发脚本通过 POSIX 语法检查，并对路径做引号转义", () => {
    const dir = tempDir();
    writeNoisyHost(dir);
    const dataDir = join(dir, "with space", "xpi-kuma");

    installHostStderrGuard(dataDir).restore();

    const shimPath = join(dataDir, "glimpse-host-shim.sh");
    const script = readFileSync(shimPath, "utf8");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain('"$@"');
    expect(() =>
      execFileSync("/bin/sh", [
        "-n",
        shimPath,
      ]),
    ).not.toThrow();
  });
});
