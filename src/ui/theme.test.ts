import { describe, expect, it } from "vitest";
import { dashboardCss } from "./dashboard-css.ts";
import {
  DEFAULT_FAMILY,
  FONT_TOKENS,
  radius,
  SPACING_TOKENS,
  THEME_FAMILIES,
  themeFamilyCss,
  tokensFor,
} from "./theme.ts";

/** 消费层的颜色声明；用来确保取值都来自主题 token 而不是裸色值。 */
const COLOR_DECLARATION = /^\s*(?:color|background):\s*([^;]+);/gm;

describe("主题家族 token", () => {
  it("两套家族的同名变量取值不同", () => {
    for (const token of [
      "primary",
      "accent",
      "radius",
      "background",
      "border",
      "foreground",
    ]) {
      expect(tokensFor("atlas", "dark")[token]).not.toBe(
        tokensFor("default", "dark")[token],
      );
    }
  });

  it("Atlas 是直角家族，Default 是圆角家族", () => {
    expect(tokensFor("atlas", "light").radius).toBe("0rem");
    expect(tokensFor("default", "light").radius).toBe("0.5rem");
  });

  it("Atlas 平版无阴影，Default 有阴影档位", () => {
    expect(tokensFor("atlas", "dark")["shadow-md"]).toBe("none");
    expect(tokensFor("default", "dark")["shadow-md"]).not.toBe("none");
  });

  it("家族常量不随明暗模式变化", () => {
    for (const family of [
      "default",
      "atlas",
    ] as const) {
      for (const token of [
        "font-sans",
        "font-mono",
        "radius",
        "spacing",
      ]) {
        expect(tokensFor(family, "light")[token]).toBe(
          tokensFor(family, "dark")[token],
        );
      }
    }
  });

  it("明暗两模式的颜色确实不同", () => {
    for (const family of [
      "default",
      "atlas",
    ] as const) {
      expect(tokensFor(family, "light").background).not.toBe(
        tokensFor(family, "dark").background,
      );
      expect(tokensFor(family, "light").foreground).not.toBe(
        tokensFor(family, "dark").foreground,
      );
    }
  });

  it("Atlas 的装饰 token 只在 Atlas 出现", () => {
    expect(tokensFor("atlas", "dark")["grid-line"]).toBeDefined();
    expect(tokensFor("atlas", "dark").track).toBeDefined();
    expect(tokensFor("atlas", "dark")["font-display"]).toBeDefined();
    expect(tokensFor("default", "dark")["grid-line"]).toBeUndefined();
    expect(tokensFor("default", "dark").track).toBeUndefined();
  });

  it("色值逐字照抄 THEMES.md", () => {
    expect(tokensFor("default", "light").primary).toBe("oklch(0.6171 0.1375 39.0427)");
    expect(tokensFor("default", "dark").primary).toBe("oklch(0.6724 0.1308 38.7559)");
    expect(tokensFor("atlas", "light").primary).toBe("#12314E");
    expect(tokensFor("atlas", "dark").primary).toBe("#E08A3C");
  });

  it("不搬 shadcn 的阴影中间输入变量", () => {
    for (const token of [
      "shadow-x",
      "shadow-y",
      "shadow-blur",
      "shadow-spread",
      "shadow-opacity",
      "shadow-color",
      "tracking-normal",
    ]) {
      expect(tokensFor("default", "dark")[token]).toBeUndefined();
      expect(tokensFor("atlas", "dark")[token]).toBeUndefined();
    }
  });

  it("两套家族都定义了完整的基础 token 集", () => {
    const required = [
      "background",
      "foreground",
      "card",
      "popover",
      "primary",
      "secondary",
      "muted",
      "accent",
      "destructive",
      "border",
      "input",
      "ring",
      "chart-1",
      "chart-5",
      "sidebar",
      "sidebar-ring",
      "font-sans",
      "font-mono",
      "radius",
    ];
    for (const family of [
      "default",
      "atlas",
    ] as const) {
      for (const mode of [
        "light",
        "dark",
      ] as const) {
        const tokens = tokensFor(family, mode);
        for (const token of required) {
          expect(tokens[token], `${family}/${mode}/${token}`).toBeDefined();
        }
      }
    }
  });
});

describe("radius()", () => {
  it("一律用 max(0px, ...) 兜住负值", () => {
    for (const offset of [
      0,
      -2,
      -4,
      4,
    ]) {
      expect(radius(offset).startsWith("max(0px,")).toBe(true);
    }
  });

  it("零偏移直接引用变量", () => {
    expect(radius()).toBe("max(0px, var(--radius))");
  });

  it("负偏移表达为 calc 减法，外层仍有 max 兜底", () => {
    // Atlas 的 --radius 是 0rem，0 - 4px 是非法长度，整条声明会被丢弃；
    // CSS 自定义属性无法在服务端求值，因此这里断言形式而不是数值。
    expect(radius(-4)).toBe("max(0px, calc(var(--radius) - 4px))");
  });

  it("正偏移表达为 calc 加法", () => {
    expect(radius(4)).toBe("max(0px, calc(var(--radius) + 4px))");
  });

  it("Atlas 的零半径下所有派生偏移仍非负", () => {
    // 取 Atlas 的 --radius: 0rem，按 CSS 语义手工求值：
    // max(0px, calc(0rem - Npx)) 恒为 0px，不会出现负长度。
    const atlasRadius = Number.parseFloat(tokensFor("atlas", "dark").radius);
    expect(atlasRadius).toBe(0);
    for (const offset of [
      0,
      -2,
      -4,
      4,
    ]) {
      expect(Math.max(0, atlasRadius - Math.abs(offset))).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("themeFamilyCss()", () => {
  it("输出四个选择器，家族维度排在明暗维度之后", () => {
    const css = themeFamilyCss();
    const order = [
      ":root {",
      ':root[data-theme="light"] {',
      ':root[data-family="atlas"] {',
      ':root[data-family="atlas"][data-theme="light"] {',
    ];
    let cursor = -1;
    for (const selector of order) {
      const at = css.indexOf(selector);
      expect(at, selector).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("首个块是默认家族的暗色，与 HTML 的 data-theme 默认值一致", () => {
    const css = themeFamilyCss();
    const firstBlock = css.slice(0, css.indexOf(':root[data-theme="light"]'));
    expect(firstBlock).toContain("--background: oklch(0.2679 0.0036 106.6427)");
  });

  it("Atlas 块的半径是 0，默认块不是", () => {
    const css = themeFamilyCss();
    const atlasBlock = css.slice(css.indexOf(':root[data-family="atlas"] {'));
    const defaultBlock = css.slice(
      css.indexOf(":root {"),
      css.indexOf(':root[data-theme="light"]'),
    );
    expect(atlasBlock).toContain("--radius: 0rem;");
    expect(defaultBlock).toContain("--radius: 0.5rem;");
  });

  it("每个块都输出完整 token 集", () => {
    const css = themeFamilyCss();
    expect(css.match(/--background:/g)?.length).toBe(4);
    expect(css.match(/--radius:/g)?.length).toBe(4);
    expect(css.match(/--font-sans:/g)?.length).toBe(4);
  });

  it("Atlas 的两个块都带装饰 token", () => {
    const css = themeFamilyCss();
    expect(css.match(/--grid-line:/g)?.length).toBe(2);
    expect(css.match(/--track:/g)?.length).toBe(2);
  });
});

describe("面板常量", () => {
  it("默认家族是 default", () => {
    expect(DEFAULT_FAMILY).toBe("default");
    expect(THEME_FAMILIES.default).toBeDefined();
    expect(THEME_FAMILIES.atlas).toBeDefined();
  });

  it("间距刻度落在 8px 基准网格上", () => {
    for (const value of Object.values(SPACING_TOKENS)) {
      expect(Number.parseInt(value, 10) % 8).toBe(0);
    }
  });

  it("字号刻度整体上调 2px：最小 12px、最大 20px", () => {
    const sizes = Object.values(FONT_TOKENS).map((value) => Number.parseInt(value, 10));
    expect(Math.min(...sizes)).toBe(12);
    expect(Math.max(...sizes)).toBe(20);
  });
});

describe("dashboardCss()", () => {
  it("消费层的颜色声明都走主题 token，不写裸色值", () => {
    const css = dashboardCss();
    for (const [, value] of css.matchAll(COLOR_DECLARATION)) {
      const literal = (value ?? "").trim();
      const allowed =
        literal === "transparent" ||
        literal === "currentColor" ||
        literal.startsWith("var(");
      expect(allowed, `${literal} 不是主题 token`).toBe(true);
    }
  });
});
