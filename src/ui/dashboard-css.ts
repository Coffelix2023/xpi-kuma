import { radius, SPACING_TOKENS, themeFamilyCss } from "./theme.ts";

/**
 * 面板样式表。
 *
 * 所有颜色只经 `THEMES.md` 的家族 token 引用，页面不出现裸色值。
 * 主题与家族的 token 块由 `themeFamilyCss()` 生成；本文件只负责消费。
 *
 * 三处消费规则来自 `THEMES.md`「落地注意」的实测结论，**不是**随意选择：
 *
 * 1. 焦点环用 `--primary` —— `--ring`（柿橙）在亮色只有 2.59:1，未达非文字 3:1。
 * 2. hover 底色用 `--secondary` —— `--accent` 作 hover 底在暗色只有 2.60:1。
 * 3. 状态色只用家族已有的前景色 / 破坏色 / 弱化前景色 —— THEMES.md 没有 success 绿，
 *    不为状态自造语义色。状态另有文本标签与 `aria-label`，颜色不是唯一传达通道。
 */
export function dashboardCss(): string {
  const spacing = Object.entries(SPACING_TOKENS)
    .map(([name, value]) => `      --${name}: ${value};`)
    .join("\n");

  return `
${themeFamilyCss()}

    /* 面板间距刻度：8px 基准网格，来源是本仓库约定而非 THEMES.md */
    :root {
${spacing}
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: var(--kuma-space-3);
      background: var(--background);
      color: var(--foreground);
      font-family: var(--font-sans);
      font-size: 12px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--kuma-space-2);
      padding-bottom: var(--kuma-space-2);
      border-bottom: 1px solid var(--border);
      margin-bottom: var(--kuma-space-3);
    }

    h1 {
      font-size: 14px;
      font-weight: 700;
      margin: 0;
      letter-spacing: 0.02em;
    }

    h2 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted-foreground);
      margin: 0 0 var(--kuma-space-2);
    }

    section { margin-bottom: var(--kuma-space-3); }

    .kuma-generated { color: var(--muted-foreground); font-size: 11px; }

    .kuma-actions { display: flex; gap: var(--kuma-space-1); align-items: center; }

    button {
      font-family: inherit;
      font-size: 11px;
      color: var(--foreground);
      background: transparent;
      border: 1px solid var(--border);
      border-radius: ${radius(-2)};
      padding: 4px 10px;
      cursor: pointer;
      transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
    }

    /* hover 底用 --secondary：--accent 作 hover 底在暗色只有 2.60:1 */
    button:hover:not(:disabled) {
      background: var(--secondary);
      border-color: var(--primary);
      color: var(--secondary-foreground);
    }
    /* 焦点环用 --primary：--ring 柿橙在亮色未达非文字 3:1 */
    button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
    button:disabled { opacity: 0.5; cursor: progress; }

    button[aria-pressed="true"] {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--primary-foreground);
    }

    .kuma-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: var(--kuma-space-2);
    }

    .kuma-card {
      border: 1px solid var(--border);
      border-radius: ${radius()};
      padding: var(--kuma-space-2);
      background: transparent;
    }

    .kuma-card-head {
      display: flex;
      align-items: baseline;
      gap: var(--kuma-space-1);
      margin-bottom: var(--kuma-space-1);
    }

    .kuma-card-name { font-weight: 700; font-size: 13px; }
    .kuma-card-model { color: var(--muted-foreground); font-size: 11px; word-break: break-all; font-family: var(--font-mono); }

    .kuma-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--kuma-space-1); }
    .kuma-kv dt { color: var(--muted-foreground); }
    .kuma-kv dd { margin: 0; text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

    .kuma-badge {
      display: inline-block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 1px 6px;
      border-radius: ${radius(-2)};
      border: 1px solid currentColor;
    }

    /*
     * 状态四态 → 家族已有的三个非强调色 + --primary。
     * THEMES.md 没有 success 绿，不为状态自造语义色；
     * 区分降级与未知的是文本标签，颜色只是辅助通道。
     */
    .kuma-up { color: var(--foreground); }
    .kuma-degraded { color: var(--primary); }
    .kuma-down { color: var(--destructive); }
    .kuma-unknown { color: var(--muted-foreground); }

    /*
     * 家族专属装饰（如 Atlas 的分区索引轨、方格纸底纹）。
     * 默认隐藏，只有 data-family="atlas" 时才显示；用 revert 恢复元素自身的默认
     * display，避免把 div 强制成 inline。
     */
    .kuma-atlas-only { display: none; }
    [data-family="atlas"] .kuma-atlas-only { display: revert; }

    .kuma-card-foot {
      margin-top: var(--kuma-space-1);
      display: flex;
      justify-content: flex-end;
    }

    .kuma-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: ${radius()}; }

    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { padding: 6px 10px; text-align: right; white-space: nowrap; }
    th { color: var(--muted-foreground); font-weight: 600; text-align: right; border-bottom: 1px solid var(--border); }
    th:first-child, td:first-child { text-align: left; }
    td { border-bottom: 1px solid var(--border); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    tbody tr:last-child td { border-bottom: 0; }
    td.kuma-total { color: var(--primary); font-weight: 700; }

    .kuma-empty {
      border: 1px dashed var(--border);
      border-radius: ${radius()};
      padding: var(--kuma-space-3);
      text-align: center;
      color: var(--muted-foreground);
    }
    /* hidden 属性优先于 .kuma-empty 的布局，保证提示可被脚本收起 */
    .kuma-empty[hidden] { display: none; }

    .kuma-chart-wrap { border: 1px solid var(--border); border-radius: ${radius()}; padding: var(--kuma-space-2); }
    .kuma-chart-wrap svg { width: 100%; height: 260px; display: block; }

    .kuma-perf { margin-left: auto; color: var(--muted-foreground); }

    /* 窄视口：卡片换更多列，表格继续横向滚动，图表压低高度 */
    @media (max-width: 800px) {
      body { padding: var(--kuma-space-2); }
      .kuma-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
      .kuma-chart-wrap svg { height: 200px; }
    }
  `;
}
