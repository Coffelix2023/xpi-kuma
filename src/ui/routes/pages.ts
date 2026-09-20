import { generateDashboardHTML } from "../dashboard-html.ts";
import { generateAccountsHTML } from "../pages/accounts.ts";
import { generateEmptyHTML } from "../pages/empty.ts";
import { generateSettingsHTML } from "../pages/settings.ts";

/** 页面 shell 生成器：接收 CSP nonce，返回完整 HTML。 */
export type PageRenderer = (nonce: string) => string;

/**
 * 页面路由表：路径 → shell 生成器。
 *
 * 用 `Map` 而不是普通对象查表：对象查表会把 `__proto__` / `constructor` 这类路径
 * 解析成原型上的成员，等于给页面路由开了个后门。
 *
 * 全部页面都是**无凭据可访问的静态外壳**：不含任何监控数据与凭据 —— 凭据在 URL
 * fragment 里，首帧请求无法携带（见 `dashboard-ui` spec 的「页面外壳不含数据」）。
 * 数据接口的保护不因页面外壳开放而放松。
 */
export const PAGES: ReadonlyMap<string, PageRenderer> = new Map<string, PageRenderer>([
  [
    "/",
    (nonce: string) =>
      generateDashboardHTML({
        nonce,
      }),
  ],
  [
    "/accounts",
    (nonce: string) =>
      generateAccountsHTML({
        nonce,
      }),
  ],
  [
    "/empty",
    (nonce: string) =>
      generateEmptyHTML({
        nonce,
      }),
  ],
  [
    "/settings",
    (nonce: string) =>
      generateSettingsHTML({
        nonce,
      }),
  ],
]);
