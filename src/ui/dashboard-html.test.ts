import { describe, expect, it } from "vitest";
import { NO_VENDOR_NOTICE, POLL_INTERVAL_MS } from "./dashboard-client.ts";
import { dashboardCss } from "./dashboard-css.ts";
import { generateDashboardHTML } from "./dashboard-html.ts";
import { escapeHtml, jsonForScript } from "./html.ts";

describe("generateDashboardHTML 结构", () => {
  it("包含供应商卡片容器、统计表容器与趋势图 canvas", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('id="kuma-vendors"');
    expect(html).toContain('id="kuma-stats"');
    expect(html).toContain('<div id="kuma-chart" role="img"');
    expect(html).toContain('id="kuma-chart"');
  });

  it("默认暗色主题，token 取自 THEMES.md 的家族定义", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('data-theme="dark"');
    // 默认家族的暗色背景与前景
    expect(html).toContain("--background: oklch(0.2679 0.0036 106.6427)");
    expect(html).toContain("--foreground: oklch(0.8074 0.0142 93.0137)");
    // 亮色与图鉴家族的选择器同表输出，供切换直接换值
    expect(html).toContain(':root[data-theme="light"]');
    expect(html).toContain(':root[data-family="atlas"]');
  });

  it("首帧偏好脚本位于可见内容之前", () => {
    const html = generateDashboardHTML();
    const bootstrapAt = html.indexOf("kuma.theme");
    const bodyAt = html.indexOf("<body>");
    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(-1);
    expect(bootstrapAt).toBeLessThan(bodyAt);
  });

  it("提供主题家族切换按钮", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('id="kuma-family"');
    expect(html).toContain("图鉴风");
  });

  it("首帧脚本与页内脚本共用 CSP nonce", () => {
    const html = generateDashboardHTML({
      nonce: "abc123",
    });
    expect(html.match(/nonce="abc123"/g)?.length).toBe(3);
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

  it("页面零外部引用：不加载任何 CDN 脚本", () => {
    const html = generateDashboardHTML();
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link rel=");
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
    expect(css).toContain(".kuma-chart-wrap svg { width: 100%;");
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

describe("主题家族", () => {
  it("家族专属装饰默认隐藏，仅 Atlas 下显示", () => {
    const css = dashboardCss();
    expect(css).toContain(".kuma-atlas-only { display: none; }");
    expect(css).toContain(
      '[data-family="atlas"] .kuma-atlas-only { display: revert; }',
    );
  });

  it("默认块是默认家族的暗色，Atlas 块在其后", () => {
    const css = dashboardCss();
    const defaultAt = css.indexOf("--background: oklch(0.2679 0.0036 106.6427)");
    const atlasAt = css.indexOf(':root[data-family="atlas"] {');
    expect(defaultAt).toBeGreaterThan(-1);
    expect(atlasAt).toBeGreaterThan(defaultAt);
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
