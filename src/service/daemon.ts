import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { FileLogger } from "../lib/log.ts";
import { startStandaloneService } from "./standalone.ts";
import {
  clearServiceState,
  isOwnershipActive,
  readServiceState,
  replaceServiceState,
} from "./state.ts";

/**
 * 独立服务守护进程本体（CLI 用 detached spawn 拉起，见 cli.ts）。
 *
 * 宿主 stderr 纪律：daemon 由 Pi/终端之外的调用方拉起后与终端完全分离，
 * 本文件绝不写 stdout/stderr，所有诊断只落 xpi-kuma 日志文件；
 * CLI 已把子进程的 stdout/stderr 重定向到同一日志文件兜底。
 */

/** SIGTERM 后强制退出的宽限；正常关闭路径受 server.close 自身超时约束。 */
const FORCE_EXIT_MS = 5000;

/** 服务日志路径：与扩展共用同一文件，daemon 诊断可在此追查。 */
export function daemonLogPath(): string {
  return join(getAgentDir(), "data", "xpi-kuma", "xpi-kuma.log");
}

/**
 * 守护进程入口：启动服务本体并把就绪状态原子写回状态文件。
 *
 * 返回进程退出码；正常路径阻塞在服务句柄上直到收到 SIGTERM/SIGINT。
 */
export async function runDaemon(port?: number): Promise<number> {
  const logger = new FileLogger(daemonLogPath());
  // 双重保险：CLI 已预检，这里兜住手动启动与并发竞态。
  // state.pid 等于自己说明是 CLI 刚写入的本进程认领，不算冲突。
  const existing = readServiceState();
  if (existing && existing.pid !== process.pid && isOwnershipActive(existing)) {
    logger.error(
      `已有活跃服务所有者（${existing.owner} pid ${existing.pid}），独立服务拒绝启动`,
    );
    return 1;
  }
  let service: Awaited<ReturnType<typeof startStandaloneService>>;
  try {
    service = await startStandaloneService({
      logger,
      port,
    });
  } catch (error) {
    logger.error("独立服务启动失败", error);
    return 1;
  }
  if (service.server.portFallback) {
    // spec：请求端口被占用时明确失败，不静默改用随机端口
    await service.close();
    logger.error(`端口 ${port ?? "配置端口"} 已被占用，独立服务启动失败`);
    return 1;
  }
  replaceServiceState({
    owner: "daemon",
    pid: process.pid,
    port: service.server.port,
    ready: true,
    startedAt: new Date().toISOString(),
    unverified: service.report.unverified.length,
    url: service.server.url,
    version: 1,
  });
  logger.info(`独立服务已就绪：${service.server.url}`);

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) {
      return;
    }
    closing = true;
    setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref();
    void service.close().then(
      () => {
        clearServiceState();
        logger.info(`独立服务收到 ${signal}，已停止`);
        process.exit(0);
      },
      (error: unknown) => {
        logger.error("独立服务关闭失败", error);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return 0;
}
