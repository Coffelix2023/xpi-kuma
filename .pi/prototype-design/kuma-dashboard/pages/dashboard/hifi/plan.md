# plan.md — hifi (kuma-dashboard / dashboard)

> 本阶段唯一需求事实来源。每轮深挖后**覆写本文件**，不新建副本。

## 1. 目的 (Why)

把线框 `pages/dashboard/wireframe/`（v2）做成可直接看的单文件高保真：把「钱花在哪了」
用真实视觉层级表达出来，并让主题、语言、周期、维度四个切换都真的能用。

## 2. 受众 (Who)

xpi-kuma 开源用户。面板在 Glimpse 原生窗口里打开（1200x800），默认暗色。

## 3. 范围

### 包含

- 结构 1:1 继承线框：头部 / 花费概览 / 用量归因 / 供应商健康 / 趋势
- 零数据引导态：`screens/02-empty.html`
- 交互：周期切换（1h / 24h / 7d / 30d）、归因维度切换（项目 / 会话 / 供应商·模型）、
  亮暗切换、中英切换；后两者写 `localStorage` 且首帧前应用，不闪烁
- 趋势图改**内联 SVG**（唯一数据视图，不用任何图表库）
- 无障碍：语义标签、`aria-label`、可见焦点环、正文对比度 ≥ 4.5:1、`prefers-reduced-motion`

### 不包含

- 供应商详情下钻页、账户页内容（后者是 `pages/accounts/hifi/`）
- 分栏拖拽 resize：本页没有 sidebar、没有分栏面板，该交互没有落点，跳过
- 真实数据接线：页面数据是内联样例，不连 sqlite
- 模态框 / 抽屉（线框未定义，新增结构需先确认）

## 4. 页面清单

| ID | 页面 | 优先级 | 状态覆盖 |
| :--- | :--- | :--- | :--- |
| P1 | 主面板（含趋势图） | P0 | main |
| P2 | 零数据引导态 | P0 | empty |

## 5. 交付形态

- [x] desktop 1280 / 窗口 1200x800
- [ ] mobile 390 —— 不做
- [x] 状态覆盖：main / empty

## 6. 主题与语言

- 配色来源：`<项目根>/THEMES.md`，**全量 token 照抄**（`:root` 与 `.dark` 两套）
- 不新增语义色：状态三态用 `--foreground` / `--destructive` / `--muted-foreground`
- 字体：UI 用 `--font-sans`，数字与路径用 `--font-mono` + `tabular-nums`
- 默认 `dark` + `zh-CN`，两者页内可切换

## 7. 启用技能

- [x] design-token —— 消费 THEMES.md，不改写它
- [x] typography-scale —— sans / mono 分工与数字对齐
- [x] spacing-system —— 8pt 节奏
- [x] dark-mode-design —— 亮暗两套 token 的层级再平衡（surface / border 分档）
- [x] icon-system —— 状态指示灯与少量内联 SVG 图标的尺寸规格
- [x] ux-writing —— 中英文案与空态措辞
- [x] micro-interaction-spec —— hover / focus / 按钮加载态
- [x] loading-states —— 供应商单卡刷新与整页刷新的忙碌态
- [x] design-qa-checklist —— 收尾对照线框验收
- [ ] color-system —— 不扩展语义色，跳过
- [ ] component-spec / state-machine —— 没有 sidebar 与多状态面板，跳过
- [ ] responsive-design —— 桌面原生窗口，跳过

## 8. 任务编排

> 任务清单与进度在同目录 `tasks.md`。

切分理由：`4.1` 骨架 → `4.2` 全量 token（一次写够，后续区块只引用变量）→ 按视觉层级
自上而下填区块（`4.3` ~ `4.7`）→ `4.8` 交互脚本最后写（它要引用所有区块的 id）→
`4.9` 空态换文件 → `4.10` 无障碍与零外部请求自检。

## 9. 成功标准

- [x] 视觉上能一眼看出「花费概览」是首屏主角
- [x] 四个切换全部可用，刷新页面后主题与语言保持
- [x] 整页零外部请求（无 CDN、无字体外链）
- [x] 离线也完整可用

## 10. 未决问题

- [x] 视觉禁忌（上轮未答）—— 按 repo `DESIGN.md` 的克制取向：高密度、弱边框、无装饰性渐变
