import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AccountService } from "./accounts/service.ts";
import { UsageCollector } from "./collectors/usage-collector.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { formatStatus } from "./lib/format.ts";
import { FileLogger } from "./lib/log.ts";
import { openInBrowser } from "./lib/open-browser.ts";
import { VendorMonitor } from "./monitors/vendor-monitor.ts";
import { Database } from "./storage/database.ts";
import type { KumaConfig, UsageRecord } from "./types.ts";
import { type DashboardServer, startDashboardServer } from "./ui/dashboard.ts";

const VERSION = "0.4.0";
const STATUS_KEY = "xpi-kuma";

/** 会话级运行时状态；`session_shutdown` 后清空。 */
interface Runtime {
  accountService: AccountService;
  config: KumaConfig;
  /** 当前会话的工作目录；面板的体检页据此解析配置与存储 */
  cwd: string;
  /** 当前会话的监控 Web 服务；未打开时为 null */
  dashboardServer: DashboardServer | null;
  database: Database;
  usageCollector: UsageCollector;
  vendorMonitor: VendorMonitor;
}

/** 在途的服务启动 Promise；同一时刻只允许一个，成功后清空。 */
let dashboardStart: Promise<DashboardServer> | null = null;
let runtime: Runtime | null = null;
const logger = new FileLogger(join(getAgentDir(), "data", "xpi-kuma", "xpi-kuma.log"));

export default function xpiKuma(pi: ExtensionAPI): void {
  pi.on("session_start", (event, ctx) => startSession(event, ctx));

  pi.on("message_end", (event, ctx) => {
    handleMessageEnd(event, ctx);
  });

  pi.on("turn_end", (event, ctx) => {
    handleTurnEnd(event, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => stopSession(ctx));

  pi.registerCommand("xpi-kuma", {
    description: "打开或重新打开监控面板",
    handler: async (_args, ctx) => {
      const current = runtime;
      if (!current) {
        ctx.ui.notify(`xpi-kuma ${VERSION}：会话尚未初始化，请稍后重试`, "warning");
        return;
      }
      if (current.config.vendors.length === 0) {
        ctx.ui.notify("未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml", "warning");
      }
      let server: DashboardServer;
      try {
        server = await ensureDashboardServer(current);
      } catch (error) {
        logger.error("启动监控面板服务失败", error);
        ctx.ui.notify(`启动监控面板服务失败：${describeError(error)}`, "error");
        return;
      }
      try {
        await openInBrowser(server.url);
        // 成功通知只给重开入口，不带本机 URL 与访问凭据（凭据在 URL fragment 里）
        ctx.ui.notify(
          "监控面板已在浏览器打开，关闭后可再次运行 /xpi-kuma 重新打开",
          "info",
        );
      } catch (error) {
        logger.error("打开默认浏览器失败", error);
        ctx.ui.notify(`无法自动打开浏览器，请手动访问：${server.url}`, "warning");
      }
    },
  });
}

/** 初始化数据库、配置与探测任务；失败不抛错，避免阻断 Pi 启动。 */
async function startSession(
  event: SessionStartEvent,
  ctx: ExtensionContext,
): Promise<void> {
  try {
    await stopSession(ctx);
    const config = loadConfig({
      cwd: ctx.cwd,
    });
    const database = new Database();
    const usageCollector = new UsageCollector(database);
    const vendorMonitor = new VendorMonitor(database, config);
    const accountService = new AccountService({
      config,
      cwd: ctx.cwd,
      database,
      logger,
    });

    // 保留期清理在会话启动时执行一次
    const removed = database.cleanOldRecords(config.retention.rawRecords);
    if (removed > 0) {
      logger.info(
        `清理了 ${removed} 条超过 ${config.retention.rawRecords} 天的使用量记录`,
      );
    }

    vendorMonitor.start();
    runtime = {
      accountService,
      config,
      cwd: ctx.cwd,
      dashboardServer: null,
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

/**
 * 关闭监控 Web 服务、停止探测并关闭数据库，最后清除 footer 状态。
 *
 * 先置空 runtime，重复调用会立即返回，因此 `session_start` 与
 * `session_shutdown` 都可以安全地等待它。顺序固定：先停 HTTP 服务，再停
 * 探测，最后关数据库，避免在途 API 请求读到已关闭的连接。
 */
async function stopSession(ctx: ExtensionContext): Promise<void> {
  const current = runtime;
  if (!current) {
    return;
  }
  runtime = null;
  dashboardStart = null;
  await quietly(() => current.dashboardServer?.close());
  await quietly(() => current.vendorMonitor.stop());
  await quietly(() => current.database.close());
  await quietly(() => ctx.ui.setStatus(STATUS_KEY, undefined));
}

/** 清理步骤彼此独立：单步失败只记日志，不阻断后续步骤。 */
async function quietly(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch (error) {
    logger.error("会话清理失败", error);
  }
}

/**
 * 启动或复用本会话的监控 Web 服务。
 *
 * 同一时刻只允许一个启动 Promise：并发执行 `/xpi-kuma` 不会创建第二个
 * 监听器；启动失败后清空缓存，允许用户重试。
 */
function ensureDashboardServer(current: Runtime): Promise<DashboardServer> {
  if (current.dashboardServer) {
    return Promise.resolve(current.dashboardServer);
  }
  dashboardStart ??= startDashboardServer(
    current.usageCollector,
    current.vendorMonitor,
    current.accountService,
    current.cwd,
  ).then(
    (server) => {
      current.dashboardServer = server;
      dashboardStart = null;
      return server;
    },
    (error: unknown) => {
      dashboardStart = null;
      throw error;
    },
  );
  return dashboardStart;
}

/**
 * 记录 assistant 消息的真实使用量。
 *
 * 非 assistant 消息或缺少 usage 时不写入任何记录。
 *
 * ## 归因元数据
 *
 * 使用量记录还要带上项目路径与会话标识，供归因按项目 / 会话分组。取值与回落规则：
 *
 * - 项目路径取 `ctx.cwd`。
 * - 会话标识取 `ctx.sessionManager.getSessionId()`，类型为 `string`，**始终有值**，
 *   作为归因会话维度的分组键。
 * - `ctx.sessionManager.getSessionName()` 的类型是 `string | undefined`（来自最新的
 *   `session_info` 条目，用户没命名过就是 `undefined`）。它**只用于界面提示「当前会话」**，
 *   不落库：会话名是可变元数据，存快照会与用户后续重命名不一致，且要多一列去同步。
 *   历史归因的会话展示改用标识的短前缀。
 * - 任一取值失败都降级为空字符串而不是抛错：拿不到元数据时照常写入使用量记录，
 *   归因查询把空值归入「未知」分组。丢一条使用量记录比丢一个维度严重得多。
 *
 * `message_end` 的 handler 因此接第二个参数 `ctx` —— `ExtensionHandler<E, R>` 的签名是
 * `(event, ctx) => ...`，`message_end` 同样能拿到上下文。
 *
 * 类型核对与探测结论见 `docs/probe-balance-and-oauth.md`。
 */

function handleMessageEnd(event: MessageEndEvent, ctx: ExtensionContext): void {
  if (!runtime || event.message.role !== "assistant") {
    return;
  }
  const { provider, model, usage } = event.message;
  if (!usage) {
    return;
  }
  const origin = resolveUsageOrigin(ctx);
  const record: UsageRecord = {
    costCacheRead: usage.cost?.cacheRead ?? 0,
    costCacheWrite: usage.cost?.cacheWrite ?? 0,
    costInput: usage.cost?.input ?? 0,
    costOutput: usage.cost?.output ?? 0,
    costTotal: usage.cost?.total ?? 0,
    cwd: origin.cwd,
    model,
    provider,
    sessionId: origin.sessionId,
    source: "real_usage",
    timestamp: Date.now(),
    tokensCacheRead: usage.cacheRead ?? 0,
    tokensCacheWrite: usage.cacheWrite ?? 0,
    tokensInput: usage.input ?? 0,
    tokensOutput: usage.output ?? 0,
    toolCalls: event.message.content.filter((block) => block.type === "toolCall")
      .length,
  };

  try {
    runtime.usageCollector.record(record);
  } catch (error) {
    logger.error("写入使用量记录失败", error);
  }
}

/**
 * 解析本次调用的归因元数据。
 *
 * 取不到就退化成空串而不是抛错：丢一条使用量记录比丢一个归因维度严重得多，
 * 空值在归因查询里会归入「未知」分组。
 */
function resolveUsageOrigin(ctx: ExtensionContext): {
  cwd: string;
  sessionId: string;
} {
  return {
    cwd: readContextValue(() => ctx.cwd),
    sessionId: readContextValue(() => ctx.sessionManager?.getSessionId()),
  };
}

/** 读取宿主提供的字符串；缺失、类型不符或抛错都退化为空串。 */
function readContextValue(read: () => unknown): string {
  try {
    const value = read();
    return typeof value === "string" ? value : "";
  } catch {
    return "";
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

/** 把失败原因压缩成一行用户可读文案，避免上游长消息撑爆通知区域。 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}
