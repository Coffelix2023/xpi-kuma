import { describe, expect, it } from "vitest";
import { NO_VENDOR_NOTICE, POLL_INTERVAL_MS } from "./dashboard-client.ts";
import { dashboardCss } from "./dashboard-css.ts";
import { generateDashboardHTML } from "./dashboard-html.ts";
import { escapeHtml, jsonForScript } from "./html.ts";
import { DARK_THEME, LIGHT_THEME, themeToCssVariables } from "./theme.ts";

describe("generateDashboardHTML 结构", () => {
  it("包含供应商卡片容器、统计表容器与趋势图 canvas", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('id="kuma-vendors"');
    expect(html).toContain('id="kuma-stats"');
    expect(html).toContain("<canvas");
    expect(html).toContain('id="kuma-chart"');
  });

  it("默认暗色主题，且色值来自 DESIGN.md 转换的 oklch token", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("--kuma-canvas: oklch(0.235 0.000 89.9)");
    expect(html).toContain("--kuma-ink: oklch(0.870 0.000 89.9)");
    // 亮色变量也在同一张表内，供主题切换直接换值
    expect(html).toContain('[data-theme="light"]');
  });

  it("提供四个时间范围按钮，默认标记 24h", () => {
    const html = generateDashboardHTML();
    for (const period of [
      "1h",
      "24h",
      "7d",
      "30d",
    ]) {
      expect(html).toContain(`data-range="${period}"`);
    }
    expect(html).toContain('data-range="24h" aria-pressed="true"');
    expect(html).toContain('data-range="7d" aria-pressed="false"');
  });

  it("默认通过 CDN 引入 Chart.js，可显式关闭", () => {
    expect(generateDashboardHTML()).toContain("cdn.jsdelivr.net/npm/chart.js@4.4.1");
    const offline = generateDashboardHTML({
      chartCdn: null,
    });
    expect(offline).not.toContain("cdn.jsdelivr.net");
  });

  it("shell 不含监控数据与访问凭据", () => {
    const html = generateDashboardHTML();
    expect(html).not.toContain("__kumaInitialState");
    expect(html).not.toContain("generatedAt");
    expect(html).not.toContain("window.__kuma");
  });

  it("含安全元数据：no-referrer 与 CSP nonce 属性", () => {
    const html = generateDashboardHTML({
      nonce: "abc123",
    });
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('<style nonce="abc123">');
    expect(html).toContain('<script nonce="abc123">');
  });
});

describe("无供应商提示占位", () => {
  it("shell 预留提示容器，文案由客户端脚本按数据填充", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('id="kuma-notice"');
    expect(html).toContain("hidden");
    expect(NO_VENDOR_NOTICE).toBe("未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml");
  });

  it("客户端脚本使用 textContent 注入提示，不做 HTML 拼接", () => {
    const html = generateDashboardHTML();
    expect(html).toContain("notice.textContent = NO_VENDOR");
  });
});

describe("客户端脚本契约", () => {
  it("凭据从 fragment 读取后立即从地址栏清除", () => {
    const html = generateDashboardHTML();
    expect(html).toContain("window.location.hash");
    expect(html).toContain("window.history.replaceState");
  });

  it("API 请求带 Authorization 头", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('"Authorization": "Bearer " + token');
  });

  it("轮询间隔为 5 秒，且隐藏时暂停、恢复时立即刷新", () => {
    expect(POLL_INTERVAL_MS).toBe(5000);
    const html = generateDashboardHTML();
    expect(html).toContain("var POLL_MS = 5000;");
    expect(html).toContain("document.hidden");
    expect(html).toContain("visibilitychange");
  });

  it("同一时刻只允许一个在途请求", () => {
    const html = generateDashboardHTML();
    expect(html).toContain("if (busy) { return Promise.resolve(false); }");
  });

  it("连接失败保留已渲染数据，只更新状态文案", () => {
    const html = generateDashboardHTML();
    expect(html).toContain("连接失败（");
    // 失败路径不重新渲染，因此不会清空现有 DOM
    const failure = html.slice(html.indexOf("function showError"));
    expect(failure.slice(0, failure.indexOf("function withBusy"))).not.toContain(
      "render(",
    );
  });

  it("探测按钮区分单供应商与全部", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('"/api/probes/" + encodeURIComponent(vendor)');
    expect(html).toContain(
      'var path = vendor ? "/api/probes/" + encodeURIComponent(vendor) : "/api/probes"',
    );
  });
});

describe("响应式契约", () => {
  it("卡片网格自动换列，表格横向滚动，图表自适应宽度", () => {
    const css = dashboardCss();
    expect(css).toContain(
      "grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))",
    );
    expect(css).toContain(".kuma-scroll { overflow-x: auto;");
    expect(css).toContain(".kuma-chart-wrap canvas { width: 100%;");
  });

  it("窄视口下减少卡片列数并压低图表高度", () => {
    const css = dashboardCss();
    expect(css).toContain("@media (max-width: 800px)");
    expect(css).toContain("minmax(180px, 1fr)");
  });

  it("hidden 属性优先于提示块的布局", () => {
    expect(dashboardCss()).toContain(".kuma-empty[hidden] { display: none; }");
  });
});

describe("注入防护", () => {
  it("escapeHtml 覆盖五个危险字符", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });

  it("jsonForScript 保留可解析性", () => {
    const value = {
      a: "<b>",
      b: [
        "</script>",
      ],
    };
    expect(JSON.parse(jsonForScript(value))).toEqual(value);
  });

  it("U+2028 / U+2029 被转义，避免截断脚本语句", () => {
    const escaped = jsonForScript({
      name: "line\u2028sep\u2029par",
    });
    expect(escaped).toContain("\\u2028");
    expect(escaped).toContain("\\u2029");
    expect(escaped).not.toContain("\u2028");
  });

  it("脚本内的动态文案经 JSON.stringify 转义", () => {
    const html = generateDashboardHTML();
    expect(html).toContain(
      'var NO_VENDOR = "未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml";',
    );
  });
});

describe("theme token", () => {
  it("两组主题色相一致、明度不同", () => {
    expect(DARK_THEME.primary).not.toBe(LIGHT_THEME.primary);
    expect(DARK_THEME.primary.split(" ").at(-1)).toBe(
      LIGHT_THEME.primary.split(" ").at(-1),
    );
  });

  it("渲染为 CSS 自定义属性且键名转为 kebab-case", () => {
    const css = themeToCssVariables(DARK_THEME);
    expect(css).toContain("--kuma-canvas:");
    expect(css).toContain("--kuma-on-accent:");
  });
});
