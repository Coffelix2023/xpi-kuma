import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AccountService } from "../accounts/service.ts";
import type { UsageCollector } from "../collectors/usage-collector.ts";
import { FileLogger } from "../lib/log.ts";
import type { VendorMonitor } from "../monitors/vendor-monitor.ts";
import { handleApi } from "./routes/api.ts";
import { cspFor, respond } from "./routes/http.ts";
import { handleOAuthCallback } from "./routes/oauth.ts";
import { PAGES } from "./routes/pages.ts";

/** 只监听 IPv4 回环，不暴露局域网或公网，见 dashboard-ui spec。 */
const LOOPBACK = "127.0.0.1";

/** 访问凭据熵：256 位随机数，编码后 43 个字符。 */
const TOKEN_BYTES = 32;

/** CSP nonce 熵：128 位。 */
const NONCE_BYTES = 16;

/** `close()` 的最长等待：超时后强制断开在途连接，不阻塞 Pi 退出。 */
const CLOSE_TIMEOUT_MS = 1000;

/** 页内脚本从 URL fragment 取凭据，请求头里带这个前缀。 */
const BEARER_PREFIX = "Bearer ";

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

/**
 * 启动本会话的监控 Web 服务。
 *
 * 绑定 `127.0.0.1` 的随机端口。请求分两段处理：
 *
 * 1. **页面外壳**（`routes/pages.ts` 的表）：无凭据可访问，但只返回不含任何数据与
 *    凭据的静态结构 —— 凭据在 URL fragment 里，首帧请求无法携带。
 * 2. **数据接口**（`routes/api.ts` 的表）：一律要求本次启动生成的 Bearer 凭据，
 *    修改类请求额外校验 `Origin`。
 *
 * 本文件只保留启动、凭据、Host/Origin 校验、CSP 与关闭逻辑。
 */
export async function startDashboardServer(
  usageCollector: UsageCollector,
  vendorMonitor: VendorMonitor,
  /** 账户服务；未启用时传 null，账户接口回 503 */
  accountService: AccountService | null = null,
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
  // 端口此刻才确定，授权回调地址只能在监听成功后注入
  accountService?.setRedirectUri(`http://${host}/oauth/callback`);

  function handle(req: IncomingMessage, res: ServerResponse): void {
    // 严格 Host 校验：阻断 DNS rebinding 之类的跨源访问
    if (req.headers.host !== host) {
      respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";

    // OAuth 回调是唯一豁免 Bearer 的写路径：服务商重定向不带我们的凭据，
    // 改由一次性 state 校验把关（Host 校验已在上一步完成）
    if (method === "GET" && url.pathname === "/oauth/callback") {
      handleOAuthCallback(url, res, accountService, getLogger());
      return;
    }

    // 页面外壳只含静态结构，凭据在 fragment 里，首次请求无法携带
    const renderPage = method === "GET" ? PAGES.get(url.pathname) : undefined;
    if (renderPage) {
      const nonce = randomBytes(NONCE_BYTES).toString("base64");
      respond(res, 200, "text/html; charset=utf-8", renderPage(nonce), cspFor(nonce));
      return;
    }

    if (!authorized(req, token)) {
      respond(res, 401, "text/plain; charset=utf-8", "未授权", null);
      return;
    }

    const handled = handleApi(method, url, req, res, {
      accounts: accountService,
      logger: getLogger(),
      originMatches: (request) => sameOrigin(request, host),
      usageCollector,
      vendorMonitor,
    });
    if (!handled) {
      respond(res, 404, "text/plain; charset=utf-8", "未找到", null);
    }
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
