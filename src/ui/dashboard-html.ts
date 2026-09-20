import type { StatsPeriod } from "../types.ts";
import { DEFAULT_PERIOD } from "./client/constants.ts";
import { i18nAria, i18nAttr, type MessageKey, zh } from "./client/messages.ts";
import { dashboardClientScript } from "./dashboard-client.ts";
import { pageShell } from "./shell.ts";

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

/** 归因维度按钮的取值与词条键。 */
const DIMENSION_LABELS: [
  string,
  MessageKey,
][] = [
  [
    "project",
    "dimension.project",
  ],
  [
    "session",
    "dimension.session",
  ],
  [
    "vendorModel",
    "dimension.vendorModel",
  ],
];

/**
 * 分区索引轨的条目：目标区块 id 与词条键。
 *
 * 只在 Atlas 家族下显示（`.kuma-atlas-only`），窄视口由媒体查询隐藏；顺序与正文
 * 区块顺序一致，点击后由页内脚本滚动定位并更新 `aria-current`。
 */
const RAIL_SECTIONS: [
  string,
  MessageKey,
][] = [
  [
    "section-overview",
    "section.overview",
  ],
  [
    "section-attribution",
    "section.attribution",
  ],
  [
    "section-stats",
    "section.stats",
  ],
  [
    "section-chart",
    "section.chart",
  ],
  [
    "section-vendors",
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
 * 区块顺序即信息层级（tasks.md 6.4）：花费概览置顶（首屏一眼看出本期花了多少），
 * 其后是归因明细、按 `provider × model` 的使用量统计、趋势图，供应商健康降为次级块。
 * 时间范围按钮随概览一起放在首屏，切换后概览、归因、统计与趋势一起刷新。
 *
 * 正文与右侧分区索引轨并排：索引轨只在 Atlas 家族下显示，窄视口由媒体查询隐藏。
 *
 * 所有可见文案都写成 `data-i18n` 键 + 默认中文（`zh()`），页内脚本按同一份字典切换语言。
 */
function dashboardBody(): string {
  const ranges = RANGE_LABELS.map(
    ([period, key]) =>
      `        <button type="button" data-range="${period}"${i18nAttr(key)} aria-pressed="${String(period === DEFAULT_PERIOD)}">${zh(key)}</button>`,
  ).join("\n");
  const dimensions = DIMENSION_LABELS.map(
    ([dimension, key]) =>
      `            <button type="button" data-dimension="${dimension}"${i18nAttr(key)} aria-pressed="${String(dimension === "project")}">${zh(key)}</button>`,
  ).join("\n");
  const rail = RAIL_SECTIONS.map(
    ([id, key]) =>
      `      <a href="#${id}" data-rail-target="${id}"${i18nAttr(key)}>${zh(key)}</a>`,
  ).join("\n");

  return `  <header>
    <div>
      <h1${i18nAttr("page.dashboard.title")}>${zh("page.dashboard.title")}</h1>
      <div class="kuma-generated" id="kuma-updated"${i18nAttr("page.dashboard.loading")}>${zh("page.dashboard.loading")}</div>
    </div>
    <div class="kuma-actions">
      <button type="button" id="kuma-refresh-all"${i18nAttr("page.dashboard.refreshAll")}>${zh("page.dashboard.refreshAll")}</button>
      <button type="button" id="kuma-theme" aria-pressed="false"${i18nAttr("page.dashboard.toLight")}>${zh("page.dashboard.toLight")}</button>
      <button type="button" id="kuma-family" aria-pressed="false"${i18nAttr("page.dashboard.toAtlas")}>${zh("page.dashboard.toAtlas")}</button>
      <button type="button" id="kuma-lang"></button>
    </div>
  </header>

  <div class="kuma-layout">
    <main>
      <section id="section-overview" aria-labelledby="kuma-overview-title">
        <div class="kuma-actions kuma-section-head">
          <h2 id="kuma-overview-title" style="margin:0"${i18nAttr("section.overview")}>${zh("section.overview")}</h2>
          <div class="kuma-actions" role="group"${i18nAria("aria.timeRange")}>
${ranges}
          </div>
        </div>
        <div id="kuma-overview"></div>
        <div id="kuma-overview-notice" hidden></div>
      </section>

      <section id="section-attribution" aria-labelledby="kuma-attribution-title">
        <div class="kuma-actions kuma-section-head">
          <h2 id="kuma-attribution-title" style="margin:0"${i18nAttr("section.attribution")}>${zh("section.attribution")}</h2>
          <div class="kuma-actions" role="group"${i18nAria("aria.dimension")}>
${dimensions}
          </div>
        </div>
        <div id="kuma-attribution"></div>
      </section>

      <section id="section-stats" aria-labelledby="kuma-stats-title">
        <h2 id="kuma-stats-title"${i18nAttr("section.stats")}>${zh("section.stats")}</h2>
        <div id="kuma-stats"></div>
      </section>

      <section id="section-chart" aria-labelledby="kuma-chart-title">
        <h2 id="kuma-chart-title"${i18nAttr("section.chart")}>${zh("section.chart")}</h2>
        <div class="kuma-chart-wrap">
          <div id="kuma-chart" role="img"${i18nAria("chart.aria")}></div>
        </div>
      </section>

      <section id="section-vendors" aria-labelledby="kuma-vendors-title">
        <div class="kuma-actions kuma-section-head">
          <h2 id="kuma-vendors-title" style="margin:0"${i18nAttr("section.vendors")}>${zh("section.vendors")}</h2>
          <div class="kuma-actions">
            <a class="kuma-link" data-kuma-nav="/accounts" href="/accounts"${i18nAttr("link.accounts")}>${zh("link.accounts")}</a>
            <a class="kuma-link" data-kuma-nav="/settings" href="/settings"${i18nAttr("link.settings")}>${zh("link.settings")}</a>
          </div>
        </div>
        <div id="kuma-vendors"></div>
        <div id="kuma-notice" hidden></div>
      </section>
    </main>

    <nav class="kuma-rail kuma-atlas-only"${i18nAria("aria.rail")}>
${rail}
    </nav>
  </div>
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
