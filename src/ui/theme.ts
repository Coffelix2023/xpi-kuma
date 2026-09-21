/**
 * 面板主题 token 的消费层。
 *
 * 数据与类型在 `theme-tokens.ts`（THEMES.md 两套家族 × 两种明暗，逐字照抄）；
 * 本文件只负责消费：选择器生成、半径派生、token 合并。
 *
 * ## 两套家族
 *
 * - `default` —— THEMES.md 的 Default-Themes（`oklch`，圆角 0.5rem，有阴影）
 * - `atlas` —— THEMES.md 的 Atlas-Themes v2（复古印刷，hex，全直角，平版无阴影）
 *
 * 两套家族的同名变量取值不同（`--primary` / `--accent` / `--radius` 等），必须靠属性
 * 选择器隔离 —— 见 `themeFamilyCss()`。
 *
 * ## 对比度修正属于消费方规则
 *
 * THEMES.md 的「落地注意」实测出若干对比度问题，处理方式是**改消费方式而不是改 token 值**，
 * 因此那些规则写在 `dashboard-css.ts` 里，token 值本身与 THEMES.md 保持一致：
 *
 * - 焦点环用 `--primary`（`--ring` 柿橙在亮色只有 2.59:1，未达非文字 3:1）
 * - `--accent` 不作正文色（亮色 2.59:1）；确需橙色文字时就地派生
 *   `color-mix(in oklab, var(--accent) 60%, var(--foreground))`，不新增 token
 * - hover 底色用 `--secondary`（`--accent` 作 hover 底在暗色只有 2.60:1）
 * - 状态三态用 `--foreground` / `--destructive` / `--muted-foreground`，不自造 success 绿
 */

import type { ThemeFamily, ThemeTokenSet } from "./theme-tokens.ts";
import { THEME_FAMILIES } from "./theme-tokens.ts";

export { THEME_FAMILIES };

/** 默认家族；`data-family` 缺省或为 `default` 时生效。 */
export const DEFAULT_FAMILY: ThemeFamily = "default";

/**
 * 面板间距刻度，8px 基准网格。
 *
 * 这一组**不来自 THEMES.md** —— THEMES.md 的 `--spacing: 0.25rem` 是 Tailwind 的基准单位，
 * 不是面板的间距刻度。8px 基准来自 `dashboard-ui` spec 的「遵循 DESIGN.md 设计规范」要求。
 * 保留 `--kuma-` 前缀以区分「本仓库自定」与「照抄 THEMES.md」两类 token。
 */
export const SPACING_TOKENS = {
  "kuma-space-1": "8px",
  "kuma-space-2": "16px",
  "kuma-space-3": "24px",
} as const satisfies ThemeTokenSet;

/**
 * 面板字号刻度：scale 1 时的基准像素值。
 *
 * 与 `SPACING_TOKENS` 一样是本仓库自定刻度（不来自 THEMES.md）。实际字号由
 * `dashboard-css.ts` 乘上用户档位 `--kuma-font-scale` 得出，所以这里只登记基准值，
 * 间距与圆角不参与缩放。
 */
export const FONT_TOKENS = {
  // 键名按 lint 的字母序要求排列（useSortedKeys），字号大小以数值为准
  "kuma-font-lg": "13px",
  "kuma-font-md": "12px",
  "kuma-font-sm": "11px",
  "kuma-font-xl": "14px",
  "kuma-font-xs": "10px",
  "kuma-font-xxl": "18px",
} as const satisfies ThemeTokenSet;

/**
 * 半径派生值。
 *
 * Atlas 家族的 `--radius` 是 `0rem`，直接写 `calc(var(--radius) - 4px)` 会算出 `-4px`，
 * 是非法长度值，整条声明会被浏览器丢弃。因此一律用 `max(0px, ...)` 兜住负值 ——
 * 这是 THEMES.md「落地注意」实测到的坑。
 */
export function radius(offsetPx = 0): string {
  if (offsetPx === 0) {
    return "max(0px, var(--radius))";
  }
  const operator = offsetPx > 0 ? "+" : "-";
  return `max(0px, calc(var(--radius) ${operator} ${Math.abs(offsetPx)}px))`;
}

/**
 * 生成两套家族 × 两种明暗模式的全部 token 块。
 *
 * 选择器与特异性（`:root` 计一个伪类，`[attr]` 计一个属性选择器）：
 *
 * | 选择器 | 特异性 | 命中场景 |
 * | :--- | :--- | :--- |
 * | `:root` | 0,1,0 | 默认暗色（与既有 `data-theme="dark"` 一致） |
 * | `:root[data-theme="light"]` | 0,2,0 | 默认家族亮色 |
 * | `:root[data-family="atlas"]` | 0,2,0 | 图鉴家族暗色 |
 * | `:root[data-family="atlas"][data-theme="light"]` | 0,3,0 | 图鉴家族亮色 |
 *
 * 按此顺序输出，同特异性下后者覆盖前者，家族维度始终优先于明暗维度。
 */
export function themeFamilyCss(): string {
  const blocks: [
    string,
    ThemeTokenSet,
  ][] = [
    [
      ":root",
      tokensFor("default", "dark"),
    ],
    [
      ':root[data-theme="light"]',
      tokensFor("default", "light"),
    ],
    [
      ':root[data-family="atlas"]',
      tokensFor("atlas", "dark"),
    ],
    [
      ':root[data-family="atlas"][data-theme="light"]',
      tokensFor("atlas", "light"),
    ],
  ];

  return blocks
    .map(([selector, tokens]) => {
      const body = Object.entries(tokens)
        .map(([name, value]) => `      --${name}: ${value};`)
        .join("\n");
      return `    ${selector} {\n${body}\n    }`;
    })
    .join("\n\n");
}

/** 合并某一家族在某个明暗模式下的全部 token（常量 + 颜色）。 */
export function tokensFor(family: ThemeFamily, mode: "light" | "dark"): ThemeTokenSet {
  const definition = THEME_FAMILIES[family];
  return {
    ...definition.fonts,
    ...definition.layout,
    ...definition.shadows,
    ...definition[mode],
  };
}
