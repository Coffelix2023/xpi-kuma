import type { IncomingMessage, ServerResponse } from "node:http";
import { collectDiagnostics } from "../../diagnostics/inspect.ts";
import type { ApiContext, ApiRoute } from "./context.ts";
import { respond } from "./http.ts";

/**
 * 配置体检接口。
 *
 * **只读**：这里只是把 `collectDiagnostics()` 的快照交给页面，不创建模板、不写备份、
 * 不改数据库（`config-diagnostics` spec 的「只读体检」）。
 */
export const DIAGNOSTICS_ROUTES: readonly ApiRoute[] = [
  {
    handle: handleDiagnostics,
    match: (method, url) => method === "GET" && url.pathname === "/api/diagnostics",
  },
];

/** GET /api/diagnostics：配置与存储的只读快照。 */
function handleDiagnostics(
  _url: URL,
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  respond(
    res,
    200,
    "application/json; charset=utf-8",
    JSON.stringify(collectDiagnostics(ctx.cwd)),
    null,
  );
}
