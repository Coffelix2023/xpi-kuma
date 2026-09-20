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

export interface DashboardOptions {
  /** CSP nonce；缺省时不输出 nonce 属性（离线快照或测试） */
  nonce?: string;
}

/** 主面板正文：头部（全部刷新与主题/家族按钮）与三个数据区块。 */
function dashboardBody(): string {
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

  <section aria-labelledby="kuma-vendors-title">
    <div class="kuma-actions">
      <h2 id="kuma-vendors-title" style="margin:0">供应商状态</h2>
      <div class="kuma-actions">
        <a class="kuma-link" data-kuma-nav="/accounts" href="/accounts">账户详情</a>
        <a class="kuma-link" data-kuma-nav="/settings" href="/settings">配置体检</a>
      </div>
    </div>
    <div id="kuma-vendors"></div>
    <div id="kuma-notice" hidden></div>
  </section>

  <section aria-labelledby="kuma-stats-title">
    <div class="kuma-actions">
      <h2 id="kuma-stats-title" style="margin:0">使用量统计</h2>
      <div class="kuma-actions" role="group" aria-label="时间范围">
${RANGE_LABELS.map(
  ([period, label]) =>
    `        <button type="button" data-range="${period}" aria-pressed="${String(period === DEFAULT_PERIOD)}">${label}</button>`,
).join("\n")}
      </div>
    </div>
    <div id="kuma-stats"></div>
  </section>

  <section aria-labelledby="kuma-chart-title">
    <h2 id="kuma-chart-title">费用与 token 趋势</h2>
    <div class="kuma-chart-wrap">
      <div id="kuma-chart" role="img" aria-label="按时间的费用与 token 趋势折线图"></div>
    </div>
  </section>
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
