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
import {
  clearServiceState,
  isOwnershipActive,
  readServiceState,
  replaceServiceState,
  type ServiceState,
} from "./service/state.ts";
import { Database, defaultDatabasePath } from "./storage/database.ts";
import { backfillFromSessionLogs } from "./sync/backfill.ts";
import { usageFingerprint } from "./sync/fingerprint.ts";
import type { KumaConfig, UsageRecord } from "./types.ts";
import { type DashboardServer, startDashboardServer } from "./ui/dashboard.ts";

const VERSION = "0.9.2";

/**
 * 进程级运行时：随 Pi 进程常驻，`off` 只销毁网页/探测所有权，不销毁 recorder。
 *
 * 真实用量采集（usageCollector + database）独立于服务开关（spec：usage-collection）；
 * 只有 `cwd` 是会话级字段，随当前会话更新（体检页展示「当前项目」）。
 */
interface Runtime {
  accountService: AccountService;
  config: KumaConfig;
  /** 当前会话的工作目录；体检页据此展示「当前项目」 */
  cwd: string;
  /** 监控 Web 服务；仅在服务 on 期间存在（off 只关网页与探测） */
  dashboardServer: DashboardServer | null;
  database: Database;
  /** recorder 所连数据库的路径：agent 目录被 PI_CODING_AGENT_DIR 改指时据此重建 */
  dbPath: string;
  usageCollector: UsageCollector;
  /** 探测定时器；仅在服务 on 期间存在，off 后为 null */
  vendorMonitor: VendorMonitor | null;
}

/** 在途的服务启动 Promise；同一时刻只允许一个，成功后清空。 */
let dashboardStart: Promise<DashboardServer> | null = null;
let runtime: Runtime | null = null;
/** 在调用链上被事件直接观测、但尚未被 assistant message_end 消费的真实时间点。 */
let pendingTiming: {
  firstTokenAt?: number;
  startedAt: number;
} | null = null;
const logger = new FileLogger(join(getAgentDir(), "data", "xpi-kuma", "xpi-kuma.log"));
/** 一天的毫秒数：保留期换算（cleanOldRecords 与补录扫描共用同一口径） */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 读取仍在生效的独立服务所有权状态（spec：standalone-service「共享所有权」）。
 * 损坏或指向死亡进程/PID 复用的状态不视为活跃，由调用方自行启动服务。
 */
function findActiveDaemonState(): ServiceState | null {
  const state = readServiceState();
  if (state === null || state.owner !== "daemon" || !isOwnershipActive(state)) {
    return null;
  }
  return state;
}

/**
 * 记录 Pi 对网页/探测的所有权，供终端 CLI 识别冲突（spec：Pi 服务先启动时
 * 独立 `on` 明确拒绝）。 ponytail: 与 daemon 就绪写入存在微小竞态窗口，
 * 双方均为原子整文件替换，后写者胜，无半截状态。
 */
function recordPiOwnership(current: Runtime): void {
  replaceServiceState({
    owner: "pi",
    pid: process.pid,
    port: current.dashboardServer?.port ?? 0,
    ready: true,
    startedAt: new Date().toISOString(),
    url: current.dashboardServer?.url ?? "",
    version: 1,
  });
}

export default function xpiKuma(pi: ExtensionAPI): void {
  pi.on("session_start", (event, ctx) => startSession(event, ctx));

  pi.on("message_end", (event, ctx) => {
    handleMessageEnd(event, ctx);
  });

  pi.on("before_provider_request", () => {
    // 请求发出前一刻的直接观测；可得性核对见 src/pi-event-timing.test.ts（2.1）
    pendingTiming = {
      startedAt: Date.now(),
    };
  });

  pi.on("message_update", (event) => {
    // 首个流事件到达即首个响应 token 的直接观测；只取第一次
    if (
      event.message.role === "assistant" &&
      pendingTiming &&
      pendingTiming.firstTokenAt === undefined
    ) {
      pendingTiming.firstTokenAt = Date.now();
    }
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
      let current: Runtime;
      try {
        current = ensureRuntime(ctx.cwd);
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
      if (current.config.vendors.length === 0) {
        ctx.ui.notify(
          "未配置任何供应商，请编辑 ~/.pi/agent/data/xpi-kuma/config.yaml",
          "warning",
        );
      }
      // 独立服务持有网页时复用其 URL 与持久凭据，不启动第二个监听器/探测器
      // （spec：dashboard-ui「独立服务持有网页」）
      const daemonState = findActiveDaemonState();
      if (daemonState !== null) {
        if (!daemonState.ready || daemonState.url === "") {
          ctx.ui.notify("独立服务正在启动，请稍后重试 /xpi-kuma", "info");
          return;
        }
        try {
          await openInBrowser(daemonState.url);
          ctx.ui.notify("监控面板由独立服务提供，已在浏览器打开", "info");
        } catch (error) {
          logger.error("打开默认浏览器失败", error);
          ctx.ui.notify(
            `无法自动打开浏览器，请手动访问：${daemonState.url}`,
            "warning",
          );
        }
        return;
      }
      // 服务所有权：on 时同时取得网页与探测，并登记 Pi 所有权供 CLI 识别
      ensureVendorMonitor(current);
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
      recordPiOwnership(current);
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
    const current = ensureRuntime(ctx.cwd);
    // 会话级：体检页展示当前项目

    // 保留期清理在会话启动时执行一次
    // 保留期清理在会话启动时执行一次；补录扫描下界必须与清理截止一致（同一 now）
    const now = Date.now();
    const retentionDays = current.config.retention.rawRecords;
    const removed = current.database.cleanOldRecords(retentionDays, now);
    if (removed > 0) {
      logger.info(`清理了 ${removed} 条超过 ${retentionDays} 天的使用量记录`);
    }

    // 共享补录（ADR 0001 角色 2）：扫描下界 = 清理截止，超期日志不回插。
    // 自身失败只记日志：补录绝不阻断会话启动与实时采集（spec：usage-collection）
    try {
      const report = backfillFromSessionLogs(current.database, {
        cutoff: now - retentionDays * DAY_MS,
      });
      for (const diagnostic of report.scanDiagnostics) {
        logger.warn(`会话日志扫描：${diagnostic.sessionFile} ${diagnostic.detail}`);
      }
      for (const item of report.diagnostics) {
        logger.warn(`补录未核实：${item.entryId}（${item.reason}）${item.sessionFile}`);
      }
      if (
        report.inserted > 0 ||
        report.reconciled > 0 ||
        report.diagnostics.length > 0
      ) {
        logger.info(
          `补录完成：新增 ${report.inserted}，对账 ${report.reconciled}，跳过 ${report.skipped}，未核实 ${report.diagnostics.length}`,
        );
      }
    } catch (error) {
      logger.warn(`日志补录失败（不影响实时采集）：${describeError(error)}`);
    }

    // 服务所有权协调（spec：standalone-service）：独立服务在跑时 Pi 不重复监听/探测，
    // recorder 照常实时入账；服务停止后下一次会话/命令可由 Pi 接管。
    if (findActiveDaemonState() !== null) {
      // biome-ignore lint/security/noSecrets: 中文高熵误报，日志文案不含任何凭据
      logger.info("独立服务持有网页与探测：Pi 仅保持实时用量采集");
      return;
    }
    ensureVendorMonitor(current);
    recordPiOwnership(current);
    logger.info(
      `会话启动（${event.reason}）：${current.config.vendors.length} 个供应商，${current.vendorMonitor?.activeTimerCount ?? 0} 个探测定时器`,
    );
  } catch (error) {
    logger.error("会话启动失败", error);
    const message =
      error instanceof ConfigError ? error.message : "xpi-kuma 初始化失败，详见日志";
    ctx.ui.notify(message, "error");
  }
}

/**
 * 建立进程级运行时：加载配置、开数据库、常驻 recorder。
 *
 * 探测定时器不在这里启动：探测与 Web 服务同为「服务所有权」，只在
 * `on` / `session_start` 时经 `ensureVendorMonitor` 取得（spec：vendor-monitoring）。
 * 抛错交给调用方提示；失败时不留下半截运行时（先全部建好，再赋值给 `runtime`）。
 */
function initRuntime(cwd: string): Runtime {
  const config = loadConfig();
  const database = new Database();
  const usageCollector = new UsageCollector(database);
  const accountService = new AccountService({
    config,
    database,
    logger,
  });
  runtime = {
    accountService,
    config,
    cwd,
    dashboardServer: null,
    database,
    dbPath: defaultDatabasePath(),
    usageCollector,
    // 服务所有权：探测与网页只在 on / session_start 时取得
    vendorMonitor: null,
  };
  logger.info(`xpi-kuma ${VERSION} 运行时已建立（recorder 常驻，服务随 on/off 启停）`);
  return runtime;
}

/**
 * 取得或重建运行时。
 *
 * recorder 常驻，但数据库路径随 `PI_CODING_AGENT_DIR` 走：运行中的 recorder 连的是
 * 旧目录的库时（测试或用户改了覆盖变量），关闭旧服务与旧库后整体重建。
 */
function ensureRuntime(cwd: string): Runtime {
  const dbPath = defaultDatabasePath();
  if (runtime && runtime.dbPath !== dbPath) {
    const stale = runtime;
    runtime = null;
    dashboardStart = null;
    void quietly(() => stale.dashboardServer?.close());
    void quietly(() => stale.vendorMonitor?.stop());
    void quietly(() => stale.database.close());
  }
  return runtime ?? initRuntime(cwd);
}

/** 取得探测定时器所有权：服务所有者才持有定时任务（spec：vendor-monitoring）。 */
function ensureVendorMonitor(current: Runtime): VendorMonitor {
  if (!current.vendorMonitor) {
    current.vendorMonitor = new VendorMonitor(current.database, current.config);
    current.vendorMonitor.start();
  }
  return current.vendorMonitor;
}

/**
 * 写配置成功后热重载：重建探测定时器与账户服务，并回注 OAuth 回调地址。
 *
 * 就地替换 `runtime` 的字段而不重建整个运行时：数据库与 HTTP 服务继续复用，
 * 在途请求不受影响。解析失败直接抛给调用方（写接口据此回 400），运行时保持原样。
 */
function reloadRuntimeConfig(): void {
  const current = runtime;
  if (!current) {
    return;
  }
  const config = loadConfig();
  // 探测定时器只在服务 on 期间存在：off 后热重载不重建定时器
  if (current.vendorMonitor) {
    const vendorMonitor = new VendorMonitor(current.database, config);
    vendorMonitor.start();
    void current.vendorMonitor.stop();
    current.vendorMonitor = vendorMonitor;
  }
  const accountService = new AccountService({
    config,
    database: current.database,
    logger,
  });
  const server = current.dashboardServer;
  if (server) {
    // 端口没变：回调地址直接沿用服务自己的那份，不必再从 URL 反推
    accountService.setRedirectUri(server.redirectUri);
  }
  current.accountService = accountService;
  current.config = config;
  logger.info(
    `配置热重载：${config.vendors.length} 个供应商，${current.vendorMonitor?.activeTimerCount ?? 0} 个探测定时器`,
  );
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
 * 关闭网页与探测（`xpi-kuma off`），但保留 recorder。
 *
 * 真实用量采集独立于服务开关（spec：usage-collection）：数据库与 usageCollector
 * 不在这里关闭，`message_end` 在 off 后照常入库。顺序固定：先停 HTTP 服务，
 * 再停探测；在途时间点（pendingTiming）与 off 无关，不清空。
 * `session_shutdown` 不调用这里 —— 服务要跨会话常驻。
 */
async function stopRuntime(ctx: ExtensionContext): Promise<void> {
  const current = runtime;
  if (!current || (!current.dashboardServer && !current.vendorMonitor)) {
    ctx.ui.notify("xpi-kuma 面板已处于关闭状态", "info");
    return;
  }
  const server = current.dashboardServer;
  const monitor = current.vendorMonitor;
  current.dashboardServer = null;
  current.vendorMonitor = null;
  dashboardStart = null;
  await quietly(() => server?.close());
  await quietly(() => monitor?.stop());
  // 释放 Pi 所有权登记，独立 CLI 之后可接管（spec：独立服务停止后 Pi 接管的反向）
  quietlySync(() => clearServiceState("pi"));
  ctx.ui.notify(
    "监控面板与探测已关闭；真实用量采集不受影响（/xpi-kuma on 可重新启动）",
    "info",
  );
}

/** 清理步骤彼此独立：单步失败只记日志，不阻断后续步骤。 */
/** 同步版 quietly：单步失败只记日志。 */
function quietlySync(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    logger.error("服务状态清理失败", error);
  }
}

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
    () => ({
      accounts: current.accountService,
      cwd: current.cwd,
      reloadConfig: reloadRuntimeConfig,
      usageCollector: current.usageCollector,
      // 命令路径先经 ensureVendorMonitor，这里必然非空
      vendorMonitor: current.vendorMonitor as VendorMonitor,
    }),
    {
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
 * 事件时间点可得性核对见 `src/pi-event-timing.test.ts`（2.1 结论）；
 * 探测结论见 `docs/probe-balance-and-oauth.md`。时间点只取事件链直接观测，
 * 不用 probe、相邻记录或固定值估算。
 */

function handleMessageEnd(event: MessageEndEvent, ctx: ExtensionContext): void {
  if (!runtime || event.message.role !== "assistant") {
    return;
  }
  // 调用链结束：取走在途时间点并清空（无论是否写记录，链已终止）
  const timing = pendingTiming;
  pendingTiming = null;
  const { provider, model, stopReason, usage, timestamp: messageAt } = event.message;
  if (!usage) {
    return;
  }
  const origin = resolveUsageOrigin(ctx);
  const completedAt = Date.now();
  const record: UsageRecord = {
    completedAt,
    costCacheRead: usage.cost?.cacheRead ?? 0,
    costCacheWrite: usage.cost?.cacheWrite ?? 0,
    costInput: usage.cost?.input ?? 0,
    costOutput: usage.cost?.output ?? 0,
    costTotal: usage.cost?.total ?? 0,
    cwd: origin.cwd,
    firstTokenAt: timing?.firstTokenAt,
    model,
    provider,
    // 消息时间与完成时刻是两个时间：完成时刻取 message_end 到达观测，
    // 消息时间取 provider 报的 message.timestamp，供日志对账精确匹配。
    messageAt: typeof messageAt === "number" ? messageAt : undefined,
    resultStatus: stopReason,
    sessionId: origin.sessionId,
    source: "real_usage",
    startedAt: timing?.startedAt,
    timestamp: completedAt,
    tokensCacheRead: usage.cacheRead ?? 0,
    tokensCacheWrite: usage.cacheWrite ?? 0,
    tokensInput: usage.input ?? 0,
    tokensOutput: usage.output ?? 0,
    toolCalls: event.message.content.filter((block) => block.type === "toolCall")
      .length,
  };
  record.reconcileFingerprint = usageFingerprint(record);

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
