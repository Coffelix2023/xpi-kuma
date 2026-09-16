import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getNativeHostInfo } from "glimpseui";

/**
 * Glimpse 原生宿主的 stderr 隔离。
 *
 * `glimpseui` 用 `stdio: ['pipe', 'pipe', 'inherit']` 派生宿主进程，宿主自身的
 * 输出（如 `[glimpse] Setting up status item mode`）会直接写进 Pi 独占的终端，
 * 覆盖用户编辑器。AGENTS.md §4 禁止扩展让子进程 `inherit` stderr。
 *
 * 因为该 `spawn` 选项不可从外部覆盖，这里改用 `GLIMPSE_BINARY_PATH` 指向一层
 * 极薄的转发脚本：脚本把宿主的 stderr 追加到日志文件，stdin/stdout 原样透传。
 */

/** 环境变量名，与 glimpseui 的 `resolveNativeHost()` 约定一致。 */
const OVERRIDE_ENV = "GLIMPSE_BINARY_PATH";

/** 宿主 stderr 日志文件名。 */
const HOST_STDERR_LOG_NAME = "glimpse-host.stderr.log";

/** 转发脚本文件名。 */
const SHIM_NAME = "glimpse-host-shim.sh";

export interface HostGuard {
  /** 宿主 stderr 日志路径。 */
  logPath: string;
  /** 恢复原始环境变量；无论成功与否都应调用。 */
  restore(): void;
}

/**
 * 写入转发脚本并把 `GLIMPSE_BINARY_PATH` 指向它。
 *
 * @param dataDir 扩展数据目录，即 `<agentDir>/data/xpi-kuma`
 */
export function installHostStderrGuard(dataDir: string): HostGuard {
  const logPath = join(dataDir, HOST_STDERR_LOG_NAME);
  const shimPath = join(dataDir, SHIM_NAME);
  const previous = process.env[OVERRIDE_ENV];

  // 先解析真实宿主路径，再覆盖环境变量；否则会把 shim 指向自己
  const host = getNativeHostInfo();
  mkdirSync(dirname(shimPath), {
    recursive: true,
  });
  writeFileSync(shimPath, shimSource(host.path, logPath));
  chmodSync(shimPath, 0o755);

  process.env[OVERRIDE_ENV] = shimPath;

  return {
    logPath,
    restore() {
      if (previous === undefined) {
        delete process.env[OVERRIDE_ENV];
      } else {
        process.env[OVERRIDE_ENV] = previous;
      }
    },
  };
}

/**
 * 生成转发脚本。
 *
 * glimpseui 会把宿主的 `extraArgs` 前置到 argv，因此 `exec "$@"` 能同时覆盖
 * 原生二进制与 Linux 的 chromium 后端（`node chromium-backend.mjs ...`）。
 */
function shimSource(realHost: string, logPath: string): string {
  return `#!/bin/sh
# @generated xpi-kuma：把 Glimpse 原生宿主的 stderr 挡在宿主终端之外。
# stdin/stdout 保持透传（glimpseui 用 JSON Lines 协议通信）。
exec ${quote(realHost)} "$@" 2>>${quote(logPath)}
`;
}

/** POSIX 单引号安全转义，避免路径中的空格或引号破坏脚本。 */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
