import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { UsageCollector } from "./collectors/usage-collector.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { formatStatus } from "./lib/format.ts";
import { FileLogger } from "./lib/log.ts";
import { VendorMonitor } from "./monitors/vendor-monitor.ts";
import { Database } from "./storage/database.ts";
import type { KumaConfig, UsageRecord } from "./types.ts";
import { openDashboard } from "./ui/dashboard.ts";

const VERSION = "0.1.0";
const STATUS_KEY = "xpi-kuma";

/** 会话级运行时状态；`session_shutdown` 后清空。 */
interface Runtime {
  config: KumaConfig;
  database: Database;
  usageCollector: UsageCollector;
  vendorMonitor: VendorMonitor;
}

let runtime: Runtime | null = null;
const logger = new FileLogger(join(getAgentDir(), "data", "xpi-kuma", "xpi-kuma.log"));

export default function xpiKuma(pi: ExtensionAPI): void {
  pi.on("session_start", (event, ctx) => {
    startSession(event, ctx);
  });

  pi.on("message_end", (event) => {
    handleMessageEnd(event);
  });

  pi.on("turn_end", (event, ctx) => {
    handleTurnEnd(event, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopSession(ctx);
  });

  pi.registerCommand("xpi-kuma", {
    description: "打开监控面板",
    handler: async (_args, ctx) => {
      if (!runtime) {
        ctx.ui.notify(`xpi-kuma ${VERSION}：会话尚未初始化，请稍后重试`, "warning");
        return;
      }
      if (runtime.config.vendors.length === 0) {
        ctx.ui.notify("未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml", "warning");
      }
      try {
        await openDashboard(runtime.usageCollector, runtime.vendorMonitor, {
          period: "24h",
        });
      } catch (error) {
        logger.error("打开监控面板失败", error);
        ctx.ui.notify(`打开监控面板失败：${describeOpenFailure(error)}`, "error");
      }
    },
  });
}

/** 初始化数据库、配置与探测任务；失败不抛错，避免阻断 Pi 启动。 */
function startSession(event: SessionStartEvent, ctx: ExtensionContext): void {
  try {
    stopSession(ctx);
    const config = loadConfig({
      cwd: ctx.cwd,
    });
    const database = new Database();
    const usageCollector = new UsageCollector(database);
    const vendorMonitor = new VendorMonitor(database, config);

    // 保留期清理在会话启动时执行一次
    const removed = database.cleanOldRecords(config.retention.rawRecords);
    if (removed > 0) {
      logger.info(
        `清理了 ${removed} 条超过 ${config.retention.rawRecords} 天的使用量记录`,
      );
    }

    vendorMonitor.start();
    runtime = {
      config,
      database,
      usageCollector,
      vendorMonitor,
    };
    ctx.ui.setStatus(STATUS_KEY, formatStatus(usageCollector.getCurrentSessionStats()));
    logger.info(
      `会话启动（${event.reason}）：${config.vendors.length} 个供应商，${vendorMonitor.activeTimerCount} 个探测定时器`,
    );
  } catch (error) {
    logger.error("会话启动失败", error);
    const message =
      error instanceof ConfigError ? error.message : "xpi-kuma 初始化失败，详见日志";
    ctx.ui.notify(message, "error");
  }
}

/** 停止探测任务、关闭数据库并清除 footer 状态。 */
function stopSession(ctx: ExtensionContext): void {
  if (!runtime) {
    return;
  }
  try {
    runtime.vendorMonitor.stop();
    runtime.database.close();
  } catch (error) {
    logger.error("会话清理失败", error);
  } finally {
    runtime = null;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

/**
 * 记录 assistant 消息的真实使用量。
 *
 * 非 assistant 消息或缺少 usage 时不写入任何记录。
 */
function handleMessageEnd(event: MessageEndEvent): void {
  if (!runtime || event.message.role !== "assistant") {
    return;
  }
  const { provider, model, usage } = event.message;
  if (!usage) {
    return;
  }
  const record: UsageRecord = {
    costCacheRead: usage.cost?.cacheRead ?? 0,
    costCacheWrite: usage.cost?.cacheWrite ?? 0,
    costInput: usage.cost?.input ?? 0,
    costOutput: usage.cost?.output ?? 0,
    costTotal: usage.cost?.total ?? 0,
    model,
    provider,
    source: "real_usage",
    timestamp: Date.now(),
    tokensCacheRead: usage.cacheRead ?? 0,
    tokensCacheWrite: usage.cacheWrite ?? 0,
    tokensInput: usage.input ?? 0,
    tokensOutput: usage.output ?? 0,
  };

  try {
    runtime.usageCollector.record(record);
  } catch (error) {
    logger.error("写入使用量记录失败", error);
  }
}

/** 每个 turn 结束时刷新 footer；统计值来自内存累加器，不查数据库。 */
function handleTurnEnd(_event: TurnEndEvent, ctx: ExtensionContext): void {
  if (!runtime) {
    return;
  }
  try {
    ctx.ui.setStatus(
      STATUS_KEY,
      formatStatus(runtime.usageCollector.getCurrentSessionStats()),
    );
  } catch (error) {
    logger.error("更新 footer 状态失败", error);
    ctx.ui.setStatus(STATUS_KEY, "💰 - | 📊 -");
  }
}

/**
 * 把面板打开失败的原因压缩成一行用户可读文案。
 *
 * 最常见原因是原生宿主二进制缺失（glimpseui 的 postinstall 被跳过），
 * 此时上游抛出的消息很长，直接展示会撑爆通知区域。
 */
function describeOpenFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/host not found|glimpse/i.test(message)) {
    return "Glimpse 原生宿主不可用，请在扩展目录执行 pnpm rebuild glimpseui 后重试";
  }
  return message.split("\n")[0];
}
