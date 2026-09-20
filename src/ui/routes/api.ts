import type { IncomingMessage, ServerResponse } from "node:http";
import type { UsageCollector } from "../../collectors/usage-collector.ts";
import type { FileLogger } from "../../lib/log.ts";
import type { VendorMonitor } from "../../monitors/vendor-monitor.ts";
import type { TrendSeries } from "../../storage/database.ts";
import type { AggregatedStats, StatsPeriod, VendorStatus } from "../../types.ts";
import { DEFAULT_PERIOD } from "../dashboard-html.ts";
import { respond } from "./http.ts";

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
export interface DashboardData {
  /** 数据生成时间（毫秒时间戳） */
  generatedAt: number;
  period: StatsPeriod;
  stats: AggregatedStats[];
  trend: TrendSeries[];
  vendors: VendorStatus[];
}

/** API 处理函数在运行时拿到的依赖集合。 */
export interface ApiContext {
  logger: FileLogger;
  /** 校验请求 Origin 与当前服务一致；由服务端按监听地址构造。 */
  originMatches: (req: IncomingMessage) => boolean;
  usageCollector: UsageCollector;
  vendorMonitor: VendorMonitor;
}

interface ApiRoute {
  /** 处理命中请求；只负责自身业务，不写 404。 */
  handle: (
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
    ctx: ApiContext,
  ) => void;
  /** 判断该方法与路径是否命中本路由。 */
  match: (method: string, url: URL) => boolean;
}

function isPeriod(value: unknown): value is StatsPeriod {
  return typeof value === "string" && (VALID_PERIODS as string[]).includes(value);
}

/** 汇总面板当前需要的全部数据。 */
function collectData(
  usageCollector: UsageCollector,
  vendorMonitor: VendorMonitor,
  period: StatsPeriod,
): DashboardData {
  return {
    generatedAt: Date.now(),
    period,
    stats: usageCollector.getStats(period),
    trend: usageCollector.getTrend(period),
    vendors: vendorMonitor.getVendorStatus(),
  };
}

/** GET /api/dashboard?period= */
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
  const data = collectData(ctx.usageCollector, ctx.vendorMonitor, period);
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

/** POST /api/probes/<name>：单个供应商探测。 */
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
  void ctx.vendorMonitor.triggerProbe(name).then(
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

/** API 路由表：按声明顺序匹配，命中即处理。 */
export const API_ROUTES: readonly ApiRoute[] = [
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
