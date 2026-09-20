# tasks.md — wireframe (kuma-dashboard)

> 本阶段的**任务清单与进度**，与 `plan.md` 一起在每轮深挖后覆写，不新建副本。
> 编号顺序即产出顺序；只有非线性依赖才在行尾补 `(依赖: 1.2)`。
> 状态机：待执行是空方框；进行中是空方框加行尾 `⏳ in_progress`；完成是打勾方框并紧跟一条验证子行。
> 一次只推进一项：先标进行中，产出后立刻勾选并写验证子行，不批量补勾。

## 任务

- [x] 1.1 生成主面板骨架 (验收:HTML 结构完整、四个语义区块占位符与 data-wireframe-block/data-priority 就位、空 style/script 标签存在;产出:current/screens/01-dashboard.html)
  验证: 空 div.wf-page 与 header/main 五块占位齐、每块带 id=P1-N + data-wireframe-block + data-priority、style 与 script 标签存在且为空 · 06:52
- [x] 1.2 填充线框 tokens 与栅格 (验收:仅用 background/foreground/border/muted 四基础 token、8pt 间距节奏、1280 栅格;产出:current/screens/01-dashboard.html)
  验证: 亮/暗两组各只有 background·foreground·border·muted 四个变量，全文件无 hex/oklch 直写（仅变量定义处）；间距均为 8 的倍数，.wf-page max-width 1280 · 06:53
- [x] 1.3 实现页面头部与周期切换 (验收:标题、1h/24h/7d/30d 按钮组、亮暗与语言切换按钮就位;产出:current/screens/01-dashboard.html)
  验证: 头部含 id=P1-1-T1 标题、id=P1-1-S1 四个周期按钮（24小时默认 aria-pressed=true）、id=P1-1-B1/B2 两个切换按钮 · 06:54
- [x] 1.4 实现花费概览块 P0 (验收:本期花费/token 总量/请求数/覆盖项目数四项可见，位于首屏最上;产出:current/screens/01-dashboard.html)
  验证: 概览为首屏第一块，四张指标卡 id 分别 P1-2-C1..C4，依次显示花费 ¥12.48 / token 3,482,910 / 请求 1,204 / 项目 2 · 06:55
- [x] 1.5 实现用量归因块 P0 (验收:项目/会话/供应商-模型三档切换、明细表含 维度/花费/token/请求数/占比;产出:current/screens/01-dashboard.html)
  验证: id=P1-3-S1 三档按钮（按项目默认选中），id=P1-3-T1 表头为 维度/花费/Token/请求数/占比，含 2 行明细与合计行 · 06:56
- [x] 1.6 实现供应商健康块 P1 (验收:卡片网格降为次级块、保留状态/延迟/价格三行与单卡刷新;产出:current/screens/01-dashboard.html)
  验证: 块位于归因之后且 data-priority=P1；id=P1-4-L1 三张卡片各含 状态/价格·千tok/TTFT/最近探测 与单卡刷新按钮，id=P1-4-B1 为全部刷新 · 06:57
- [x] 1.7 实现趋势块 (验收:图表区域占位、与周期切换联动关系标注清楚;产出:current/screens/01-dashboard.html)
  验证: id=P1-5-C1 斜纹占位块含 role=img 与 aria-label，块头写明「随上方周期切换重绘」，块尾写明离线降级行为 · 06:58
- [x] 1.8 生成零数据引导态 (验收:说清三条产生数据的路径、含返回主面板入口;产出:current/screens/02-empty.html)
  验证: id=P2-1 块内 id=P2-1-L1 列三条路径（配置供应商 / 跑一轮会话 / 打开探测），id=P2-1-A1 链回 01-dashboard.html；发现并删除一行误写的 <link rel=stylesheet> · 06:59
- [x] 1.9 核对块优先级与语义 ID (验收:每块 data-wireframe-block+data-priority 齐全、可修改元素 id 等于字典短码;产出:current/screens/01-dashboard.html,current/screens/02-empty.html)
  验证: 7 个块全部带 data-wireframe-block+data-priority（主面板 5 块 P0/P0/P0/P1/P1）；HTML 的 21 个语义 id 与字典 short 集合 diff 为空，无重复 id；全文件无 hex/rgb/hsl 硬编码色值 · 07:01

### 第 2 轮（迭代 · 基线 v1）

- [x] 3.1 供应商健康块由方块网格改为行列表 (验收:每行 32px、六列信息不丢、状态只由指示灯表达;产出:current/screens/01-dashboard.html)
  验证: .wf-cards 已删（grep 计数 0），.wf-list/.wf-list-row/.wf-lamp 就位；三行各带 data-state=up/down/unknown，状态文本移入 aria-label；短码 P1-4/P1-4-L1/P1-4-B1 未变 · 08:01
- [x] 3.2 块头加账户详情入口 + 字典同步 (验收:可从主面板跳到账户页、字典 behavior 反映新形态;产出:current/screens/01-dashboard.html)
  验证: 块头新增指向 ../../../accounts/wireframe/current/screens/01-accounts.html 的链接；semantic-ui-map.yaml 中 dashboard.vendors.behavior 已改为「行列表 + 指示灯」，product-map.json 新增 dashboard → accounts 链接 · 08:03

## 阻塞与决定

<!-- 卡住时记录：卡在哪一条、为什么、下一步等谁发话 -->

- 第 2 轮迭代：`prototype_gate` 二选一卡由用户选「现在就改」，基线 v1（本次快照后该许可自动过期）。
- 账户页属于另一个页面阶段（`pages/accounts/`），单独过一次闸门，v0 起版。
