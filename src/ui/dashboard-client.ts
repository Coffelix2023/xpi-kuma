import { apiFragment } from "./client/api.ts";
import { bootstrapFragment, preferenceBootstrapScript } from "./client/bootstrap.ts";
import { chartFragment } from "./client/chart.ts";
import {
  DEFAULT_PERIOD,
  NO_VENDOR_NOTICE,
  POLL_INTERVAL_MS,
} from "./client/constants.ts";
import { navFragment } from "./client/nav.ts";
import { overviewFragment } from "./client/overview.ts";
import { accountsPageFragment } from "./client/pages/accounts.ts";
import { dashboardPageFragment } from "./client/pages/dashboard.ts";
import { pollFragment } from "./client/poll.ts";
import { renderFragment } from "./client/render.ts";

export { NO_VENDOR_NOTICE, POLL_INTERVAL_MS, preferenceBootstrapScript };

/**
 * 主面板页内脚本装配。
 *
 * 按固定顺序把 `src/ui/client/` 下各模块的脚本片段拼进同一个 IIFE：
 * bootstrap（凭据与状态）→ api（请求）→ poll（轮询）→ nav（站内链接）→
 * render（渲染）→ chart（图表）→ pages/dashboard（页面装配与初始化）。
 *
 * bootstrap 必须最先：后续片段都依赖它声明的状态变量。所有片段都是函数声明，
 * 在同一 IIFE 作用域内提升，因此互相调用的顺序不影响行为。
 */
export function dashboardClientScript(): string {
  return `(function () {
      "use strict";

      var POLL_MS = ${POLL_INTERVAL_MS};
      var DEFAULT_PERIOD = ${JSON.stringify(DEFAULT_PERIOD)};
      var NO_VENDOR = ${JSON.stringify(NO_VENDOR_NOTICE)};
${bootstrapFragment()}
${apiFragment()}
${pollFragment()}
${navFragment()}
${renderFragment()}
${overviewFragment()}
${chartFragment()}
${dashboardPageFragment()}
    })();`;
}

/**
 * 子页面共用的页内脚本。
 *
 * 子页面与主面板同源、共用一套凭据与偏好，但不需要主面板那套数据渲染与轮询：
 * 只需要读凭据、把站内链接补上 fragment，以及在缺少凭据时给出可操作提示而
 * 不是留一个空白页。
 */
/**
 * 账户页的页内脚本。
 *
 * 与主面板共用凭据、请求与轮询片段，数据范围只有账户接口：渲染概览与明细表，
 * 并按 spec 要求沿用同一套「可见性感知轮询 + 失败不重试」的行为。
 */
export function accountsClientScript(): string {
  return `(function () {
      "use strict";

      var POLL_MS = ${POLL_INTERVAL_MS};
      var DEFAULT_PERIOD = ${JSON.stringify(DEFAULT_PERIOD)};
      var NO_VENDOR = ${JSON.stringify(NO_VENDOR_NOTICE)};
${bootstrapFragment()}
${apiFragment()}
${pollFragment()}
${navFragment()}
${renderFragment()}
${accountsPageFragment()}
    })();`;
}

export function sharedClientScript(): string {
  return `(function () {
      "use strict";

      var DEFAULT_PERIOD = ${JSON.stringify(DEFAULT_PERIOD)};
${bootstrapFragment()}
${navFragment()}
      if (!token) {
        setStatus("缺少访问凭据，请重新执行 /xpi-kuma");
        return;
      }
      wireNav();
    })();`;
}
