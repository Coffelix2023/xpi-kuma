import type { StatsPeriod } from "../types.ts";
import { DEFAULT_PERIOD } from "./client/constants.ts";
import { i18nAria, i18nAttr, type MessageKey, zh } from "./client/messages.ts";
import { dashboardClientScript } from "./dashboard-client.ts";
import { fontControlsHtml, pageShell } from "./shell.ts";

export { DEFAULT_PERIOD };

/** 时间范围按钮的展示顺序与词条键。 */
const RANGE_LABELS: [
  StatsPeriod,
  MessageKey,
][] = [
  [
    "1h",
    "range.1h",
  ],
  [
    "24h",
    "range.24h",
  ],
  [
    "7d",
    "range.7d",
  ],
  [
    "30d",
    "range.30d",
  ],
];

/**
 * 面板标签页：面板 id 与词条键，顺序即从左到右的显示顺序，也是面板的展示顺序。
 *
 * id 同时生成 `kuma-tab-<id>` / `kuma-panel-<id>` 与 `data-tab` / `data-tab-panel`，
 * 页内脚本靠它把标签与面板配对（见 `client/nav.ts` 的 `wireTabs`）。
 */
const TABS: [
  string,
  MessageKey,
][] = [
  [
    "overview",
    "section.overview",
  ],
  [
    "stats",
    "section.stats",
  ],
  [
    "chart",
    "section.chart",
  ],
  [
    "vendors",
    "section.vendors",
  ],
];

export interface DashboardOptions {
  /** CSP nonce；缺省时不输出 nonce 属性（离线快照或测试） */
  nonce?: string;
}

/**
 * 主面板正文。
 *
 * 四个标签页从左到右是使用量总览、使用量统计、趋势与供应商总览：概览置顶（首屏一眼
 * 看出本期花了多少），其后是按 `provider × model` 的使用量统计与趋势图，供应商总览殿后。
 * 时间范围按钮位于页头 actions 行（页面级全局筛选），切换后概览、统计、趋势与供应商面板一起沿用该 period。
 *
 * 面板一次性全部渲染，切换只改可见性（见 `client/nav.ts` 的 `wireTabs`），刷新不重建 DOM。
 *
 * 所有可见文案都写成 `data-i18n` 键 + 默认中文（`zh()`），页内脚本按同一份字典切换语言。
 */
function dashboardBody(): string {
  const ranges = RANGE_LABELS.map(
    ([period, key]) =>
      `      <button type="button" data-range="${period}"${i18nAttr(key)} aria-pressed="${String(period === DEFAULT_PERIOD)}">${zh(key)}</button>`,
  ).join("\n");
  const tabs = TABS.map(
    ([id, key], index) =>
      `        <button type="button" role="tab" id="kuma-tab-${id}" aria-controls="kuma-panel-${id}" aria-selected="${String(index === 0)}" tabindex="${index === 0 ? "0" : "-1"}" data-tab="${id}"${i18nAttr(key)}>${zh(key)}</button>`,
  ).join("\n");

  return `  <header>
    <div>
      <h1${i18nAttr("page.dashboard.title")}>${zh("page.dashboard.title")}</h1>
      <div class="kuma-generated" id="kuma-updated"${i18nAttr("page.dashboard.loading")}>${zh("page.dashboard.loading")}</div>
    </div>
    <div class="kuma-actions">
      <button type="button" id="kuma-refresh-all"${i18nAttr("page.dashboard.refreshAll")}>${zh("page.dashboard.refreshAll")}</button>
      <button type="button" id="kuma-theme" data-preference aria-pressed="false"${i18nAttr("page.dashboard.toLight")}>${zh("page.dashboard.toLight")}</button>
      <select id="kuma-family" data-preference${i18nAria("page.dashboard.family")}>
        <option value="default"${i18nAttr("page.dashboard.familyDefault")}>${zh("page.dashboard.familyDefault")}</option>
        <option value="atlas"${i18nAttr("page.dashboard.familyAtlas")}>${zh("page.dashboard.familyAtlas")}</option>
      </select>
${fontControlsHtml()}
      <div class="kuma-actions" role="group"${i18nAria("aria.timeRange")}">
${ranges}
      </div>
      <button type="button" id="kuma-lang"></button>
    </div>
  </header>

  <main>
    <div class="kuma-tablist" role="tablist">
${tabs}
    </div>

    <section role="tabpanel" id="kuma-panel-overview" aria-labelledby="kuma-tab-overview" data-tab-panel="overview">
      <div id="kuma-overview"></div>
      <div id="kuma-overview-notice" hidden></div>
    </section>

    <section role="tabpanel" id="kuma-panel-stats" aria-labelledby="kuma-tab-stats" data-tab-panel="stats" hidden>
      <div id="kuma-stats"></div>
    </section>

    <section role="tabpanel" id="kuma-panel-chart" aria-labelledby="kuma-tab-chart" data-tab-panel="chart" hidden>
      <div class="kuma-chart-wrap">
        <div id="kuma-chart" role="img"${i18nAria("chart.aria")}></div>
      </div>
    </section>

    <section role="tabpanel" id="kuma-panel-vendors" aria-labelledby="kuma-tab-vendors" data-tab-panel="vendors" hidden>
      <div class="kuma-actions">
        <a class="kuma-link" data-kuma-nav="/accounts" href="/accounts"${i18nAttr("link.accounts")}>${zh("link.accounts")}</a>
        <a class="kuma-link" data-kuma-nav="/settings" href="/settings"${i18nAttr("link.settings")}>${zh("link.settings")}</a>
      </div>
      <div id="kuma-vendors"></div>
      <div id="kuma-notice" hidden></div>
    </section>
  </main>
`;
}

/**
 * 生成主面板 Web UI shell。
 *
 * shell 是纯静态结构：不含监控数据，也不含访问凭据。数据由页内脚本在
 * 读取 URL fragment 凭据后通过 `/api/dashboard` 拉取。
 */
export function generateDashboardHTML(options: DashboardOptions = {}): string {
  return pageShell({
    body: dashboardBody(),
    nonce: options.nonce,
    script: dashboardClientScript(),
    titleKey: "page.dashboard.title",
  });
}
