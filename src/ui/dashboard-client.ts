import { apiFragment } from "./client/api.ts";
import { bootstrapFragment, preferenceBootstrapScript } from "./client/bootstrap.ts";
import { chartFragment } from "./client/chart.ts";
import {
  ATLAS_FAMILY,
  FAMILY_KEY,
  NO_VENDOR_NOTICE,
  POLL_INTERVAL_MS,
  THEME_KEY,
} from "./client/constants.ts";
import { dashboardPageFragment } from "./client/pages/dashboard.ts";
import { pollFragment } from "./client/poll.ts";
import { renderFragment } from "./client/render.ts";

export {
  ATLAS_FAMILY,
  FAMILY_KEY,
  NO_VENDOR_NOTICE,
  POLL_INTERVAL_MS,
  preferenceBootstrapScript,
  THEME_KEY,
};

/**
 * 主面板页内脚本装配。
 *
 * 按固定顺序把 `src/ui/client/` 下各模块的脚本片段拼进同一个 IIFE：
 * bootstrap（凭据与状态）→ api（请求）→ poll（轮询）→ render（渲染）→
 * chart（图表）→ pages/dashboard（页面装配与初始化）。
 *
 * bootstrap 必须最先：后续片段都依赖它声明的状态变量。所有片段都是函数声明，
 * 在同一 IIFE 作用域内提升，因此互相调用的顺序不影响行为。
 */
export function dashboardClientScript(): string {
  return `(function () {
      "use strict";

      var POLL_MS = ${POLL_INTERVAL_MS};
      var DEFAULT_PERIOD = "24h";
      var NO_VENDOR = ${JSON.stringify(NO_VENDOR_NOTICE)};
${bootstrapFragment()}
${apiFragment()}
${pollFragment()}
${renderFragment()}
${chartFragment()}
${dashboardPageFragment()}
    })();`;
}
