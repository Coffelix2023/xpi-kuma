import type { IncomingMessage, ServerResponse } from "node:http";
import type { UsageCollector } from "../../collectors/usage-collector.ts";
import { computeCacheHitRate, type TrendSeries } from "../../storage/database.ts";
import type {
  AggregatedStats,
  AttributionDimension,
  AttributionRow,
  CacheStats,
  EfficiencyRow,
  Insight,
  StatsPeriod,
  VendorStatus,
} from "../../types.ts";
import { DEFAULT_PERIOD } from "../dashboard-html.ts";
import { ACCOUNT_ROUTES } from "./accounts.ts";
import type { ApiContext, ApiRoute } from "./context.ts";
import { DIAGNOSTICS_ROUTES } from "./diagnostics.ts";
import { respond } from "./http.ts";
import { VENDOR_ROUTES } from "./vendors.ts";

const VALID_PERIODS: StatsPeriod[] = [
  "1h",
  "24h",
  "7d",
  "30d",
];

const PROBES_PREFIX = "/api/probes/";

/**
 * 面板数据接口的响应体。
 *
 * 各字段都有界：stats 是 `provider × model` 聚合结果，trend 最多 100 个
 * 数据点，vendors 等于配置的供应商数量。
 */
/**
 * 主面板首屏的花费概览。
 *
 * 四项都从同一份 `stats` 累加而来，保证与统计表口径一致；覆盖项目数取项目维度归因
 * 的非空分组数（「未知」是存量记录缺 cwd 的兜底分组，不算一个项目）。
 */
export interface DashboardOverview {
  costTotal: number;
  projectCount: number;
  requestCount: number;
  totalTokens: number;
}

export interface DashboardData {
  /** 归因明细；维度由请求参数决定，与统计、趋势共用同一个时间范围 */
  attribution: AttributionRow[];
  /** 缓存结构；与 stats 同源，命中率分母为零时为 null（未知） */
  cache: CacheStats;
  dimension: AttributionDimension;
  /** 真实调用效率排行；效率聚合失败时为 []（界面按「暂无真实效率数据」处理） */
  efficiency: EfficiencyRow[];
  /** 数据生成时间（毫秒时间戳） */
  generatedAt: number;
  /** 解释型建议；null 表示洞察不可用（效率聚合或洞察生成失败），基础统计不受影响 */
  insights: Insight[] | null;
  /** 首屏花费概览 */
  overview: DashboardOverview;
  period: StatsPeriod;
  stats: AggregatedStats[];
  trend: TrendSeries[];
  vendors: VendorStatus[];
}

function isPeriod(value: unknown): value is StatsPeriod {
  return typeof value === "string" && (VALID_PERIODS as string[]).includes(value);
}

/** 从统计行累加出概览四项，避免 UI 侧再算一遍口径。 */
function buildOverview(
  stats: AggregatedStats[],
  usageCollector: UsageCollector,
  period: StatsPeriod,
): DashboardOverview {
  const overview: DashboardOverview = {
    costTotal: 0,
    projectCount: 0,
    requestCount: 0,
    totalTokens: 0,
  };
  for (const row of stats) {
    overview.costTotal += row.costTotal;
    overview.requestCount += row.requestCount;
    overview.totalTokens += row.totalTokens;
  }
  overview.projectCount = usageCollector
    .getAttribution(period, "project")
    .filter((row) => row.key !== "").length;
  return overview;
}

/** 汇总缓存结构：与 stats 同源，分母为零时 hitRate 为 null（未知）。 */
function buildCache(stats: AggregatedStats[]): CacheStats {
  let cacheReadTokens = 0;
  let inputTokens = 0;
  for (const row of stats) {
    cacheReadTokens += row.tokensCacheRead;
    inputTokens += row.tokensInput;
  }
  return {
    cacheReadTokens,
    hitRate: computeCacheHitRate(inputTokens, cacheReadTokens),
    inputTokens,
  };
}

/** 汇总面板当前需要的全部数据；效率与洞察失败只降级自身。 */
function collectData(
  ctx: ApiContext,
  period: StatsPeriod,
  dimension: AttributionDimension,
): DashboardData {
  const { logger, usageCollector, vendorMonitor } = ctx;
  const stats = usageCollector.getStats(period);
  // 效率与洞察是加值区块：任一失败都只标记洞察不可用，基础总览与统计照常返回
  let efficiency: EfficiencyRow[] = [];
  let insights: Insight[] | null = null;
  try {
    efficiency = usageCollector.getEfficiency(period);
    insights = usageCollector.getInsights({
      efficiency,
      period,
      stats,
    });
  } catch (error) {
    logger.error("效率或洞察计算失败", error);
  }
  return {
    attribution: usageCollector.getAttribution(period, dimension),
    cache: buildCache(stats),
    dimension,
    efficiency,
    generatedAt: Date.now(),
    insights,
    overview: buildOverview(stats, usageCollector, period),
    period,
    stats,
    trend: usageCollector.getTrend(period),
    vendors: vendorMonitor.getVendorStatus(),
  };
}

/** GET /api/dashboard?period=&dimension= */
function handleDashboard(
  url: URL,
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  const period = url.searchParams.get("period") ?? DEFAULT_PERIOD;
  if (!isPeriod(period)) {
    respond(res, 400, "text/plain; charset=utf-8", "非法的时间范围", null);
    return;
  }
  const dimension = url.searchParams.get("dimension") ?? "project";
  if (!isDimension(dimension)) {
    respond(res, 400, "text/plain; charset=utf-8", "非法的归因维度", null);
    return;
  }
  const data = collectData(ctx, period, dimension);
  respond(res, 200, "application/json; charset=utf-8", JSON.stringify(data), null);
}

/** POST /api/probes：全部供应商探测。 */
function handleProbesAll(
  _url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  if (!ctx.originMatches(req)) {
    respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
    return;
  }
  void ctx.vendorMonitor.triggerAllProbes().then(
    () => {
      respond(
        res,
        200,
        "application/json; charset=utf-8",
        JSON.stringify({
          ok: true,
        }),
        null,
      );
    },
    (error: unknown) => {
      ctx.logger.error("面板探测失败", error);
      respond(res, 500, "text/plain; charset=utf-8", "探测失败", null);
    },
  );
}

/** POST /api/probes/<name>?model=：单供应商探测；带 model 只探测该模型，不带则全部模型。 */
function handleProbeOne(
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  if (!ctx.originMatches(req)) {
    respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
    return;
  }
  const name = decodeURIComponent(url.pathname.slice(PROBES_PREFIX.length));
  if (!ctx.vendorMonitor.vendorNames.includes(name)) {
    respond(res, 404, "text/plain; charset=utf-8", "未知的供应商", null);
    return;
  }
  const model = url.searchParams.get("model");
  if (model !== null && !ctx.vendorMonitor.vendorModels(name).includes(model)) {
    respond(res, 404, "text/plain; charset=utf-8", "未知的模型", null);
    return;
  }
  void ctx.vendorMonitor.triggerProbe(name, model ?? undefined).then(
    () => {
      respond(
        res,
        200,
        "application/json; charset=utf-8",
        JSON.stringify({
          ok: true,
        }),
        null,
      );
    },
    (error: unknown) => {
      ctx.logger.error("面板探测失败", error);
      respond(res, 500, "text/plain; charset=utf-8", "探测失败", null);
    },
  );
}
const VALID_DIMENSIONS: AttributionDimension[] = [
  "project",
  "session",
  "vendorModel",
];

function isDimension(value: unknown): value is AttributionDimension {
  return typeof value === "string" && (VALID_DIMENSIONS as string[]).includes(value);
}

/** GET /api/attribution?period=&dimension= */
function handleAttribution(
  url: URL,
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  const period = url.searchParams.get("period") ?? DEFAULT_PERIOD;
  if (!isPeriod(period)) {
    respond(res, 400, "text/plain; charset=utf-8", "非法的时间范围", null);
    return;
  }
  const dimension = url.searchParams.get("dimension") ?? "project";
  if (!isDimension(dimension)) {
    respond(res, 400, "text/plain; charset=utf-8", "非法的归因维度", null);
    return;
  }
  respond(
    res,
    200,
    "application/json; charset=utf-8",
    JSON.stringify({
      dimension,
      generatedAt: Date.now(),
      period,
      rows: ctx.usageCollector.getAttribution(period, dimension),
    }),
    null,
  );
}

/** API 路由表：按声明顺序匹配，命中即处理。 */
export const API_ROUTES: readonly ApiRoute[] = [
  {
    handle: handleAttribution,
    match: (method, url) => method === "GET" && url.pathname === "/api/attribution",
  },
  {
    handle: handleDashboard,
    match: (method, url) => method === "GET" && url.pathname === "/api/dashboard",
  },
  {
    handle: handleProbesAll,
    match: (method, url) => method === "POST" && url.pathname === "/api/probes",
  },
  {
    handle: handleProbeOne,
    match: (method, url) => method === "POST" && url.pathname.startsWith(PROBES_PREFIX),
  },
  ...ACCOUNT_ROUTES,
  ...DIAGNOSTICS_ROUTES,
  ...VENDOR_ROUTES,
];

/** 分派一个已通过凭据校验的 API 请求；返回是否命中某条路由。 */
export function handleApi(
  method: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): boolean {
  for (const route of API_ROUTES) {
    if (route.match(method, url)) {
      route.handle(url, req, res, ctx);
      return true;
    }
  }
  return false;
}
