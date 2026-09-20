import type { ServerResponse } from "node:http";
import type { AccountService } from "../../accounts/service.ts";
import type { FileLogger } from "../../lib/log.ts";
import { escapeHtml } from "../html.ts";
import { respond } from "./http.ts";

/**
 * 处理 OAuth 回调（`GET /oauth/callback`）。
 *
 * 这是**唯一豁免 Bearer 凭据的写路径**：服务商重定向回来时不会带我们的凭据（design.md
 * D12）。因此这里强制三件事：
 *
 * 1. 只接受 `state` 命中本次发起的一次性随机值 —— 由 `AccountService` 校验，用后即焚；
 * 2. 只处理 `code` 与 `error` 两个参数，其余一概忽略；
 * 3. 只回一句结果，绝不回显授权码、令牌或供应商返回的原始错误体。
 *
 * `Host` 校验在调用方（`dashboard.ts`）完成，这里不再重复。
 */
export function handleOAuthCallback(
  url: URL,
  res: ServerResponse,
  accounts: AccountService | null,
  logger: FileLogger,
): void {
  if (!accounts) {
    respondMessage(res, 503, "账户功能未启用");
    return;
  }

  const error = url.searchParams.get("error");
  if (error) {
    logger.info(`授权被拒绝：${error}`);
    respondMessage(res, 400, `授权未完成：${escapeHtml(error)}`);
    return;
  }

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (state === "" || code === "") {
    respondMessage(res, 400, "回调缺少 state 或 code");
    return;
  }

  void accounts.completeAuthorization(state, code).then(
    (vendor) =>
      respondMessage(res, 200, `${escapeHtml(vendor)} 授权完成，可以关闭此窗口`),
    (failure: unknown) => {
      logger.error("授权回调处理失败", failure);
      respondMessage(res, 400, "授权校验失败，请回到面板重新发起");
    },
  );
}

/** 回调结果页：无脚本、无样式、无外部来源。 */
function respondMessage(res: ServerResponse, status: number, message: string): void {
  respond(
    res,
    status,
    "text/html; charset=utf-8",
    `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>xpi-kuma 授权</title></head>
<body><p>${message}</p></body>
</html>`,
    "default-src 'none'",
  );
}
