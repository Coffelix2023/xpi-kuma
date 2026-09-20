import {
  DARK_THEME,
  LAYOUT_TOKENS,
  LIGHT_THEME,
  themeToCssVariables,
} from "./theme.ts";

/**
 * 面板样式表。
 *
 * 默认暗色（DESIGN.md 只定义暗色画布），亮色由 `data-theme` 切换。
 * 所有颜色只经 CSS 变量引用，页面不出现裸色值。
 */
export function dashboardCss(): string {
  return `
    :root {
${themeToCssVariables(DARK_THEME)}
      --kuma-space-1: ${LAYOUT_TOKENS.space1};
      --kuma-space-2: ${LAYOUT_TOKENS.space2};
      --kuma-space-3: ${LAYOUT_TOKENS.space3};
      --kuma-radius: ${LAYOUT_TOKENS.radius};
    }

    :root[data-theme="light"] {
${themeToCssVariables(LIGHT_THEME)}
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: var(--kuma-space-3);
      background: var(--kuma-canvas);
      color: var(--kuma-ink);
      font-family: ${LAYOUT_TOKENS.fontFamily};
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
      border-bottom: 1px solid var(--kuma-rule);
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
      color: var(--kuma-muted);
      margin: 0 0 var(--kuma-space-2);
    }

    section { margin-bottom: var(--kuma-space-3); }

    .kuma-generated { color: var(--kuma-muted); font-size: 11px; }

    .kuma-actions { display: flex; gap: var(--kuma-space-1); align-items: center; }

    button {
      font-family: inherit;
      font-size: 11px;
      color: var(--kuma-ink);
      background: transparent;
      border: 1px solid var(--kuma-rule);
      border-radius: var(--kuma-radius);
      padding: 4px 10px;
      cursor: pointer;
      transition: border-color 120ms ease, color 120ms ease;
    }

    button:hover:not(:disabled) { border-color: var(--kuma-primary); color: var(--kuma-primary); }
    button:focus-visible { outline: 2px solid var(--kuma-primary); outline-offset: 1px; }
    button:disabled { opacity: 0.5; cursor: progress; }

    button[aria-pressed="true"] {
      background: var(--kuma-primary);
      border-color: var(--kuma-primary);
      color: var(--kuma-on-accent);
    }

    .kuma-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: var(--kuma-space-2);
    }

    .kuma-card {
      border: 1px solid var(--kuma-rule);
      border-radius: var(--kuma-radius);
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
    .kuma-card-model { color: var(--kuma-muted); font-size: 11px; word-break: break-all; }

    .kuma-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--kuma-space-1); }
    .kuma-kv dt { color: var(--kuma-muted); }
    .kuma-kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }

    .kuma-badge {
      display: inline-block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 1px 6px;
      border-radius: var(--kuma-radius);
      border: 1px solid currentColor;
    }

    .kuma-up { color: var(--kuma-success); }
    .kuma-down { color: var(--kuma-error); }
    .kuma-degraded { color: var(--kuma-warning); }
    .kuma-unknown { color: var(--kuma-muted); }

    .kuma-card-foot {
      margin-top: var(--kuma-space-1);
      display: flex;
      justify-content: flex-end;
    }

    .kuma-scroll { overflow-x: auto; border: 1px solid var(--kuma-rule); border-radius: var(--kuma-radius); }

    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { padding: 6px 10px; text-align: right; white-space: nowrap; }
    th { color: var(--kuma-muted); font-weight: 600; text-align: right; border-bottom: 1px solid var(--kuma-rule); }
    th:first-child, td:first-child { text-align: left; }
    td { border-bottom: 1px solid var(--kuma-rule); font-variant-numeric: tabular-nums; }
    tbody tr:last-child td { border-bottom: 0; }
    td.kuma-total { color: var(--kuma-accent); font-weight: 700; }

    .kuma-empty {
      border: 1px dashed var(--kuma-rule);
      border-radius: var(--kuma-radius);
      padding: var(--kuma-space-3);
      text-align: center;
      color: var(--kuma-muted);
    }
    /* hidden 属性优先于 .kuma-empty 的布局，保证提示可被脚本收起 */
    .kuma-empty[hidden] { display: none; }

    .kuma-chart-wrap { border: 1px solid var(--kuma-rule); border-radius: var(--kuma-radius); padding: var(--kuma-space-2); }
    .kuma-chart-wrap canvas { width: 100%; height: 260px; display: block; }

    .kuma-perf { margin-left: auto; color: var(--kuma-muted); }

    /* 窄视口：卡片换更多列，表格继续横向滚动，图表压低高度 */
    @media (max-width: 800px) {
      body { padding: var(--kuma-space-2); }
      .kuma-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
      .kuma-chart-wrap canvas { height: 200px; }
    }
  `;
}
