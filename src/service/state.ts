import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * 服务所有权状态（spec：standalone-service「单实例与安全进程协调」）。
 *
 * 状态文件位于 agent 目录的 data/xpi-kuma/ 下，记录当前网页+探测的拥有者
 * （独立 daemon 进程或 Pi 进程）、PID、实际监听端口与面板 URL。
 * 同一数据目录最多只有一个活跃所有者；所有写操作要么排他创建、要么
 * 同目录临时文件 + rename 原子替换，读操作只会看到完整的新旧之一。
 *
 * 身份校验（不能只信 PID）：
 * - 存活检查用 `kill(pid, 0)`；
 * - daemon 所有者额外校验命令行标记（`--xpi-kuma-daemon`），PID 被无关进程
 *   复用后命令行不再含标记，`off` 据此拒绝发信号；
 * - state.pid 等于当前进程时视为已验证（进程对自己无需求助 ps）；
 * - pi 所有者只做存活校验。
 *   ponytail: pi 进程没有稳定命令行标记，PID 复用会误判「Pi 仍在运行」；
 *   误判方向是拒绝而不是误杀，用户在 Pi 内 off 一次即可恢复。
 */

/** daemon 子进程的命令行标记：CLI spawn 时注入，`ps` 校验据此识别。 */
export const DAEMON_MARKER = "--xpi-kuma-daemon";

export interface ServiceState {
  owner: "daemon" | "pi";
  pid: number;
  /** 实际监听端口；0 表示所有者只持有探测、没有网页监听 */
  port: number;
  /** daemon 已完成补录并监听成功；pi 所有者写入时即为 true */
  ready: boolean;
  startedAt: string;
  /** 补录未核实条数；CLI 就绪提示据此展示 */
  unverified?: number;
  /** 含凭据 fragment 的本机 URL；无网页监听时为空串 */
  url: string;
  version: 1;
}

export function serviceStatePath(): string {
  return join(getAgentDir(), "data", "xpi-kuma", "service-state.json");
}

function stateDir(): string {
  return dirname(serviceStatePath());
}

/** 读回状态；文件不存在、损坏或形状不符都返回 null，由调用方决定清理。 */
export function readServiceState(): ServiceState | null {
  let raw: string;
  try {
    raw = readFileSync(serviceStatePath(), "utf8");
  } catch {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const state = value as Record<string, unknown>;
    if (
      state.version !== 1 ||
      (state.owner !== "daemon" && state.owner !== "pi") ||
      typeof state.pid !== "number" ||
      !Number.isInteger(state.pid) ||
      state.pid <= 0 ||
      typeof state.port !== "number" ||
      typeof state.url !== "string" ||
      typeof state.ready !== "boolean" ||
      typeof state.startedAt !== "string"
    ) {
      return null;
    }
    // SAFETY: 上方已逐一 typeof/枚举校验全部必备字段，运行时形状等价于 ServiceState
    return state as unknown as ServiceState;
  } catch {
    return null;
  }
}

/** 进程存活检查：ESRCH 视为不存活，EPERM（无权限）视为存活。 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 命令行标记校验：macOS/Linux 的 `ps` 都支持 `-o command=`。 */
export function hasDaemonMarker(pid: number): boolean {
  try {
    const result = spawnSync(
      "ps",
      [
        "-o",
        "command=",
        "-p",
        String(pid),
      ],
      {
        encoding: "utf8",
        timeout: 2000,
        stdio: [
          "ignore",
          "pipe",
          "ignore",
        ],
      },
    );
    return result.status === 0 && (result.stdout ?? "").includes(DAEMON_MARKER);
  } catch {
    return false;
  }
}

function identityVerified(state: ServiceState): boolean {
  if (!isProcessAlive(state.pid)) {
    return false;
  }
  if (state.pid === process.pid || state.owner === "pi") {
    return true;
  }
  return hasDaemonMarker(state.pid);
}

/**
 * 校验状态是否指向一个可确认的活跃所有者。
 *
 * 返回 false 时状态一定过期（进程死亡、PID 复用或形状损坏），调用方
 * 可以安全清理后重新启动；返回 true 时不允许对 pid 发信号。
 */
export function isOwnershipActive(state: ServiceState | null): state is ServiceState {
  return state !== null && identityVerified(state);
}

/** 排他创建状态文件：已存在（含并发 `on` 抢先）时返回 false，不覆盖。 */
export function claimServiceState(state: ServiceState): boolean {
  mkdirSync(stateDir(), {
    recursive: true,
  });
  let fd: number;
  try {
    fd = openSync(serviceStatePath(), "wx");
  } catch {
    return false;
  }
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2));
  } finally {
    closeSync(fd);
  }
  return true;
}

/** 原子替换状态：同目录临时文件 + rename，读者只见完整新旧之一。 */
export function replaceServiceState(state: ServiceState): void {
  mkdirSync(stateDir(), {
    recursive: true,
  });
  const target = serviceStatePath();
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, target);
}

/**
 * 清理状态文件。
 *
 * 传入 expectedOwner 时只在该所有者的状态存在时才删，防止 Pi 侧清理
 * 误删 daemon 的认领（或反之）；不给则无条件删除（CLI 校验身份后调用）。
 */
export function clearServiceState(expectedOwner?: ServiceState["owner"]): boolean {
  const state = readServiceState();
  if (state === null) {
    return false;
  }
  if (expectedOwner !== undefined && state.owner !== expectedOwner) {
    return false;
  }
  rmSync(serviceStatePath(), {
    force: true,
  });
  return true;
}
