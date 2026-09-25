#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, openSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig } from "../config.ts";
import { openInBrowser } from "../lib/open-browser.ts";
import { daemonLogPath, runDaemon } from "./daemon.ts";
import {
  claimServiceState,
  clearServiceState,
  DAEMON_MARKER,
  hasDaemonMarker,
  isOwnershipActive,
  isProcessAlive,
  readServiceState,
  type ServiceState,
  serviceStatePath,
} from "./state.ts";

/**
 * 全局终端入口 `xpi-kuma`（package.json bin 指向本文件，`pnpm link --global` 后可用）。
 *
 * 本文件面向用户自己的终端，允许 stdout/stderr 输出；它拉起的 daemon 子进程
 * 仍遵守宿主 stderr 零字节纪律（stdin 忽略、输出重定向日志、detached + unref，
 * 见 spec「后台进程不污染调用终端」）。
 *
 * 命令：`xpi-kuma on [--port <1..65535>]` / `off` / `status`，
 * 以及内部守护模式 `--xpi-kuma-daemon`（由 on 拉起，不对外）。
 */

/** 等待 daemon 写出就绪状态的上限；首次补录可能扫描大量日志，给足余量。 */
const READY_TIMEOUT_MS = 30_000;

/** `off` 发送 SIGTERM 后等待进程退出的上限；超时且身份复核通过才升级 SIGKILL。 */
const STOP_TIMEOUT_MS = 5000;
const HELP = "用法：xpi-kuma on [--port <1..65535>] [--dev] | off | status";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 校验端口参数；非法值返回 undefined 交给调用方报错（1..65535 之外的整数同样非法）。 */
function parsePort(value: string): number | null {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

/** `on` 的参数：`--port <n>` 与 `--dev`（打开带语义徽标的页面）。 */
interface OnArgs {
  /** `--dev`：服务就绪后用默认浏览器打开 ?semantic=1 的调试页面 */
  dev: boolean;
  port?: number;
}

/** 解析 `on [--port <n>] [--dev]` 的剩余参数；未知参数返回 null。 */
function parseOnArgs(argv: string[]): OnArgs | null {
  let port: number | undefined;
  let dev = false;
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--dev") {
      dev = true;
      continue;
    }
    if (argv[i] !== "--port" || i + 1 >= argv.length) {
      return null;
    }
    const parsed = parsePort(argv[i + 1] ?? "");
    if (parsed === null) {
      return null;
    }
    port = parsed;
    i += 1;
  }
  return {
    dev,
    port,
  };
}

/**
 * `--dev`：用默认浏览器打开带语义徽标调试层的页面（`?semantic=1`）。
 *
 * 只影响本机浏览器，失败（无 URL、系统没有可用浏览器）只提示、不改退出码：
 * 服务已经起来了，不能因为开页面失败就报告启动失败。
 */
async function openDevPage(url: string): Promise<void> {
  if (!url) {
    console.error("服务未报告网页地址，跳过打开浏览器");
    return;
  }
  try {
    const target = new URL(url);
    target.searchParams.set("semantic", "1");
    await openInBrowser(target.toString());
    console.log(`已用浏览器打开语义标签页面：${target.toString()}`);
  } catch (error) {
    console.error(`打开浏览器失败：${describeError(error)}`);
  }
}

/** `xpi-kuma on [--port <n>]`：预检 → 后台拉起 daemon → 等真实就绪。 */
async function cmdOn(argv: string[]): Promise<number> {
  const args = parseOnArgs(argv);
  if (args === null) {
    console.error(`参数错误。${HELP}`);
    return 2;
  }
  // 先做全部参数校验，非法端口不 spawn 进程、不写状态文件（spec：非法端口）
  const existing = readServiceState();
  if (isOwnershipActive(existing)) {
    if (existing.owner === "daemon") {
      console.log(
        `xpi-kuma 服务已在运行：${existing.url || `http://127.0.0.1:${existing.port}`}`,
      );
      if (args.dev) {
        await openDevPage(existing.url);
      }
      return 0;
    }
    console.error(
      `Pi 进程（pid ${existing.pid}）已持有网页/探测；请先在 Pi 内执行 /xpi-kuma off 再启动独立服务`,
    );
    return 1;
  }
  if (existing !== null) {
    clearServiceState();
  }

  let configPort: number;
  try {
    configPort = loadConfig().dashboard.port;
  } catch (error) {
    console.error(
      error instanceof ConfigError
        ? error.message
        : `配置加载失败：${describeError(error)}`,
    );
    return 1;
  }
  const targetPort = args.port ?? configPort;

  // detached：调用终端退出后服务继续；stdin 忽略，输出全部落日志文件
  const logFd = openSync(daemonLogPath(), "a");
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      DAEMON_MARKER,
      ...(args.port === undefined
        ? []
        : [
            "--port",
            String(args.port),
          ]),
    ],
    {
      detached: true,
      stdio: [
        "ignore",
        logFd,
        logFd,
      ],
    },
  );
  closeSync(logFd);
  if (child.pid === undefined) {
    // spawn 同步失败（如可执行文件缺失）：没有子进程，直接报错
    console.error(`无法启动服务进程，详见日志 ${daemonLogPath()}`);
    return 1;
  }
  child.unref();

  const claim: ServiceState = {
    owner: "daemon",
    pid: child.pid,
    port: targetPort,
    ready: false,
    startedAt: new Date().toISOString(),
    url: "",
    version: 1,
  };
  if (!claimServiceState(claim)) {
    // 并发 on 抢先创建了认领：对方有效则复用其结果，否则清掉重试一次
    const rival = readServiceState();
    if (rival !== null && rival.owner === "daemon" && isOwnershipActive(rival)) {
      child.kill("SIGTERM");
      console.log(
        `xpi-kuma 服务已在运行：${rival.url || `http://127.0.0.1:${rival.port}`}`,
      );
      if (args.dev) {
        await openDevPage(rival.url);
      }
      return 0;
    }
    clearServiceState();
    if (!claimServiceState(claim)) {
      child.kill("SIGTERM");
      console.error(`无法创建服务状态文件 ${serviceStatePath()}`);
      return 1;
    }
  }

  const claimIsOurs = (): boolean => {
    const state = readServiceState();
    return state !== null && state.owner === "daemon" && state.pid === child.pid;
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  // 就绪后要打开的调试页面地址：在循环外统一打开，避免在轮询循环里 await
  let devUrl: string | null = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (claimIsOurs()) {
        clearServiceState();
      }
      console.error(
        `服务启动失败（退出码 ${child.exitCode ?? child.signalCode}），详见日志 ${daemonLogPath()}`,
      );
      return 1;
    }
    const state = readServiceState();
    if (state?.ready === true && state.owner === "daemon" && state.pid === child.pid) {
      console.log(
        `xpi-kuma 服务已启动：${state.url || `http://127.0.0.1:${state.port}`}`,
      );
      if (state.unverified !== undefined && state.unverified > 0) {
        console.log(`补录未核实 ${state.unverified} 条，详见日志 ${daemonLogPath()}`);
      }
      devUrl = state.url;
      break;
    }
    // biome-ignore lint/performance/noAwaitInLoops: 轮询等待 daemon 就绪是刻意的间隔重试
    await sleep(100);
  }
  if (devUrl !== null) {
    if (args.dev) {
      await openDevPage(devUrl);
    }
    return 0;
  }
  // 就绪超时：只清理自己的认领，不碰可能已接管的他人状态
  if (claimIsOurs()) {
    clearServiceState();
  }
  child.kill("SIGTERM");
  console.error(
    `等待服务就绪超时（${READY_TIMEOUT_MS}ms），详见日志 ${daemonLogPath()}`,
  );
  return 1;
}

/** `xpi-kuma off`：校验身份 → 有界停止 → 清状态；无状态时幂等成功。 */
async function cmdOff(): Promise<number> {
  const state = readServiceState();
  if (state === null) {
    console.log("xpi-kuma 服务未在运行");
    return 0;
  }
  if (state.owner === "pi") {
    console.error(
      `网页/探测由 Pi 进程（pid ${state.pid}）持有；请在 Pi 内执行 /xpi-kuma off`,
    );
    return 1;
  }
  // 发信号前校验进程身份：PID 复用后命令行不再含标记，绝不误杀无关进程
  if (!isProcessAlive(state.pid) || !hasDaemonMarker(state.pid)) {
    clearServiceState();
    console.log("发现过期的服务状态，已清理（未向任何进程发送信号）");
    return 0;
  }
  process.kill(state.pid, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isProcessAlive(state.pid) && Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: 有界轮询等待服务退出（spec：有限等待的正常关闭）
    await sleep(100);
  }
  if (isProcessAlive(state.pid)) {
    // 强制停止前再次复核身份，避免宽限期间 PID 被复用后误杀
    if (!hasDaemonMarker(state.pid)) {
      console.error("进程身份复核失败，已放弃强制停止；状态保留以便排查");
      return 1;
    }
    process.kill(state.pid, "SIGKILL");
    await sleep(500);
  }
  clearServiceState();
  console.log(`xpi-kuma 服务已停止（原端口 ${state.port}）`);
  return 0;
}

/** `xpi-kuma status`：展示当前所有者；顺带清理过期状态。 */
function cmdStatus(): number {
  const state = readServiceState();
  if (state === null) {
    console.log("xpi-kuma 服务未在运行");
    return 0;
  }
  if (!isOwnershipActive(state)) {
    clearServiceState();
    console.log("xpi-kuma 服务未在运行（已清理过期状态）");
    return 0;
  }
  if (state.owner === "pi") {
    console.log(`网页/探测由 Pi 进程持有：pid ${state.pid}，端口 ${state.port}`);
  } else {
    console.log(
      `xpi-kuma 服务运行中：${state.url || "无网页监听"}（pid ${state.pid}，端口 ${state.port}）`,
    );
  }
  return 0;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

/** CLI 分发；daemon 模式在进程内直跑 runDaemon。 */
export async function main(argv: string[]): Promise<number> {
  if (argv[0] === DAEMON_MARKER) {
    const portArg = argv[1] === "--port" ? parsePort(argv[2] ?? "") : undefined;
    if (argv[1] === "--port" && portArg === null) {
      return 2;
    }
    return runDaemon(portArg ?? undefined);
  }
  switch (argv[0]) {
    case "on":
      return cmdOn(argv);
    case "off":
      return cmdOff();
    case "status":
      return cmdStatus();
    default:
      console.error(HELP);
      return 2;
  }
}

/** 直接执行（bin 符号链接或 node cli.ts）时进入 main；被 import 时不执行。 */
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
