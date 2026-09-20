# tasks.md — hifi (kuma-dashboard / dashboard)

> 本阶段的**任务清单与进度**，与 `plan.md` 一起在每轮深挖后覆写，不新建副本。
> 编号顺序即产出顺序；只有非线性依赖才在行尾补 `(依赖: 1.2)`。
> 状态机：待执行是空方框；进行中是空方框加行尾 `⏳ in_progress`；完成是打勾方框并紧跟一条验证子行。
> 一次只推进一项：先标进行中，产出后立刻勾选并写验证子行，不批量补勾。

## 任务

- [x] 4.1 生成高保真骨架 (验收:HTML 结构完整、五个语义区块占位与线框同构、空 style/script 就位;产出:current/screens/01-dashboard.html)
  验证: 头部 + 四 section 占位齐（id=P1-1..P1-5 与线框一致）、style 与两个 script 就位、首帧主题脚本在 head 内 · 08:06
- [x] 4.2 写入 THEMES.md 全量 token 与基础排版 (验收:亮暗两套变量齐全、字体与 tabular-nums 就位;产出:current/screens/01-dashboard.html)
  验证: :root 与 .dark 各 40 项变量齐全（含 chart-1..5、sidebar 组、shadow）；--font-sans/--font-mono 分工就位，.num 带 tabular-nums，prefers-reduced-motion 基线存在 · 08:08
- [x] 4.3 实现头部 (验收:标题、更新戳、周期分段控件、主题与语言切换可见且可聚焦;产出:current/screens/01-dashboard.html)
  验证: id=P1-1-T1 标题、id=P1-1-S1 四个周期按钮（24小时 aria-pressed=true）、id=P1-1-B1/B2 两个切换按钮；.btn/.seg 有 hover 与 :focus-visible · 08:09
- [x] 4.4 实现花费概览四卡 (验收:四项指标视觉为全页最强、层级高于其余区块;产出:current/screens/01-dashboard.html)
  验证: 四卡 24px 等宽数字（全页最大字号），标签 11px 大写距；id=P1-2-C1..C4 与线框一致，C1 带较上期对比子行 · 08:10
- [x] 4.5 实现用量归因块 (验收:维度分段控件 + 明细表，数字列右对齐等宽;产出:current/screens/01-dashboard.html)
  验证: id=P1-3-S1 三档分段、表格 id=P1-3-T1 五列（数字列 .num-col 右对齐等宽），占比列带比例条，合计行进 tfoot · 08:12
- [x] 4.6 实现供应商行列表与指示灯 (验收:三态灯有颜色且带 aria-label、行高紧凑、刷新按钮有加载态;产出:current/screens/01-dashboard.html)
  验证: 三行 .vrow 各带 .lamp[data-state] 与 aria-label；up=--foreground 带光晕、down=--destructive、unknown=空心描边；.spinner 关键帧就位供刷新态使用 · 08:14
- [x] 4.7 实现内联 SVG 趋势图 (验收:双轴折线 + 图例齐全、无任何外部请求;产出:current/screens/01-dashboard.html)
  验证: 三条折线（两条实线 = --chart-1/--chart-2，一条虚线 = --muted-foreground）+ 面积 + 三档图例；<title>/<desc> 提供读屏描述；无 script src、无外部链接 · 08:16
- [x] 4.8 实现交互脚本与 i18n (验收:周期/维度/主题/语言四切换可用，主题与语言持久化且首帧不闪烁;产出:current/screens/01-dashboard.html)
  验证: window.__i18n 含 zh-CN/en 两份同键表；四个切换均有事件绑定，主题与语言写 localStorage（kuma.theme / kuma.lang），head 内首帧脚本先读后套 class；忙碌态用 .spinner 原地替换文案 · 08:19
- [x] 4.9 生成零数据引导态 (验收:与线框同构、三条路径与返回入口齐全;产出:current/screens/02-empty.html)
  验证: id=P2-1 / P2-1-L1 / P2-1-A1 与线框一致，三条路径（配置供应商 / 跑一轮会话 / 打开探测）与保留期说明齐全；hifi 新增 P2-1-B1、P2-1-B2 并已登记字典（stage_created: hifi） · 08:22
- [x] 4.10 无障碍与自检 (验收:焦点可见、对比度达标、prefers-reduced-motion 生效、零外部请求、id 与字典一致;产出:current/screens/01-dashboard.html,current/screens/02-empty.html)
  验证: grep 无 http(s)/script src/link/@import/url() → 零外部请求；无 hex 直写；:focus-visible 与 prefers-reduced-motion 就位；对比度实测 dark 正文 8.33 / light 正文 10.98，次要文字原 token 仅 3.66（muted 底 3.17），已用 60/40 派生值改为 5.66 / 4.92 全达标；P1/P2 短码全部命中字典 · 08:26

## 阻塞与决定

- 授权 / 手动填写等表单类结构线框未定义，本阶段不加模态，只保留入口按钮。

### 第 2 轮（迭代 · 基线 v1）

- [x] 6.1 THEMES.md 增加 Atlas-Themes 家族 (验收:参考文件色值逐字转入、夹括号平衡、注明实测落地注意;产出:../../../THEMES.md)
  验证: themes-02.md 的 :root/.dark/@theme inline 三段全量转入，未改任何色值；游离 `}` 行未转入；新增「落地注意」表记录 --radius 负值、light accent 2.77:1、light muted-foreground 4.19:1 三条实测 · 09:05
- [x] 6.2 三页接入家族切换 (验收:data-family 隔离两套 token、页内可切、偏好持久化、无外部请求;产出:current/screens/01-dashboard.html,current/screens/02-empty.html)
  验证: 家族覆盖块三页逐字一致（1763 字节）；--radius:0rem 由 max(0px, calc(...)) 兜住；--accent 当按压底 2.96:1 不达标，选中态改 --primary（两模式 13.5:1）；hover 用 --accent-tint；Atlas 下渲染实测底 #061B2E / 卡 #0B2740 / 边 #17395A / 圆角 0px，控制台 0 报错 · 09:18

### 第 3 轮（迭代 · 基线 v2）

- [x] 7.1 Atlas 家族换成 themes-01 复古印刷配色 (验收:色值照抄、亮色有结构蓝;产出:../../../THEMES.md,current/screens/01-dashboard.html,current/screens/02-empty.html)
  验证: themes-01 的 :root/.dark/@theme inline 全量转入（括号 6/6 平衡）；旧图鉴风 v1 段停用并注明原文件仍在 docs/references/；--radius:0rem 由 max(0px,...) 兜住 · 09:24
- [x] 7.2 印刷风格增量样式 (验收:方格纸底、标题带、索引轨、卡片强调线;产出:current/screens/01-dashboard.html,current/screens/02-empty.html)
  验证: 亮色实测底 #F2ECDF + 方格线、带子藏青 #12314E + 橙方块、索引轨当前项橙底带缺角；暗色实测带子 #0C1F33 + 米黄字、数字橙 #C8781F；控制台 0 报错 · 09:35
- [x] 7.3 印刷家族下的对比度兜底 (验收:焦点环/悬停/橙字三处派生值达标;产出:current/screens/01-dashboard.html)
  验证: --focus-ring 改 --primary（亮 11.33 / 暗 5.92，原橙色 ring 仅 2.59）；--hover-bg 改 --secondary（8.75 / 8.95，原 accent 暗色仅 2.60）；--accent-ink 亮色用 accent 60% + fg 40%（4.57 / 4.81）；带内控件反色漏改一处（P1-4 账户详情链接算成 #14283E）已修 · 09:36
- [x] 7.4 新增分区索引轨 P1-6 (验收:点击滚动 + aria-current 跟随、仅印刷家族显示;产出:current/screens/01-dashboard.html)
  验证: id=P1-6 含 ATLAS INDEX 标题 + 01–04 + TOTAL 脚注；默认家族 display:none；边距用 body:has(.rail) 守卫，账户页不受影响 · 09:37

### 第 4 轮（迭代 · 基线 v4）

- [x] 9.1 供应商健康块头新增「配置体检」入口 (验收:可跳到 settings 页、短码登记进字典;产出:current/screens/01-dashboard.html)
  验证: id=P1-1-B4 指向 ../../../settings/hifi/current/screens/01-settings.html；已登记 dashboard.header.settings-link；product-map 增加 dashboard → settings 链接；标注 21 处 · 10:14
