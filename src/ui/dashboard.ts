import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { UsageCollector } from "../collectors/usage-collector.ts";
import { FileLogger } from "../lib/log.ts";
import type { VendorMonitor } from "../monitors/vendor-monitor.ts";
import type { TrendSeries } from "../storage/database.ts";
import type { AggregatedStats, StatsPeriod, VendorStatus } from "../types.ts";
import { DEFAULT_PERIOD, generateDashboardHTML } from "./dashboard-html.ts";

/** 只监听 IPv4 回环，不暴露局域网或公网，见 dashboard-ui spec。 */
const LOOPBACK = "127.0.0.1";

/** 访问凭据熵：256 位随机数，编码后 43 个字符。 */
const TOKEN_BYTES = 32;

/** CSP nonce 熵：128 位。 */
const NONCE_BYTES = 16;

/** `close()` 的最长等待：超时后强制断开在途连接，不阻塞 Pi 退出。 */
const CLOSE_TIMEOUT_MS = 1000;

const VALID_PERIODS: StatsPeriod[] = [
  "1h",
  "24h",
  "7d",
  "30d",
];

const PROBES_PREFIX = "/api/probes/";

/** 页内脚本从 URL fragment 取凭据，请求头里带这个前缀。 */
const BEARER_PREFIX = "Bearer ";

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

export interface DashboardServer {
  /** 关闭监听并释放端口；可重复调用 */
  close(): Promise<void>;
  /** 操作系统分配的随机端口 */
  readonly port: number;
  /** 本次服务启动生成的一次性访问凭据 */
  readonly token: string;
  /** 交给浏览器打开的本机地址，凭据放在 fragment 中 */
  readonly url: string;
}

let logger: FileLogger | null = null;

function getLogger(): FileLogger {
  logger ??= new FileLogger(`${getAgentDir()}/data/xpi-kuma/xpi-kuma.log`);
  return logger;
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

/**
 * 启动本会话的监控 Web 服务。
 *
 * 绑定 `127.0.0.1` 的随机端口，页面与数据接口分离：根页面只返回静态 shell，
 * 其余接口一律要求本次启动生成的 Bearer 凭据。
 */
export async function startDashboardServer(
  usageCollector: UsageCollector,
  vendorMonitor: VendorMonitor,
): Promise<DashboardServer> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      getLogger().error("面板请求处理失败", error);
      if (!res.headersSent) {
        respond(res, 500, "text/plain; charset=utf-8", "内部错误", null);
      }
    }
  });

  await listen(server);
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const host = `${LOOPBACK}:${port}`;

  function handle(req: IncomingMessage, res: ServerResponse): void {
    // 严格 Host 校验：阻断 DNS rebinding 之类的跨源访问
    if (req.headers.host !== host) {
      respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";

    // 根页面只含静态 shell，凭据在 fragment 里，首次请求无法携带
    if (method === "GET" && url.pathname === "/") {
      const nonce = randomBytes(NONCE_BYTES).toString("base64");
      const html = generateDashboardHTML({
        nonce,
      });
      respond(res, 200, "text/html; charset=utf-8", html, cspFor(nonce));
      return;
    }

    if (!authorized(req, token)) {
      respond(res, 401, "text/plain; charset=utf-8", "未授权", null);
      return;
    }

    if (method === "GET" && url.pathname === "/api/dashboard") {
      const period = url.searchParams.get("period") ?? DEFAULT_PERIOD;
      if (!isPeriod(period)) {
        respond(res, 400, "text/plain; charset=utf-8", "非法的时间范围", null);
        return;
      }
      const data = collectData(usageCollector, vendorMonitor, period);
      respond(res, 200, "application/json; charset=utf-8", JSON.stringify(data), null);
      return;
    }

    if (method === "POST" && url.pathname === "/api/probes") {
      if (!sameOrigin(req, host)) {
        respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
        return;
      }
      void vendorMonitor.triggerAllProbes().then(
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
          getLogger().error("面板探测失败", error);
          respond(res, 500, "text/plain; charset=utf-8", "探测失败", null);
        },
      );
      return;
    }

    if (method === "POST" && url.pathname.startsWith(PROBES_PREFIX)) {
      if (!sameOrigin(req, host)) {
        respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
        return;
      }
      const name = decodeURIComponent(url.pathname.slice(PROBES_PREFIX.length));
      if (!vendorMonitor.vendorNames.includes(name)) {
        respond(res, 404, "text/plain; charset=utf-8", "未知的供应商", null);
        return;
      }
      void vendorMonitor.triggerProbe(name).then(
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
          getLogger().error("面板探测失败", error);
          respond(res, 500, "text/plain; charset=utf-8", "探测失败", null);
        },
      );
      return;
    }

    respond(res, 404, "text/plain; charset=utf-8", "未找到", null);
  }

  return {
    close: idempotentClose(server),
    port,
    token,
    url: `http://${host}/#${token}`,
  };
}

/** 关闭监听并等待连接清空；超时则强制断开，避免 Pi 退出被浏览器标签页拖住。 */
function idempotentClose(server: ReturnType<typeof createServer>): () => Promise<void> {
  let closing: Promise<void> | null = null;
  return () => {
    closing ??= new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        server.closeAllConnections();
        resolve();
      }, CLOSE_TIMEOUT_MS);
      timer.unref?.();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      // keep-alive 的空闲连接会拖住 server.close()，直接断掉
      server.closeIdleConnections();
    });
    return closing;
  };
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      {
        host: LOOPBACK,
        port: 0,
      },
      () => {
        server.removeListener("error", reject);
        resolve();
      },
    );
  });
}

/** 固定长度常量时间比较，避免凭据被逐字节试探。 */
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith(BEARER_PREFIX)) {
    return false;
  }
  const provided = Buffer.from(header.slice(BEARER_PREFIX.length));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

/** 修改状态的请求必须来自本服务自身页面。 */
function sameOrigin(req: IncomingMessage, host: string): boolean {
  return req.headers.origin === `http://${host}`;
}

function respond(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  csp: string | null,
): void {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": csp ?? "default-src 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

/** 只放行页面自身：脚本与样式都经 nonce 授权，不允许任何外部来源。 */
function cspFor(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
