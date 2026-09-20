import { describe, expect, it } from "vitest";
import { MESSAGES } from "./client/messages.ts";
import {
  accountsClientScript,
  dashboardClientScript,
  emptyClientScript,
  POLL_INTERVAL_MS,
  settingsClientScript,
} from "./dashboard-client.ts";
import { dashboardCss } from "./dashboard-css.ts";
import { generateDashboardHTML } from "./dashboard-html.ts";
import { escapeHtml, jsonForScript } from "./html.ts";
import { generateAccountsHTML } from "./pages/accounts.ts";
import { generateEmptyHTML } from "./pages/empty.ts";
import { generateSettingsHTML } from "./pages/settings.ts";

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
    // 按钮上还挂着 data-i18n，属性顺序不再固定，改用正则匹配
    expect(html).toMatch(/data-range="24h"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-range="7d"[^>]*aria-pressed="false"/);
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
  });

  it("客户端脚本使用 textContent 注入提示，不做 HTML 拼接", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('notice.textContent = t("vendor.noVendor")');
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
    expect(html).toContain('t("common.connectionFailed")');
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
});

describe("脚本片段装配", () => {
  it("装配顺序：bootstrap → api → poll → render → chart → page", () => {
    const script = dashboardClientScript();
    const order = [
      "function readToken",
      "function api(path",
      "function startPolling",
      "function cssVar(style",
      "function renderChart(trend",
      "function wireRanges",
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = script.indexOf(marker);
      expect(at, marker).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("主面板页内脚本包含全部六个片段的关键内容", () => {
    const script = dashboardClientScript();
    expect(script).toContain("function readToken");
    expect(script).toContain("Authorization");
    expect(script).toContain("visibilitychange");
    expect(script).toContain("renderVendors");
    expect(script).toContain("polyline");
    expect(script).toContain("kuma-family");
  });
});

describe("页面互链", () => {
  it("主面板供应商区块提供账户详情与配置体检入口", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('data-kuma-nav="/accounts"');
    expect(html).toContain('data-kuma-nav="/settings"');
    expect(html).toContain("账户详情");
    expect(html).toContain("配置体检");
  });

  it("站内链接的兜底 href 不带凭据，凭据由脚本补 fragment", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('href="/accounts"');
    expect(html).not.toContain("?token");
    expect(html).not.toContain("token=");
  });

  it("三个子页都提供返回主面板入口", () => {
    const pages = [
      [
        "empty",
        generateEmptyHTML(),
      ],
      [
        "accounts",
        generateAccountsHTML(),
      ],
      [
        "settings",
        generateSettingsHTML(),
      ],
    ] as const;
    for (const [name, html] of pages) {
      expect(html, name).toContain('data-kuma-nav="/"');
      expect(html, name).toContain("返回主面板");
      expect(html, name).not.toContain("token=");
    }
  });

  it("每个页面都带首帧偏好脚本且 nonce 位一致", () => {
    const dashboard = generateDashboardHTML({
      nonce: "n1",
    });
    expect(dashboard.match(/nonce="n1"/g)?.length).toBe(3);
    const accounts = generateAccountsHTML({
      nonce: "n2",
    });
    expect(accounts.match(/nonce="n2"/g)?.length).toBe(3);
  });
});

describe("主面板信息层级与分区索引轨", () => {
  it("花费概览置顶，用量归因在趋势之前，供应商健康降为末块", () => {
    const html = generateDashboardHTML();
    const positions = [
      'id="section-overview"',
      'id="section-attribution"',
      'id="section-stats"',
      'id="section-chart"',
      'id="section-vendors"',
    ].map((marker) => html.indexOf(marker));
    expect(positions.every((index) => index > -1)).toBe(true);
    expect(positions).toEqual(
      [
        ...positions,
      ].sort((a, b) => a - b),
    );
  });

  it("提供概览容器、归因维度按钮与索引轨条目", () => {
    const html = generateDashboardHTML();
    expect(html).toContain('id="kuma-overview"');
    expect(html).toContain('id="kuma-attribution"');
    for (const dimension of [
      "project",
      "session",
      "vendorModel",
    ]) {
      expect(html).toContain(`data-dimension="${dimension}"`);
    }
    for (const id of [
      "section-overview",
      "section-vendors",
    ]) {
      expect(html).toContain(`data-rail-target="${id}"`);
    }
  });

  it("索引轨只在 Atlas 家族显示，窄视口隐藏", () => {
    const css = dashboardCss();
    expect(css).toContain(".kuma-rail { display: none; }");
    expect(css).toContain('[data-family="atlas"] .kuma-rail {');
    const narrow = css.slice(css.indexOf("@media (max-width: 1100px)"));
    expect(narrow).toContain('[data-family="atlas"] .kuma-rail { display: none; }');
  });
});

describe("供应商账户页结构", () => {
  it("提供概览容器、明细容器、同步按钮与来源图例", () => {
    const html = generateAccountsHTML();
    expect(html).toContain('id="kuma-accounts"');
    expect(html).toContain('id="kuma-accounts-notice"');
    expect(html).toContain('id="kuma-account-rows"');
    expect(html).toContain('id="kuma-sync"');
    expect(html).toContain("来源图例");
    expect(html).toContain("接口查询");
  });

  it("外壳不含凭据，脚本自带来源标记与「未知」文案", () => {
    const html = generateAccountsHTML();
    expect(html).not.toContain("token=");
    const script = accountsClientScript();
    expect(script).toContain("function sourceLabel");
    expect(script).toContain("function amountText");
    expect(script).toContain("接口查询");
    expect(script).toContain("OAuth 授权");
    expect(script).toContain("手动填写");
  });

  it("账户页脚本复用同一套凭据、请求与轮询片段", () => {
    const script = accountsClientScript();
    expect(script).toContain("function readToken");
    expect(script).toContain("Authorization");
    expect(script).toContain("visibilitychange");
    expect(script).toContain("/api/accounts");
  });
});

describe("配置体检页结构", () => {
  it("提供只读声明、三块容器与重新读取按钮", () => {
    const html = generateSettingsHTML();
    expect(html).toContain("不产生任何写盘操作");
    expect(html).toContain('id="kuma-diagnostics"');
    expect(html).toContain('id="kuma-diagnostics-vendors"');
    expect(html).toContain('id="kuma-diagnostics-global"');
    expect(html).toContain('id="kuma-reload"');
    expect(html).toContain('id="kuma-issues"');
  });

  it("解析失败替代卡默认隐藏，避免与正常表格同时出现", () => {
    const html = generateSettingsHTML();
    expect(html).toContain('id="section-diagnostics-error"');
    expect(html).toMatch(/id="section-diagnostics-error"[^>]*hidden/);
  });

  it("体检脚本只读：只请求 /api/diagnostics，失败时 fail-closed", () => {
    const script = settingsClientScript();
    expect(script).toContain("/api/diagnostics");
    expect(script).toContain("不会自动修复");
    expect(script).toContain("showSection");
    // 不提供任何写操作入口
    expect(script).not.toContain("/api/accounts/manual");
  });
});

describe("零数据引导页结构", () => {
  it("两条分支容器、状态行与返回主面板入口齐备", () => {
    const html = generateEmptyHTML();
    expect(html).toContain('id="section-guide-vendors"');
    expect(html).toContain('id="section-guide-data"');
    expect(html).toContain('id="kuma-guide-status"');
    expect(html).toContain('data-kuma-nav="/"');
    expect(html).toContain("产生数据的三条路径");
    // 未配供应商分支默认隐藏，有供应商分支默认可见，切换交给脚本
    expect(html).toMatch(/id="section-guide-vendors"[^>]*hidden/);
  });

  it("引导页脚本复用主面板数据接口判断空态", () => {
    const script = emptyClientScript();
    expect(script).toContain("/api/dashboard");
    expect(script).toContain("function renderGuide");
    expect(script).toContain("section-guide-vendors");
  });
});

describe("中英双语结构", () => {
  it("四个页面都有语言按钮，可见文案都带 data-i18n 键", () => {
    const pages: [
      string,
      string,
    ][] = [
      [
        "dashboard",
        generateDashboardHTML(),
      ],
      [
        "accounts",
        generateAccountsHTML(),
      ],
      [
        "settings",
        generateSettingsHTML(),
      ],
      [
        "empty",
        generateEmptyHTML(),
      ],
    ];

    for (const [name, html] of pages) {
      expect(html, name).toContain('id="kuma-lang"');
      expect(html, name).toContain("data-i18n=");
      // aria-label 只在有区域标签的页面出现（主面板的时间范围/维度/索引轨）
    }
  });

  it("中英字典覆盖服务端写出的每一个 data-i18n 键", () => {
    const html = [
      generateDashboardHTML(),
      generateAccountsHTML(),
      generateSettingsHTML(),
      generateEmptyHTML(),
    ].join("\n");
    const keys = [
      ...html.matchAll(/data-i18n="([^"]+)"/g),
    ].map((match) => match[1]);
    const ariaKeys = [
      ...html.matchAll(/data-i18n-aria="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of [
      ...keys,
      ...ariaKeys,
    ]) {
      expect(Object.keys(MESSAGES), key).toContain(key);
    }
  });

  it("英文文案与中文文案成对存在且不为空", () => {
    for (const [key, entry] of Object.entries(MESSAGES)) {
      expect(entry.zh, key).not.toBe("");
      expect(typeof entry.en, key).toBe("string");
    }
  });
});
