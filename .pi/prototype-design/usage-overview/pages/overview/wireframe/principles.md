# principles.md — wireframe
> 线框阶段的硬约束。与本文档冲突的做法一律视为缺陷。

## 硬约束

- 灰阶 + 内联 SVG；无品牌色、无阴影、无渐变、无动效
- 仅使用 `THEMES.md` 的 `background / foreground / border / muted` 四个基础 token
- 每个块标注 `data-wireframe-block="<id>"` 与优先级 `data-priority="P0|P1|P2"`
- 占位文案贴近真实长度（中文 12–20 字），不用 lorem ipsum
- 栅格与间距遵循 8pt 基准

## 禁止

- 自造色值或 token
- 用真实视觉稿代替结构表达（那是 hifi 阶段的事）
