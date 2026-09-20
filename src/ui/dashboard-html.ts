import type { StatsPeriod } from "../types.ts";
import { DEFAULT_PERIOD } from "./client/constants.ts";
import { dashboardClientScript } from "./dashboard-client.ts";
import { pageShell } from "./shell.ts";

export { DEFAULT_PERIOD };

/** 时间范围按钮的展示顺序与文案。 */
const RANGE_LABELS: [
  StatsPeriod,
  string,
][] = [
  [
    "1h",
    "1小时",
  ],
  [
    "24h",
    "24小时",
  ],
  [
    "7d",
    "7天",
  ],
  [
    "30d",
    "30天",
  ],
];

/**
 * 分区索引轨的条目：目标区块 id 与文案。
 *
 * 只在 Atlas 家族下显示（`.kuma-atlas-only`），窄视口由媒体查询隐藏；顺序与正文
 * 区块顺序一致，点击后由页内脚本滚动定位并更新 `aria-current`。
 */
const RAIL_SECTIONS: [
  string,
  string,
][] = [
  [
    "section-overview",
    "花费概览",
  ],
  [
    "section-attribution",
    "用量归因",
  ],
  [
    "section-stats",
    "使用量统计",
  ],
  [
    "section-chart",
    "费用与 token 趋势",
  ],
  [
    "section-vendors",
    "供应商健康",
  ],
];

export interface DashboardOptions {
  /** CSP nonce；缺省时不输出 nonce 属性（离线快照或测试） */
  nonce?: string;
}

/** 主面板正文：头部（全部刷新与主题/家族按钮）与三个数据区块。 */
/**
 * 主面板正文。
 *
 * 区块顺序即信息层级（tasks.md 6.4）：花费概览置顶（首屏一眼看出本期花了多少），
 * 其后是归因明细、按 `provider × model` 的使用量统计、趋势图，供应商健康降为次级块。
 * 时间范围按钮随概览一起放在首屏，切换后概览、归因、统计与趋势一起刷新。
 *
 * 正文与右侧分区索引轨并排：索引轨只在 Atlas 家族下显示，窄视口由媒体查询隐藏。
 */
function dashboardBody(): string {
  const ranges = RANGE_LABELS.map(
    ([period, label]) =>
      `        <button type="button" data-range="${period}" aria-pressed="${String(period === DEFAULT_PERIOD)}">${label}</button>`,
  ).join("\n");
  const rail = RAIL_SECTIONS.map(
    ([id, label]) => `      <a href="#${id}" data-rail-target="${id}">${label}</a>`,
  ).join("\n");

  return `  <header>
    <div>
      <h1>xpi-kuma 监控面板</h1>
      <div class="kuma-generated" id="kuma-updated">正在加载…</div>
    </div>
    <div class="kuma-actions">
      <button type="button" id="kuma-refresh-all">全部刷新</button>
      <button type="button" id="kuma-theme" aria-pressed="false">亮色</button>
      <button type="button" id="kuma-family" aria-pressed="false">图鉴风</button>
    </div>
  </header>

  <div class="kuma-layout">
    <main>
      <section id="section-overview" aria-labelledby="kuma-overview-title">
        <div class="kuma-actions kuma-section-head">
          <h2 id="kuma-overview-title" style="margin:0">花费概览</h2>
          <div class="kuma-actions" role="group" aria-label="时间范围">
${ranges}
          </div>
        </div>
        <div id="kuma-overview"></div>
        <div id="kuma-overview-notice" hidden></div>
      </section>

      <section id="section-attribution" aria-labelledby="kuma-attribution-title">
        <div class="kuma-actions kuma-section-head">
          <h2 id="kuma-attribution-title" style="margin:0">用量归因</h2>
          <div class="kuma-actions" role="group" aria-label="归因维度">
            <button type="button" data-dimension="project" aria-pressed="true">项目</button>
            <button type="button" data-dimension="session" aria-pressed="false">会话</button>
            <button type="button" data-dimension="vendorModel" aria-pressed="false">供应商·模型</button>
          </div>
        </div>
        <div id="kuma-attribution"></div>
      </section>

      <section id="section-stats" aria-labelledby="kuma-stats-title">
        <h2 id="kuma-stats-title">使用量统计</h2>
        <div id="kuma-stats"></div>
      </section>

      <section id="section-chart" aria-labelledby="kuma-chart-title">
        <h2 id="kuma-chart-title">费用与 token 趋势</h2>
        <div class="kuma-chart-wrap">
          <div id="kuma-chart" role="img" aria-label="按时间的费用与 token 趋势折线图"></div>
        </div>
      </section>

      <section id="section-vendors" aria-labelledby="kuma-vendors-title">
        <div class="kuma-actions kuma-section-head">
          <h2 id="kuma-vendors-title" style="margin:0">供应商健康</h2>
          <div class="kuma-actions">
            <a class="kuma-link" data-kuma-nav="/accounts" href="/accounts">账户详情</a>
            <a class="kuma-link" data-kuma-nav="/settings" href="/settings">配置体检</a>
          </div>
        </div>
        <div id="kuma-vendors"></div>
        <div id="kuma-notice" hidden></div>
      </section>
    </main>

    <nav class="kuma-rail kuma-atlas-only" aria-label="分区索引">
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
    title: "xpi-kuma 监控面板",
  });
}
