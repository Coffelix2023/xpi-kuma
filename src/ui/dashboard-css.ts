import { FONT_TOKENS, radius, SPACING_TOKENS, themeFamilyCss } from "./theme.ts";

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
  // 字号刻度：基准值来自 theme.ts，乘上用户档位后才是实际字号
  const fonts = Object.entries(FONT_TOKENS)
    .map(([name, value]) => `      --${name}: calc(${value} * var(--kuma-font-scale));`)
    .join("\n");

  return `
${themeFamilyCss()}

    /* 面板间距刻度：8px 基准网格，来源是本仓库约定而非 THEMES.md */
    :root {
${spacing}
    }

    /* 字号档位：默认档的 scale 写在这里，其余档位在下方按 data-font 覆盖 */
    :root {
      --kuma-font-scale: 1;
${fonts}
    }

    /*
     * 字号档位：1 最小、5 最大，3 即默认档（不写规则，回落上一块的 1）。
     * 档位只改 --kuma-font-scale，间距与圆角不受影响。
     */
    :root[data-font="1"] { --kuma-font-scale: 0.85; }
    :root[data-font="2"] { --kuma-font-scale: 0.92; }
    :root[data-font="4"] { --kuma-font-scale: 1.15; }
    :root[data-font="5"] { --kuma-font-scale: 1.3; }

    * { box-sizing: border-box; }

    /*
     * 正文宽度上限：桌面满宽时表格会被拉成横跨整屏的长行，数据反而不好对齐；1280px 在
     * 1440p / 2560p 下都留出边距，更宽的表继续走 .kuma-scroll 横向滚动。
     */
    body {
      margin: 0 auto;
      max-width: 1280px;
      padding: var(--kuma-space-3);
      background: var(--background);
      color: var(--foreground);
      font-family: var(--font-sans);
      font-size: var(--kuma-font-md);
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
      font-size: var(--kuma-font-xl);
      font-weight: 700;
      margin: 0;
      letter-spacing: 0.02em;
    }

    h2 {
      font-size: var(--kuma-font-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted-foreground);
      margin: 0 0 var(--kuma-space-2);
    }

    section { margin-bottom: var(--kuma-space-3); }

    .kuma-generated { color: var(--muted-foreground); font-size: var(--kuma-font-sm); }

    .kuma-actions { display: flex; gap: var(--kuma-space-1); align-items: center; }



    /* 花费概览：四项数字，窄视口自动折行 */
    .kuma-overview {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: var(--kuma-space-2);
    }
    .kuma-metric {
      border: 1px solid var(--border);
      border-radius: ${radius()};
      padding: var(--kuma-space-2);
    }
    .kuma-metric dt { color: var(--muted-foreground); font-size: var(--kuma-font-sm); }
    .kuma-metric dd {
      margin: 4px 0 0;
      font-size: var(--kuma-font-xxl);
      font-weight: 700;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }

    button {
      font-family: inherit;
      font-size: var(--kuma-font-sm);
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

    /*
     * 标签页：横向排布，选中项用下划线而不是填充 —— 与按钮的 aria-pressed 填充态区分开，
     * 免得一屏里出现两处「看起来像开关」的实心块。
     */
    .kuma-tablist {
      display: flex;
      gap: var(--kuma-space-1);
      border-bottom: 1px solid var(--border);
      margin-bottom: var(--kuma-space-3);
    }
    .kuma-tablist button[role="tab"] {
      background: transparent;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      padding: 6px 12px;
      color: var(--muted-foreground);
      font-size: var(--kuma-font-md);
    }
    /* 覆盖 button:hover 的底色：标签页的悬停只改文字色 */
    .kuma-tablist button[role="tab"]:hover:not(:disabled) {
      background: transparent;
      color: var(--foreground);
    }
    .kuma-tablist button[role="tab"][aria-selected="true"] {
      color: var(--foreground);
      border-bottom-color: var(--primary);
    }
    .kuma-tablist button[role="tab"]:focus-visible { outline-offset: -2px; }

    /* 主题家族下拉：与按钮同尺寸同族色，展开项由系统绘制 */
    select {
      font-family: inherit;
      font-size: var(--kuma-font-sm);
      color: var(--foreground);
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: ${radius(-2)};
      padding: 4px 8px;
      cursor: pointer;
    }
    select:hover { border-color: var(--primary); }
    select:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }

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

    .kuma-card-name { font-weight: 700; font-size: var(--kuma-font-lg); }
    .kuma-card-model { color: var(--muted-foreground); font-size: var(--kuma-font-sm); word-break: break-all; font-family: var(--font-mono); }

    .kuma-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--kuma-space-1); }
    .kuma-kv dt { color: var(--muted-foreground); }
    .kuma-kv dd { margin: 0; text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

    .kuma-badge {
      display: inline-block;
      font-size: var(--kuma-font-xs);
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

    table { border-collapse: collapse; width: 100%; font-size: var(--kuma-font-sm); }
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

    /* 子页用的行内链接与引导步骤 */
    a.kuma-link {
      color: var(--foreground);
      font-size: var(--kuma-font-sm);
      text-decoration: none;
      border-bottom: 1px solid var(--border);
    }
    a.kuma-link:hover { border-bottom-color: var(--primary); color: var(--primary); }
    a.kuma-link:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }

    /* 体检页的只读声明：整页最重要的边界，做成一条显眼的横幅 */
    .kuma-readonly {
      border: 1px solid var(--border);
      border-left: 3px solid var(--primary);
      border-radius: ${radius()};
      padding: var(--kuma-space-1) var(--kuma-space-2);
      margin: 0 0 var(--kuma-space-3);
      color: var(--muted-foreground);
      font-size: var(--kuma-font-sm);
    }

    /* 键值列表的宽版：标签固定、值可折行（路径与错误信息都很长） */
    .kuma-kv-wide { grid-template-columns: minmax(120px, max-content) 1fr; }
    .kuma-kv-wide dd { text-align: left; word-break: break-all; }

    /* 体检表：说明与动作要能换行，未通过项用破坏色标记 */
    .kuma-note { white-space: normal; text-align: left; min-width: 160px; }
    .kuma-check-fail { color: var(--destructive); font-weight: 700; }

    .kuma-steps { margin: 0; padding-left: var(--kuma-space-3); }
    .kuma-steps li { margin-bottom: var(--kuma-space-1); }
    .kuma-steps code,
    code {
      font-family: var(--font-mono);
      background: var(--muted);
      color: var(--foreground);
      padding: 1px 4px;
      border-radius: ${radius(-4)};
    }

    /*
     * 分区标题：总览面板内 P1 / P2 区块的小标题，视觉弱于 h1、强于正文标签。
     */
    .kuma-block-title {
      margin: var(--kuma-space-3) 0 var(--kuma-space-1);
      font-size: var(--kuma-font-sm);
      font-weight: 700;
      color: var(--muted-foreground);
    }

    /*
     * 排行摘要：模型费用与项目费用并排两列，效率排行独占整行。
     *
     * 效率表有五列（p50 总耗时 / p95 首字 / 样本 / 成功率），1/3 宽度下会被裁切；
     * 三列并排因此改为 2 + 1：两张三列表并排，效率表整行铺满。
     *
     * 网格子项默认 min-width:auto，表内 nowrap 单元格的最小内容宽度会把列撑破容器，
     * 归零后由 .kuma-scroll 接管溢出。
     */
    .kuma-rank-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--kuma-space-3);
    }
    .kuma-rank-grid > * { min-width: 0; }
    .kuma-rank-grid > :last-child { grid-column: 1 / -1; }
    .kuma-rank-title {
      margin: 0 0 var(--kuma-space-1);
      font-size: var(--kuma-font-sm);
      font-weight: 600;
      color: var(--muted-foreground);
    }

    /* 排行小表：数字列右对齐并用等宽数字，超出宽度由 .kuma-scroll 横向滚动 */
    .kuma-table { width: 100%; border-collapse: collapse; font-size: var(--kuma-font-sm); }
    .kuma-table th,
    .kuma-table td {
      padding: 4px 6px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
    }
    .kuma-table th { color: var(--muted-foreground); font-weight: 600; }
    .kuma-table tr:last-child td { border-bottom: 0; }
    .kuma-num {
      text-align: right;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }

    /* 空态与状态文字：文字即状态，颜色只是辅助通道 */
    .kuma-muted { margin: 0; color: var(--muted-foreground); font-size: var(--kuma-font-sm); }

    /* 解释型建议卡片：纵向堆叠，结论在上，依据 / 样本 / 时间范围 / 置信度在下 */
    .kuma-insight-list { display: flex; flex-direction: column; gap: var(--kuma-space-2); }
    .kuma-insight-card {
      border: 1px solid var(--border);
      border-left: 3px solid var(--primary);
      border-radius: ${radius()};
      padding: var(--kuma-space-2);
    }
    .kuma-insight-conclusion { margin: 0; font-size: var(--kuma-font-md); font-weight: 600; }
    .kuma-insight-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 2px var(--kuma-space-2);
      margin: var(--kuma-space-1) 0 0;
      font-size: var(--kuma-font-sm);
    }
    .kuma-insight-meta dt { color: var(--muted-foreground); }
    .kuma-insight-meta dd {
      margin: 0;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }

    /* 窄视口：卡片换更多列，表格继续横向滚动，图表压低高度 */

    @media (max-width: 800px) {
      body { padding: var(--kuma-space-2); }
      .kuma-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
      .kuma-chart-wrap svg { height: 200px; }
      .kuma-rank-grid { grid-template-columns: 1fr; }
    }
  `;
}
