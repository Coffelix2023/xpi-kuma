import type { ServerResponse } from "node:http";

/**
 * 统一响应：no-store、CSP、no-referrer、nosniff。
 * 页面外壳与数据接口共用同一组安全头。
 */
export function respond(
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
export function cspFor(nonce: string): string {
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
