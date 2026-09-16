/**
 * 面板配色 token。
 *
 * 暗色为唯一基线，取自仓库根 `DESIGN.md` 的 `colors` 段（十六进制源值
 * 等价转换为 `oklch`，供面板以 CSS 变量形式消费）。`DESIGN.md` 只定义
 * 暗色终端画布，未定义亮色；亮色沿用同一组色相，仅重排明度以在浅底上
 * 保持对比度。
 */

/** 一组可切换的主题变量。 */
export interface ThemeTokens {
  accent: string;
  canvas: string;
  error: string;
  ink: string;
  muted: string;
  onAccent: string;
  primary: string;
  rule: string;
  success: string;
  warning: string;
}

/** 暗色主题：与 DESIGN.md `colors` 段一一对应。 */
export const DARK_THEME: ThemeTokens = {
  accent: "oklch(0.609 0.085 164.0)", // #4D9375
  canvas: "oklch(0.235 0.000 89.9)", // #1E1E1E
  error: "oklch(0.648 0.210 25.2)", // #F44747
  ink: "oklch(0.870 0.000 89.9)", // #D4D4D4
  muted: "oklch(0.600 0.000 89.9)", // #808080
  onAccent: "oklch(1.000 0.000 89.9)", // #FFFFFF
  primary: "oklch(0.623 0.188 259.8)", // #3B82F6
  rule: "oklch(0.356 0.000 89.9)", // #3C3C3C
  success: "oklch(0.760 0.115 177.2)", // #4EC9B0
  warning: "oklch(0.710 0.083 43.2)", // #CE9178
};

/** 亮色主题：同色相，明度重排以适配浅底。 */
export const LIGHT_THEME: ThemeTokens = {
  accent: "oklch(0.520 0.085 164.0)",
  canvas: "oklch(0.985 0.000 89.9)",
  error: "oklch(0.540 0.210 25.2)",
  ink: "oklch(0.235 0.000 89.9)",
  muted: "oklch(0.480 0.000 89.9)",
  onAccent: "oklch(1.000 0.000 89.9)",
  primary: "oklch(0.520 0.188 259.8)",
  rule: "oklch(0.870 0.000 89.9)",
  success: "oklch(0.560 0.115 177.2)",
  warning: "oklch(0.560 0.100 43.2)",
};

/** 8px 基准网格 + 等宽字体，与 DESIGN.md 的 spacing / typography 段一致。 */
export const LAYOUT_TOKENS = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  radius: "8px",
  space1: "8px",
  space2: "16px",
  space3: "24px",
} as const;

/** 把一组 token 渲染成 CSS 自定义属性。 */
export function themeToCssVariables(theme: ThemeTokens): string {
  return Object.entries(theme)
    .map(([key, value]) => `    --kuma-${kebab(key)}: ${value};`)
    .join("\n");
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
