/**
 * 面板主题 token。
 *
 * 取值来源：仓库根 `THEMES.md`，两套家族逐字照抄，**不改写任何色值**。
 *
 * ## 两套家族
 *
 * - `default` —— THEMES.md 的 Default-Themes（`oklch`，圆角 0.5rem，有阴影）
 * - `atlas` —— THEMES.md 的 Atlas-Themes v2（复古印刷，hex，全直角，平版无阴影）
 *
 * 两套家族的同名变量取值不同（`--primary` / `--accent` / `--radius` 等），必须靠属性
 * 选择器隔离 —— 见 `themeFamilyCss()`。
 *
 * ## 为什么不搬全部 token
 *
 * THEMES.md 里的 `--shadow-x` / `--shadow-y` / `--shadow-blur` / `--shadow-spread` /
 * `--shadow-opacity` / `--shadow-color` 只是 shadcn 生成 `--shadow-*` 的中间输入，
 * 最终值已经算好，没有任何消费方读它们；`--tracking-normal` 同理。这两类不搬。
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

/** 主题家族标识，对应 `THEMES.md` 的两段。 */
export type ThemeFamily = "default" | "atlas";

/** 一组主题 token：CSS 变量名（不含 `--` 前缀）→ 值。 */
export type ThemeTokenSet = Readonly<Record<string, string>>;

/** 家族级常量：不随明暗模式变化。 */
interface FamilyCommon {
  /** 字体栈 */
  fonts: ThemeTokenSet;
  /** 半径与间距基准 */
  layout: ThemeTokenSet;
  /** 阴影档位 */
  shadows: ThemeTokenSet;
}

/** 一套家族的完整定义：常量 + 两种明暗模式的颜色。 */
interface FamilyDefinition extends FamilyCommon {
  /** 暗色模式的颜色 token */
  dark: ThemeTokenSet;
  /** 亮色模式的颜色 token */
  light: ThemeTokenSet;
}

// ─────────────────────────────────────────────────────────────
// Default-Themes（THEMES.md 第一段）
// ─────────────────────────────────────────────────────────────

const DEFAULT_COMMON: FamilyCommon = {
  fonts: {
    "font-mono": "JetBrains Mono, ui-monospace, monospace",
    "font-sans": "Inter, ui-sans-serif, sans-serif, system-ui",
    "font-serif": "Noto Serif, ui-serif, serif",
  },
  layout: {
    radius: "0.5rem",
    spacing: "0.25rem",
  },
  shadows: {
    shadow: "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
    "shadow-2xl": "0 1px 3px 0px hsl(0 0% 0% / 0.25)",
    "shadow-2xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
    "shadow-lg":
      "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10)",
    "shadow-md":
      "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10)",
    "shadow-sm":
      "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)",
    "shadow-xl":
      "0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10)",
    "shadow-xs": "0 1px 3px 0px hsl(0 0% 0% / 0.05)",
  },
};

const DEFAULT_LIGHT: ThemeTokenSet = {
  accent: "oklch(0.9245 0.0138 92.9892)",
  "accent-foreground": "oklch(0.2671 0.0196 98.9390)",
  background: "oklch(0.9818 0.0054 95.0986)",
  border: "oklch(0.8847 0.0069 97.3627)",
  card: "oklch(0.9818 0.0054 95.0986)",
  "card-foreground": "oklch(0.1908 0.0020 106.5859)",
  "chart-1": "oklch(0.5583 0.1276 42.9956)",
  "chart-2": "oklch(0.6898 0.1581 290.4107)",
  "chart-3": "oklch(0.8816 0.0276 93.1280)",
  "chart-4": "oklch(0.8822 0.0403 298.1792)",
  "chart-5": "oklch(0.5608 0.1348 42.0584)",
  destructive: "oklch(0.1908 0.0020 106.5859)",
  "destructive-foreground": "oklch(1.0000 0 0)",
  foreground: "oklch(0.3438 0.0269 95.7226)",
  input: "oklch(0.7621 0.0156 98.3528)",
  muted: "oklch(0.9341 0.0153 90.2390)",
  "muted-foreground": "oklch(0.6059 0.0075 97.4233)",
  popover: "oklch(1.0000 0 0)",
  "popover-foreground": "oklch(0.2671 0.0196 98.9390)",
  primary: "oklch(0.6171 0.1375 39.0427)",
  "primary-foreground": "oklch(1.0000 0 0)",
  ring: "oklch(0.6171 0.1375 39.0427)",
  secondary: "oklch(0.9245 0.0138 92.9892)",
  "secondary-foreground": "oklch(0.4334 0.0177 98.6048)",
  sidebar: "oklch(0.9663 0.0080 98.8792)",
  "sidebar-accent": "oklch(0.9245 0.0138 92.9892)",
  "sidebar-accent-foreground": "oklch(0.3250 0 0)",
  "sidebar-border": "oklch(0.9401 0 0)",
  "sidebar-foreground": "oklch(0.3590 0.0051 106.6524)",
  "sidebar-primary": "oklch(0.6171 0.1375 39.0427)",
  "sidebar-primary-foreground": "oklch(0.9881 0 0)",
  "sidebar-ring": "oklch(0.7731 0 0)",
};

const DEFAULT_DARK: ThemeTokenSet = {
  accent: "oklch(0.2130 0.0078 95.4245)",
  "accent-foreground": "oklch(0.9663 0.0080 98.8792)",
  background: "oklch(0.2679 0.0036 106.6427)",
  border: "oklch(0.3618 0.0101 106.8928)",
  card: "oklch(0.2679 0.0036 106.6427)",
  "card-foreground": "oklch(0.9818 0.0054 95.0986)",
  "chart-1": "oklch(0.5583 0.1276 42.9956)",
  "chart-2": "oklch(0.6898 0.1581 290.4107)",
  "chart-3": "oklch(0.2130 0.0078 95.4245)",
  "chart-4": "oklch(0.3074 0.0516 289.3230)",
  "chart-5": "oklch(0.5608 0.1348 42.0584)",
  destructive: "oklch(0.6368 0.2078 25.3313)",
  "destructive-foreground": "oklch(1.0000 0 0)",
  foreground: "oklch(0.8074 0.0142 93.0137)",
  input: "oklch(0.4336 0.0113 100.2195)",
  muted: "oklch(0.2213 0.0038 106.7070)",
  "muted-foreground": "oklch(0.7713 0.0169 99.0657)",
  popover: "oklch(0.3085 0.0035 106.6039)",
  "popover-foreground": "oklch(0.9211 0.0040 106.4781)",
  primary: "oklch(0.6724 0.1308 38.7559)",
  "primary-foreground": "oklch(1.0000 0 0)",
  ring: "oklch(0.6724 0.1308 38.7559)",
  secondary: "oklch(0.9818 0.0054 95.0986)",
  "secondary-foreground": "oklch(0.3085 0.0035 106.6039)",
  sidebar: "oklch(0.2357 0.0024 67.7077)",
  "sidebar-accent": "oklch(0.1680 0.0020 106.6177)",
  "sidebar-accent-foreground": "oklch(0.8074 0.0142 93.0137)",
  "sidebar-border": "oklch(0.9401 0 0)",
  "sidebar-foreground": "oklch(0.8074 0.0142 93.0137)",
  "sidebar-primary": "oklch(0.3250 0 0)",
  "sidebar-primary-foreground": "oklch(0.9881 0 0)",
  "sidebar-ring": "oklch(0.7731 0 0)",
};

// ─────────────────────────────────────────────────────────────
// Atlas-Themes v2（THEMES.md 第二段）
// ─────────────────────────────────────────────────────────────

const ATLAS_COMMON: FamilyCommon = {
  fonts: {
    "font-display": '"Oswald", "Arial Narrow", "Noto Sans SC", sans-serif',
    "font-mono": '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
    "font-sans": '"Noto Sans SC", "PingFang SC", ui-sans-serif, system-ui, sans-serif',
    "font-serif": '"Noto Serif SC", "Songti SC", Georgia, ui-serif, serif',
  },
  layout: {
    // 印刷直角：半径 0。消费方必须用 max(0px, ...) 兜住负值，见 radius()
    radius: "0rem",
    spacing: "0.25rem",
  },
  shadows: {
    shadow: "none",
    "shadow-2xl": "none",
    "shadow-2xs": "none",
    "shadow-lg": "none",
    "shadow-md": "none",
    "shadow-sm": "none",
    "shadow-xl": "none",
    "shadow-xs": "none",
  },
};

const ATLAS_LIGHT: ThemeTokenSet = {
  accent: "#DD7A1C",
  "accent-foreground": "#FFF8EA",
  background: "#F2ECDF",
  border: "#24425E",
  card: "#F7F2E6",
  "card-foreground": "#1A3A58",
  "chart-1": "#12314E",
  "chart-2": "#DD7A1C",
  "chart-3": "#7A93AC",
  "chart-4": "#C9B98F",
  "chart-5": "#AF3A2C",
  destructive: "#AF3A2C",
  "destructive-foreground": "#FFF8EA",
  foreground: "#1A3A58",
  "grid-line": "#E1D9C5",
  input: "#4A6478",
  muted: "#EBE4D2",
  "muted-foreground": "#6E6A5E",
  popover: "#FAF6EB",
  "popover-foreground": "#1A3A58",
  primary: "#12314E",
  "primary-foreground": "#F6F1E4",
  ring: "#DD7A1C",
  secondary: "#E6DECA",
  "secondary-foreground": "#1A3A58",
  sidebar: "#12314E",
  "sidebar-accent": "#1E3E5E",
  "sidebar-accent-foreground": "#F2ECDF",
  "sidebar-border": "#2A4A66",
  "sidebar-foreground": "#F2ECDF",
  "sidebar-primary": "#DD7A1C",
  "sidebar-primary-foreground": "#FFF8EA",
  "sidebar-ring": "#DD7A1C",
  track: "#D9D4C8",
};

const ATLAS_DARK: ThemeTokenSet = {
  accent: "#C8781F",
  "accent-foreground": "#14283E",
  background: "#0F2438",
  border: "#2C4A68",
  card: "#142C44",
  "card-foreground": "#EDE7D5",
  "chart-1": "#8FB4D6",
  "chart-2": "#E08A3C",
  "chart-3": "#6E88A1",
  "chart-4": "#C9B98F",
  "chart-5": "#D9705F",
  destructive: "#D9705F",
  "destructive-foreground": "#21100C",
  foreground: "#E8E1CE",
  "grid-line": "#1B3550",
  input: "#3A5876",
  muted: "#1A3350",
  "muted-foreground": "#B0AA99",
  popover: "#17324C",
  "popover-foreground": "#EDE7D5",
  primary: "#E08A3C",
  "primary-foreground": "#14283E",
  ring: "#E08A3C",
  secondary: "#1E3A57",
  "secondary-foreground": "#E8E1CE",
  sidebar: "#0C1F33",
  "sidebar-accent": "#1E3A57",
  "sidebar-accent-foreground": "#E8E1CE",
  "sidebar-border": "#24466B",
  "sidebar-foreground": "#E8E1CE",
  "sidebar-primary": "#E08A3C",
  "sidebar-primary-foreground": "#14283E",
  "sidebar-ring": "#E08A3C",
  track: "#223E5C",
};

/** 两套家族的完整定义。 */
export const THEME_FAMILIES: Readonly<Record<ThemeFamily, FamilyDefinition>> = {
  atlas: {
    ...ATLAS_COMMON,
    dark: ATLAS_DARK,
    light: ATLAS_LIGHT,
  },
  default: {
    ...DEFAULT_COMMON,
    dark: DEFAULT_DARK,
    light: DEFAULT_LIGHT,
  },
};

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
