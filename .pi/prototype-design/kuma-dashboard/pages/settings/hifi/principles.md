# principles.md — hifi

> 高保真阶段的硬约束。与本文档冲突的做法一律视为缺陷。

## 硬约束

- 自包含单文件 HTML：内联 CSS/JS，零外部请求、零构建步骤
- 色值只来自 `THEMES.md`；不新增 token、不硬编码 hex
- 默认暗色：`<html class="dark">`，切换按钮写 `localStorage` 并在首帧前生效
- 语言默认 `zh-CN`；文案走 `window.__i18n`，切换即时生效
- shadcn 外观复刻：`--radius`、border、muted 层级与 shadcn 一致
- sidebar 与分栏面板可拖拽 resize（pointer events，键盘可达）
- 状态必须齐全：正常 / 空 / 加载 / 错误

## 无障碍底线

- 语义标签 + `aria-label`；`lang` 与主题同步更新
- 正文对比度 ≥ 4.5:1；焦点可见
- 尊重 `prefers-reduced-motion`

## 禁止

- React / Vue / Tailwind CDN / 任何构建产物
- 装饰性渐变、无意义动效
