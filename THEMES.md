# THEMES.md

> **默认家族：Default-Themes + dark**（本文件第一段）。
> Atlas-Themes（复古印刷风）是**可选**第二家族，不参与默认渲染。
> 原型里由 `<html class="dark">` 表达默认；`data-family="atlas"` 只在用户显式切换后出现，
> 偏好存 `localStorage` 的 `kuma.family`（缺省即默认家族）。

## Default-Themes

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(0.9818 0.0054 95.0986);
  --foreground: oklch(0.3438 0.0269 95.7226);
  --card: oklch(0.9818 0.0054 95.0986);
  --card-foreground: oklch(0.1908 0.0020 106.5859);
  --popover: oklch(1.0000 0 0);
  --popover-foreground: oklch(0.2671 0.0196 98.9390);
  --primary: oklch(0.6171 0.1375 39.0427);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.9245 0.0138 92.9892);
  --secondary-foreground: oklch(0.4334 0.0177 98.6048);
  --muted: oklch(0.9341 0.0153 90.2390);
  --muted-foreground: oklch(0.6059 0.0075 97.4233);
  --accent: oklch(0.9245 0.0138 92.9892);
  --accent-foreground: oklch(0.2671 0.0196 98.9390);
  --destructive: oklch(0.1908 0.0020 106.5859);
  --destructive-foreground: oklch(1.0000 0 0);
  --border: oklch(0.8847 0.0069 97.3627);
  --input: oklch(0.7621 0.0156 98.3528);
  --ring: oklch(0.6171 0.1375 39.0427);
  --chart-1: oklch(0.5583 0.1276 42.9956);
  --chart-2: oklch(0.6898 0.1581 290.4107);
  --chart-3: oklch(0.8816 0.0276 93.1280);
  --chart-4: oklch(0.8822 0.0403 298.1792);
  --chart-5: oklch(0.5608 0.1348 42.0584);
  --sidebar: oklch(0.9663 0.0080 98.8792);
  --sidebar-foreground: oklch(0.3590 0.0051 106.6524);
  --sidebar-primary: oklch(0.6171 0.1375 39.0427);
  --sidebar-primary-foreground: oklch(0.9881 0 0);
  --sidebar-accent: oklch(0.9245 0.0138 92.9892);
  --sidebar-accent-foreground: oklch(0.3250 0 0);
  --sidebar-border: oklch(0.9401 0 0);
  --sidebar-ring: oklch(0.7731 0 0);
  --font-sans: Inter, ui-sans-serif, sans-serif, system-ui;
  --font-serif: Noto Serif, ui-serif, serif;
  --font-mono: JetBrains Mono, ui-monospace, monospace;
  --radius: 0.5rem;
  --shadow-x: 0;
  --shadow-y: 1px;
  --shadow-blur: 3px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.1;
  --shadow-color: oklch(0 0 0);
  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);
  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);
  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);
  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);
  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);
  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);
  --tracking-normal: 0em;
  --spacing: 0.25rem;
}

.dark {
  --background: oklch(0.2679 0.0036 106.6427);
  --foreground: oklch(0.8074 0.0142 93.0137);
  --card: oklch(0.2679 0.0036 106.6427);
  --card-foreground: oklch(0.9818 0.0054 95.0986);
  --popover: oklch(0.3085 0.0035 106.6039);
  --popover-foreground: oklch(0.9211 0.0040 106.4781);
  --primary: oklch(0.6724 0.1308 38.7559);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.9818 0.0054 95.0986);
  --secondary-foreground: oklch(0.3085 0.0035 106.6039);
  --muted: oklch(0.2213 0.0038 106.7070);
  --muted-foreground: oklch(0.7713 0.0169 99.0657);
  --accent: oklch(0.2130 0.0078 95.4245);
  --accent-foreground: oklch(0.9663 0.0080 98.8792);
  --destructive: oklch(0.6368 0.2078 25.3313);
  --destructive-foreground: oklch(1.0000 0 0);
  --border: oklch(0.3618 0.0101 106.8928);
  --input: oklch(0.4336 0.0113 100.2195);
  --ring: oklch(0.6724 0.1308 38.7559);
  --chart-1: oklch(0.5583 0.1276 42.9956);
  --chart-2: oklch(0.6898 0.1581 290.4107);
  --chart-3: oklch(0.2130 0.0078 95.4245);
  --chart-4: oklch(0.3074 0.0516 289.3230);
  --chart-5: oklch(0.5608 0.1348 42.0584);
  --sidebar: oklch(0.2357 0.0024 67.7077);
  --sidebar-foreground: oklch(0.8074 0.0142 93.0137);
  --sidebar-primary: oklch(0.3250 0 0);
  --sidebar-primary-foreground: oklch(0.9881 0 0);
  --sidebar-accent: oklch(0.1680 0.0020 106.6177);
  --sidebar-accent-foreground: oklch(0.8074 0.0142 93.0137);
  --sidebar-border: oklch(0.9401 0 0);
  --sidebar-ring: oklch(0.7731 0 0);
  --font-sans: Inter, ui-sans-serif, sans-serif, system-ui;
  --font-serif: Noto Serif, ui-serif, serif;
  --font-mono: JetBrains Mono, ui-monospace, monospace;
  --radius: 0.5rem;
  --shadow-x: 0;
  --shadow-y: 1px;
  --shadow-blur: 3px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.1;
  --shadow-color: oklch(0 0 0);
  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);
  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);
  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);
  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);
  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);
  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-serif: var(--font-serif);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

## Atlas-Themes (v2 · 复古印刷风 / Vintage Editorial)

> 来源：`docs/references/themes/themes-01.md`，逐字转入，**未改动任何色值**。
> v1（图鉴风，来源 `themes-02.md`）已按用户反馈停用：亮色版结构线是暖灰 `#E9E2D8`，缺乏蓝色结构。
> v1 的原始 token 仍保留在 `docs/references/themes/themes-02.md`，未删除。
> 与 Default-Themes 并列：hex 而非 oklch、全直角、平版无阴影、奶油纸 + 普鲁士蓝 + 柿橙。

```css
/* themes.md —— 复古印刷风（Vintage Editorial / Retro Print）主题
   适用：Tailwind CSS v4.3+ / shadcn-ui v4 / Next.js 16+
   用法：替换 app/globals.css 中同名变量块；暗色模式由 <html class="dark"> 触发 */
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  /* 纸面：奶油纸 */
  --background: #F2ECDF;
  --foreground: #1A3A58;
  --card: #F7F2E6;
  --card-foreground: #1A3A58;
  --popover: #FAF6EB;
  --popover-foreground: #1A3A58;
  /* 结构色：普鲁士蓝（标题栏、徽章、双线框） */
  --primary: #12314E;
  --primary-foreground: #F6F1E4;
  --secondary: #E6DECA;
  --secondary-foreground: #1A3A58;
  --muted: #EBE4D2;
  --muted-foreground: #6E6A5E;
  /* 高亮色：柿橙（编号、激活态、图表线） */
  --accent: #DD7A1C;
  --accent-foreground: #FFF8EA;
  --destructive: #AF3A2C;
  --destructive-foreground: #FFF8EA;
  --border: #24425E;
  --input: #4A6478;
  --ring: #DD7A1C;
  --chart-1: #12314E;
  --chart-2: #DD7A1C;
  --chart-3: #7A93AC;
  --chart-4: #C9B98F;
  --chart-5: #AF3A2C;
  /* 索引轨：藏青底（对应 ATLAS INDEX 侧栏） */
  --sidebar: #12314E;
  --sidebar-foreground: #F2ECDF;
  --sidebar-primary: #DD7A1C;
  --sidebar-primary-foreground: #FFF8EA;
  --sidebar-accent: #1E3E5E;
  --sidebar-accent-foreground: #F2ECDF;
  --sidebar-border: #2A4A66;
  --sidebar-ring: #DD7A1C;
  /* 扩展令牌：方格纸线 / 进度条轨道 */
  --grid-line: #E1D9C5;
  --track: #D9D4C8;
  /* 字体：宋体衬线标题 + 窄体编号 + 等宽小标签 */
  --font-sans: "Noto Sans SC", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Noto Serif SC", "Songti SC", Georgia, ui-serif, serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
  --font-display: "Oswald", "Arial Narrow", "Noto Sans SC", sans-serif;
  /* 印刷直角 + 平版无阴影 */
  --radius: 0rem;
  --shadow-x: 0;
  --shadow-y: 0;
  --shadow-blur: 0;
  --shadow-spread: 0px;
  --shadow-opacity: 0;
  --shadow-color: #12314E;
  --shadow-2xs: none;
  --shadow-xs: none;
  --shadow-sm: none;
  --shadow: none;
  --shadow-md: none;
  --shadow-lg: none;
  --shadow-xl: none;
  --shadow-2xl: none;
  --tracking-normal: 0em;
  --spacing: 0.25rem;
}

.dark {
  /* 夜纸：藏青底 + 奶油字 + 橙高亮 */
  --background: #0F2438;
  --foreground: #E8E1CE;
  --card: #142C44;
  --card-foreground: #EDE7D5;
  --popover: #17324C;
  --popover-foreground: #EDE7D5;
  --primary: #E08A3C;
  --primary-foreground: #14283E;
  --secondary: #1E3A57;
  --secondary-foreground: #E8E1CE;
  --muted: #1A3350;
  --muted-foreground: #B0AA99;
  --accent: #C8781F;
  --accent-foreground: #14283E;
  --destructive: #D9705F;
  --destructive-foreground: #21100C;
  --border: #2C4A68;
  --input: #3A5876;
  --ring: #E08A3C;
  --chart-1: #8FB4D6;
  --chart-2: #E08A3C;
  --chart-3: #6E88A1;
  --chart-4: #C9B98F;
  --chart-5: #D9705F;
  --sidebar: #0C1F33;
  --sidebar-foreground: #E8E1CE;
  --sidebar-primary: #E08A3C;
  --sidebar-primary-foreground: #14283E;
  --sidebar-accent: #1E3A57;
  --sidebar-accent-foreground: #E8E1CE;
  --sidebar-border: #24466B;
  --sidebar-ring: #E08A3C;
  --grid-line: #1B3550;
  --track: #223E5C;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-grid-line: var(--grid-line);
  --color-track: var(--track);
  --font-sans: var(--font-sans);
  --font-serif: var(--font-serif);
  --font-mono: var(--font-mono);
  --font-display: var(--font-display);
  --radius-sm: 0rem;
  --radius-md: 0rem;
  --radius-lg: 0rem;
  --radius-xl: 0rem;
  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

### 风格规则（照抄参考文件）

- 纸面：奶油纸底，方格纸底纹用 `--grid-line` 双向 32px。
- 结构色：普鲁士蓝 `--primary` 用于分区标题带、徽章、双线框。
- 高亮色：柿橙 `--accent` 只作填充（编号、激活态、图表线、标记方块），**不作正文色**。
- 索引轨：藏青底，当前项橙底；左指缺角用 `clip-path` 三角实现。
- 标题带：藏青实底 + 米黄字，左侧一个 `--accent` 实心方块作标记。
- 直角优先：`--radius: 0`；平版无阴影，层级只靠细线与底色差。
- 图表用 `--chart-1`（藏青）/ `--chart-2`（柿橙）两色家族。

### 落地注意（本仓库实测，非参考文件内容）

| 现象 | 实测 | 处理 |
| :--- | :--- | :--- |
| `--radius: 0rem` 与消费方的 `calc(var(--radius) - 4px)` 组合 | **-4px**，非法值 | 消费方一律写 `max(0px, calc(var(--radius) - 4px))` |
| `--accent` 作正文色（亮色） | **2.59:1** on `--background`、2.73:1 on `--card` | 橙色文字用派生值 `color-mix(in oklab, var(--accent) 60%, var(--foreground))`（4.57 / 4.81） |
| `--ring`（柿橙）作焦点环 | **2.59:1**，未达非文字 3:1 | 焦点环改用 `--primary`（11.33 亮 / 5.92 暗） |
| `--accent-foreground`（米黄）在橙底上 | **2.89:1** | 橙底上的文字改用 `--sidebar`（藏青，4.36 亮 / 4.39 暗） |
| 亮色 `--muted-foreground` on `--muted` | **4.26:1**，差一点不到 AA 正文 | 次要文字用既有的 60/40 派生值（本仓库实测 6.66–9.66） |
| hover 底色若沿用 `--accent` | 亮色 4.88 尚可、**暗色 2.60 不达标** | hover 底改 `--secondary`（fg on it：8.75 亮 / 8.95 暗） |
| Default-Themes 与 Atlas-Themes 同时引入 | 同名变量冲突（`--accent` / `--radius` 等值不同） | 两套各自独立；原型用 `[data-family="atlas"]` 隔离 |
