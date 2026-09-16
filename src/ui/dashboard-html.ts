import type { TrendSeries } from "../storage/database.ts";
import type { AggregatedStats, StatsPeriod, VendorStatus } from "../types.ts";
import { CHART_JS_CDN, dashboardClientScript } from "./dashboard-client.ts";
import { dashboardCss } from "./dashboard-css.ts";
import { escapeHtml, jsonForScript } from "./html.ts";

/** 面板渲染所需的全部数据。 */
export interface DashboardData {
  /** 数据生成时间（毫秒时间戳） */
  generatedAt: number;
  period: StatsPeriod;
  stats: AggregatedStats[];
  trend: TrendSeries[];
  vendors: VendorStatus[];
}

export interface DashboardOptions {
  /** Chart.js 脚本地址；传 null 则不加载（离线或测试） */
  chartCdn?: string | null;
}

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
 * 生成自包含的面板 HTML。
 *
 * 所有动态内容经 `escapeHtml` 或 JSON 转义后注入；供应商名称等数据不拼接进 HTML 文本。
 */
export function generateDashboardHTML(
  data: DashboardData,
  options: DashboardOptions = {},
): string {
  const chartCdn = options.chartCdn === undefined ? CHART_JS_CDN : options.chartCdn;
  const scriptTag =
    chartCdn === null
      ? "<!-- Chart.js 未加载（离线模式），趋势图降级为隐藏 -->"
      : `<script src="${escapeHtml(chartCdn)}"></script>`;
  // 无供应商时给出可操作提示，而不是让用户面对空白页
  const vendorNotice =
    data.vendors.length === 0
      ? '  <div class="kuma-empty">未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml</div>'
      : "";

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>xpi-kuma 监控面板</title>
<script>
  // 首屏前注入初始状态，避免客户端脚本读取时闪烁
  window.__kumaInitialState = ${jsonForScript(data)};
</script>
<style>
${dashboardCss()}
</style>
</head>
<body>
  <header>
    <div>
      <h1>xpi-kuma 监控面板</h1>
      <div class="kuma-generated" id="kuma-updated">更新于 ${escapeHtml(new Date(data.generatedAt).toLocaleTimeString())}</div>
    </div>
    <div class="kuma-actions">
      <button type="button" id="kuma-refresh-all">全部刷新</button>
      <button type="button" id="kuma-theme" aria-pressed="false">亮色</button>
    </div>
  </header>

  <section aria-labelledby="kuma-vendors-title">
    <h2 id="kuma-vendors-title">供应商状态</h2>
    <div id="kuma-vendors"></div>
${vendorNotice}
  </section>

  <section aria-labelledby="kuma-stats-title">
    <div class="kuma-actions">
      <h2 id="kuma-stats-title" style="margin:0">使用量统计</h2>
      <div class="kuma-actions" role="group" aria-label="时间范围">
${RANGE_LABELS.map(
  ([period, label]) =>
    `        <button type="button" data-range="${period}" aria-pressed="${String(period === data.period)}">${label}</button>`,
).join("\n")}
      </div>
    </div>
    <div id="kuma-stats"></div>
  </section>

  <section aria-labelledby="kuma-chart-title">
    <h2 id="kuma-chart-title">费用与 token 趋势</h2>
    <div class="kuma-chart-wrap">
      <canvas id="kuma-chart" role="img" aria-label="按时间的费用与 token 趋势折线图"></canvas>
    </div>
  </section>

${scriptTag}
<script>
${dashboardClientScript()}
</script>
</body>
</html>`;
}
