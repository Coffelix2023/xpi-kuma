import { apiFragment } from "./client/api.ts";
import { bootstrapFragment, preferenceBootstrapScript } from "./client/bootstrap.ts";
import { chartFragment } from "./client/chart.ts";
import { DEFAULT_PERIOD, POLL_INTERVAL_MS } from "./client/constants.ts";
import { fontScaleFragment } from "./client/font.ts";
import { i18nFragment } from "./client/i18n.ts";
import { navFragment } from "./client/nav.ts";
import { overviewFragment } from "./client/overview.ts";
import { accountsPageFragment } from "./client/pages/accounts.ts";
import { dashboardPageFragment } from "./client/pages/dashboard.ts";
import { emptyPageFragment } from "./client/pages/empty.ts";
import { settingsPageFragment } from "./client/pages/settings.ts";
import { pollFragment } from "./client/poll.ts";
import { renderFragment } from "./client/render.ts";

export { POLL_INTERVAL_MS, preferenceBootstrapScript };

/**
 * 页面脚本的公共装配。
 *
 * 四个页面的脚本只有最后一段（页面装配）不同，其余片段与顺序完全一致：
 * bootstrap（凭据与状态）→ api（请求）→ poll（轮询）→ nav（站内链接）→
 * i18n（双语字典与切换）→ font（字号档位）→ render（渲染工具）→ 页面片段。
 *
 * bootstrap 必须最先：后续片段都依赖它声明的状态变量；i18n 的 `applyLanguage`
 * 在片段末尾立即执行，因此要排在 DOM 就绪之后（脚本本就在 `</body>` 前）。
 * 所有片段都是函数声明，在同一 IIFE 作用域内提升，互相调用与顺序无关。
 */
function pageScript(pageFragment: string): string {
  return `(function () {
      "use strict";

      var POLL_MS = ${POLL_INTERVAL_MS};
      var DEFAULT_PERIOD = ${JSON.stringify(DEFAULT_PERIOD)};
${bootstrapFragment()}
${apiFragment()}
${pollFragment()}
${navFragment()}
${i18nFragment()}
${fontScaleFragment()}
${renderFragment()}
${pageFragment}
    })();`;
}

/** 主面板页内脚本。 */
export function dashboardClientScript(): string {
  return pageScript(
    [
      overviewFragment(),
      chartFragment(),
      dashboardPageFragment(),
    ].join("\n"),
  );
}

/** 账户页的页内脚本：数据只来自账户接口。 */
export function accountsClientScript(): string {
  return pageScript(accountsPageFragment());
}

/** 配置体检页的页内脚本：数据只来自 `/api/diagnostics`，页面不产生任何写盘操作。 */
export function settingsClientScript(): string {
  return pageScript(settingsPageFragment());
}

/** 零数据引导页的页内脚本：复用主面板接口判断空态分支。 */
export function emptyClientScript(): string {
  return pageScript(emptyPageFragment());
}

/**
 * 只读也够用的最小脚本：读凭据 + 补站内链接的 fragment。
 *
 * 供不需要数据的第三方外壳使用（当前四个页面都各有一套完整脚本）。
 */
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
