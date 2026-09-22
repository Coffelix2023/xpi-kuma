import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AccountService } from "./accounts/service.ts";
import { UsageCollector } from "./collectors/usage-collector.ts";
import { ConfigError, loadConfig, resolveConfigPath } from "./config.ts";
import { FileLogger } from "./lib/log.ts";
import { openInBrowser } from "./lib/open-browser.ts";
import { VendorMonitor } from "./monitors/vendor-monitor.ts";
import { Database } from "./storage/database.ts";
import type { KumaConfig, UsageRecord } from "./types.ts";
import { type DashboardServer, startDashboardServer } from "./ui/dashboard.ts";

const VERSION = "0.8.0";

/**
 * 进程级运行时：`on` 建立、`off` 销毁；会话切换不重建。
 *
 * 面板与后台监测都常驻，所以数据库与探测定时器都挂在这里；只有 `cwd`
 * 是会话级字段，随当前会话更新（体检页展示「当前项目」）。
 */
interface Runtime {
  accountService: AccountService;
  config: KumaConfig;
  /** 当前会话的工作目录；体检页据此展示「当前项目」 */
  cwd: string;
  /** 进程内常驻的监控 Web 服务；未打开时为 null */
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

  pi.registerCommand("xpi-kuma", {
    description: "打开监控面板（on / off 开关，缺省等同 on）",
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action === "off") {
        await stopRuntime(ctx);
        return;
      }
      if (action !== "" && action !== "on") {
        ctx.ui.notify(`未知参数「${action}」，可用：on / off`, "warning");
        return;
      }
      let current = runtime;
      if (!current) {
        try {
          current = initRuntime(ctx.cwd);
        } catch (error) {
          logger.error("启动监控面板服务失败", error);
          ctx.ui.notify(
            error instanceof ConfigError
              ? error.message
              : `启动监控面板服务失败：${describeError(error)}`,
            "error",
          );
          return;
        }
      }
      if (current.config.vendors.length === 0) {
        ctx.ui.notify(
          "未配置任何供应商，请编辑 ~/.pi/agent/data/xpi-kuma/config.yaml",
          "warning",
        );
      }
      let server: DashboardServer;
      try {
        server = await ensureDashboardServer(current);
      } catch (error) {
        logger.error("启动监控面板服务失败", error);
        ctx.ui.notify(`启动监控面板服务失败：${describeError(error)}`, "error");
        return;
      }
      if (server.portFallback) {
        ctx.ui.notify(
          `默认端口 ${current.config.dashboard.port} 已被占用，本次面板改用 ${server.port}`,
          "warning",
        );
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

/**
 * 初始化（或复用）进程级运行时，并刷新会话级状态。
 *
 * 服务跨会话常驻：已有运行时只更新 `cwd`；
 * `session_shutdown` 不再拆掉服务，只有 `xpi-kuma off` 才关。
 */
async function startSession(
  event: SessionStartEvent,
  ctx: ExtensionContext,
): Promise<void> {
  try {
    notifyLegacyConfig(ctx);
    const current = runtime ?? initRuntime(ctx.cwd);
    // 会话级：体检页展示当前项目

    // 保留期清理在会话启动时执行一次
    const removed = current.database.cleanOldRecords(
      current.config.retention.rawRecords,
    );
    if (removed > 0) {
      logger.info(
        `清理了 ${removed} 条超过 ${current.config.retention.rawRecords} 天的使用量记录`,
      );
    }

    logger.info(
      `会话启动（${event.reason}）：${current.config.vendors.length} 个供应商，${current.vendorMonitor.activeTimerCount} 个探测定时器`,
    );
  } catch (error) {
    logger.error("会话启动失败", error);
    const message =
      error instanceof ConfigError ? error.message : "xpi-kuma 初始化失败，详见日志";
    ctx.ui.notify(message, "error");
  }
}

/**
 * 建立进程级运行时：加载配置、开数据库、启动探测定时器。
 *
 * 抛错交给调用方提示；失败时不留下半截运行时（先全部建好，再赋值给 `runtime`）。
 */
function initRuntime(cwd: string): Runtime {
  const config = loadConfig();
  const database = new Database();
  const usageCollector = new UsageCollector(database);
  const vendorMonitor = new VendorMonitor(database, config);
  const accountService = new AccountService({
    config,
    database,
    logger,
  });
  vendorMonitor.start();
  runtime = {
    accountService,
    config,
    cwd,
    dashboardServer: null,
    database,
    usageCollector,
    vendorMonitor,
  };
  logger.info(`xpi-kuma ${VERSION} 运行时已建立，服务跨会话常驻`);
  return runtime;
}

/**
 * 旧的项目级配置只提示迁移，不写盘。
 *
 * 配置已改为全局唯一。全局文件还没建、而当前项目里还留着旧文件时，用户大概率以为
 * 配置丢了，这里给出可复制的 `cp` 命令，但不替用户决定搬哪一份。
 */
function notifyLegacyConfig(ctx: ExtensionContext): void {
  const legacyPath = join(ctx.cwd, ".pi", "xpi-kuma", "config.yaml");
  if (existsSync(resolveConfigPath()) || !existsSync(legacyPath)) {
    return;
  }
  ctx.ui.notify(
    `xpi-kuma 已改用全局配置 ${resolveConfigPath()}；检测到旧配置 ${legacyPath}，可自行 cp 迁移`,
    "warning",
  );
}

/**
 * 关闭面板服务、停止探测并关闭数据库（`xpi-kuma off`）。
 *
 * 顺序固定：先停 HTTP 服务，再停探测，最后关数据库，避免在途 API 请求读到已关闭的
 * 连接。`session_shutdown` 不再调用这里 —— 服务要跨会话常驻。
 */
async function stopRuntime(ctx: ExtensionContext): Promise<void> {
  const current = runtime;
  if (!current) {
    ctx.ui.notify("xpi-kuma 面板已处于关闭状态", "info");
    return;
  }
  runtime = null;
  dashboardStart = null;
  await quietly(() => current.dashboardServer?.close());
  await quietly(() => current.vendorMonitor.stop());
  await quietly(() => current.database.close());
  ctx.ui.notify("xpi-kuma 面板已关闭（/xpi-kuma on 可重新启动）", "info");
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
    {
      accountService: current.accountService,
      cwd: current.cwd,
      port: current.config.dashboard.port,
    },
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

/** 把失败原因压缩成一行用户可读文案，避免上游长消息撑爆通知区域。 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}
