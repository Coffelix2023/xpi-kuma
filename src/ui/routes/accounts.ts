import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountService } from "../../accounts/service.ts";
import type { ApiContext, ApiRoute } from "./context.ts";
import { respond } from "./http.ts";

/**
 * 供应商账户相关的 API 路由。
 *
 * 三条写操作（同步 / 手动填写 / 发起授权）都要求凭据 + Origin 校验（Origin 由调用方在
 * `api.ts` 的凭据校验之后交给这里判断）；读取接口只要求凭据。
 */
export const ACCOUNT_ROUTES: readonly ApiRoute[] = [
  {
    handle: handleAccounts,
    match: (method, url) => method === "GET" && url.pathname === "/api/accounts",
  },
  {
    handle: handleAccountsSync,
    match: (method, url) => method === "POST" && url.pathname === "/api/accounts/sync",
  },
  {
    handle: handleAccountsManual,
    match: (method, url) =>
      method === "POST" && url.pathname === "/api/accounts/manual",
  },
  {
    handle: handleAccountsAuthorize,
    match: (method, url) =>
      method === "POST" && url.pathname === "/api/accounts/authorize",
  },
];

/** 面板写操作请求体的上限：只传供应商名与余额，几 KB 足够。 */
const MAX_BODY_BYTES = 8 * 1024;

/** 读取 JSON 请求体；解析失败或不是对象一律返回 null，由调用方回 400。 */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // 超限即放弃这个请求，不让无界请求体占内存
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") {
        resolve(null);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        resolve(isRecord(parsed) ? parsed : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function respondJson(res: ServerResponse, payload: unknown): void {
  respond(res, 200, "application/json; charset=utf-8", JSON.stringify(payload), null);
}

function respondForbidden(res: ServerResponse): void {
  respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
}

/** 把失败原因压成一行：手动填写的失败原因来自配置写入，可能带多行 YAML 提示。 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

/** 取账户服务；未启用时回 503 并返回 null。 */
function requireAccounts(ctx: ApiContext, res: ServerResponse): AccountService | null {
  if (ctx.accounts) {
    return ctx.accounts;
  }
  respond(res, 503, "text/plain; charset=utf-8", "账户功能未启用", null);
  return null;
}

/** GET /api/accounts：余额概览 + 明细。 */
function handleAccounts(
  _url: URL,
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  const accounts = requireAccounts(ctx, res);
  if (!accounts) {
    return;
  }
  respondJson(res, accounts.getAccounts());
}

/** POST /api/accounts/sync：同步全部供应商余额。 */
function handleAccountsSync(
  _url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  if (!ctx.originMatches(req)) {
    respondForbidden(res);
    return;
  }
  const accounts = requireAccounts(ctx, res);
  if (!accounts) {
    return;
  }
  void accounts.syncAll().then(
    (payload) => respondJson(res, payload),
    (error: unknown) => {
      ctx.logger.error("余额同步失败", error);
      respond(res, 500, "text/plain; charset=utf-8", "同步失败", null);
    },
  );
}

/** POST /api/accounts/manual：写入手动填写的余额与充值。 */
function handleAccountsManual(
  _url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  if (!ctx.originMatches(req)) {
    respondForbidden(res);
    return;
  }
  const accounts = requireAccounts(ctx, res);
  if (!accounts) {
    return;
  }
  void readJsonBody(req).then((body) => {
    const vendor = readString(body?.vendor);
    const balance = readNumber(body?.balance);
    const topup = readNumber(body?.topup);
    if (vendor === "" || balance === undefined) {
      respond(res, 400, "text/plain; charset=utf-8", "缺少 vendor 或 balance", null);
      return;
    }
    try {
      respondJson(
        res,
        accounts.writeManual(
          vendor,
          topup === undefined
            ? {
                balance,
              }
            : {
                balance,
                topup,
              },
        ),
      );
    } catch (error) {
      ctx.logger.error("写入手动余额失败", error);
      respond(res, 400, "text/plain; charset=utf-8", describeError(error), null);
    }
  });
}

/** POST /api/accounts/authorize：发起 OAuth 授权并返回授权地址。 */
function handleAccountsAuthorize(
  _url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  if (!ctx.originMatches(req)) {
    respondForbidden(res);
    return;
  }
  const accounts = requireAccounts(ctx, res);
  if (!accounts) {
    return;
  }
  void readJsonBody(req).then((body) => {
    const vendor = readString(body?.vendor);
    if (vendor === "") {
      respond(res, 400, "text/plain; charset=utf-8", "缺少 vendor", null);
      return;
    }
    try {
      respondJson(res, accounts.authorize(vendor));
    } catch (error) {
      ctx.logger.error("发起授权失败", error);
      respond(res, 400, "text/plain; charset=utf-8", describeError(error), null);
    }
  });
}
