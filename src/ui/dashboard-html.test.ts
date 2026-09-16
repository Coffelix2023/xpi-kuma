import { describe, expect, it } from "vitest";
import type { AggregatedStats, VendorStatus } from "../types.ts";
import type { DashboardData } from "./dashboard-html.ts";
import { generateDashboardHTML } from "./dashboard-html.ts";
import { escapeHtml, jsonForScript } from "./html.ts";
import { DARK_THEME, LIGHT_THEME, themeToCssVariables } from "./theme.ts";

const VENDOR_BASE: VendorStatus = {
  lastProbeTime: 1_700_000_000_000,
  model: "gpt-4o-mini",
  name: "OpenAI",
  status: "up",
  totalTime: 450,
  ttft: 230,
  price: {
    input: 0.15,
    output: 0.6,
  },
};

const STATS_BASE: AggregatedStats = {
  costCacheRead: 0,
  costCacheWrite: 0,
  costInput: 0.001,
  costOutput: 0.002,
  costTotal: 0.003,
  model: "gpt-4o-mini",
  period: "24h",
  provider: "openai",
  requestCount: 3,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  tokensInput: 300,
  tokensOutput: 150,
  totalTokens: 450,
};

const DASHBOARD_BASE: DashboardData = {
  generatedAt: 1_700_000_000_000,
  period: "24h",
  stats: [
    STATS_BASE,
  ],
  trend: [
    {
      bucketStart: 1_700_000_000_000,
      cost: 0.003,
      tokens: 450,
      byProvider: {
        openai: 0.003,
      },
    },
  ],
  vendors: [
    VENDOR_BASE,
  ],
};

function vendor(overrides: Partial<VendorStatus> = {}): VendorStatus {
  return {
    ...VENDOR_BASE,
    ...overrides,
  };
}

function data(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    ...DASHBOARD_BASE,
    ...overrides,
  };
}

describe("generateDashboardHTML 结构", () => {
  it("包含供应商卡片容器、统计表容器与趋势图 canvas", () => {
    const html = generateDashboardHTML(data());
    expect(html).toContain('id="kuma-vendors"');
    expect(html).toContain('id="kuma-stats"');
    expect(html).toContain("<canvas");
    expect(html).toContain('id="kuma-chart"');
  });

  it("默认暗色主题，且色值来自 DESIGN.md 转换的 oklch token", () => {
    const html = generateDashboardHTML(data());
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("--kuma-canvas: oklch(0.235 0.000 89.9)");
    expect(html).toContain("--kuma-ink: oklch(0.870 0.000 89.9)");
    // 亮色变量也在同一张表内，供主题切换直接换值
    expect(html).toContain('[data-theme="light"]');
  });

  it("提供四个时间范围按钮，并按当前范围标记 aria-pressed", () => {
    const html = generateDashboardHTML(
      data({
        period: "7d",
      }),
    );
    for (const period of [
      "1h",
      "24h",
      "7d",
      "30d",
    ]) {
      expect(html).toContain(`data-range="${period}"`);
    }
    expect(html).toContain('data-range="7d" aria-pressed="true"');
    expect(html).toContain('data-range="24h" aria-pressed="false"');
  });

  it("默认通过 CDN 引入 Chart.js，可显式关闭", () => {
    expect(generateDashboardHTML(data())).toContain(
      "cdn.jsdelivr.net/npm/chart.js@4.4.1",
    );
    const offline = generateDashboardHTML(data(), {
      chartCdn: null,
    });
    expect(offline).not.toContain("cdn.jsdelivr.net");
  });

  it("把初始数据注入为 JSON，供首屏渲染", () => {
    const html = generateDashboardHTML(data());
    expect(html).toContain("window.__kumaInitialState = ");
    expect(html).toContain('"generatedAt":1700000000000');
  });
});

describe("无供应商", () => {
  it("显示可操作提示而非空白页", () => {
    const html = generateDashboardHTML(
      data({
        stats: [],
        trend: [],
        vendors: [],
      }),
    );
    expect(html).toContain("未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml");
  });

  it("有供应商时不显示提示", () => {
    expect(generateDashboardHTML(data())).not.toContain("未配置任何供应商");
  });
});

describe("注入防护", () => {
  it("供应商名称中的 HTML 不会逃逸出 JSON 上下文", () => {
    const evil = '</script><img src=x onerror="boom()">';
    const html = generateDashboardHTML(
      data({
        vendors: [
          vendor({
            model: evil,
            name: evil,
          }),
        ],
      }),
    );

    // HTML 解析器只认字面量 `<`，转义 `<` 后 `</script` 序列已不可能出现
    const jsonBlock = html.slice(
      html.indexOf("window.__kumaInitialState"),
      html.indexOf("</script>"),
    );
    expect(jsonBlock).not.toContain("</script");
    expect(jsonBlock).not.toContain("<img");
    expect(jsonBlock).toContain("\\u003c/script");
  });

  it("U+2028 / U+2029 被转义，避免截断脚本语句", () => {
    const html = generateDashboardHTML(
      data({
        vendors: [
          vendor({
            name: "line\u2028sep\u2029par",
          }),
        ],
      }),
    );
    expect(html).toContain("\\u2028");
    expect(html).toContain("\\u2029");
    expect(html).not.toContain("\u2028");
  });

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
