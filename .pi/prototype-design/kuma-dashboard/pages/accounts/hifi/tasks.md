# tasks.md — hifi (kuma-dashboard / accounts)

> 本阶段的**任务清单与进度**，与 `plan.md` 一起在每轮深挖后覆写，不新建副本。
> 编号顺序即产出顺序；只有非线性依赖才在行尾补 `(依赖: 1.2)`。
> 状态机：待执行是空方框；进行中是空方框加行尾 `⏳ in_progress`；完成是打勾方框并紧跟一条验证子行。
> 一次只推进一项：先标进行中，产出后立刻勾选并写验证子行，不批量补勾。

## 任务

- [x] 5.1 生成账户页高保真骨架 (验收:HTML 结构完整、四个语义区块占位与线框同构;产出:current/screens/01-accounts.html)
  验证: 四块占位（id=P3-1..P3-4 与线框一致）、style 与两个 script 就位、首帧主题脚本在 head 内 · 08:29
- [x] 5.2 写入 token、排版与页头 (验收:与主面板同一套 token、返回链与同步按钮可聚焦;产出:current/screens/01-accounts.html)
  验证: :root/.dark 变量与主面板逐字一致；id=P3-1-A1 指向 dashboard/hifi 的 01-dashboard.html、id=P3-1-B1 同步按钮就位；.dim 与主面板同为 60/40 派生值 · 08:31
- [x] 5.3 实现账户概览 (验收:累计充值/当前余额两项，未知值不显示为 0;产出:current/screens/01-accounts.html)
  验证: id=P3-2-C1 累计充值 ¥550.00、id=P3-2-C2 当前余额 ¥175.80；子行分别注明手工值与过期旧值的来源；无任何 0 值冒充缺失数据 · 08:33
- [x] 5.4 实现账户列表与来源徽标 (验收:六列表头齐全、三档徽标样式可辨、手动值弱化处理;产出:current/screens/01-accounts.html)
  验证: id=P3-3-T1 六列表头齐全；.src[data-src=api|oauth|manual] 分别 solid/dashed/dotted；「未知」用斜体而非 ¥0.00，手工值与旧值用 .stale 弱化；id=P3-3-B1/B2 授权与编辑入口就位；图例说明三档编码 · 08:36
- [x] 5.5 实现空态与取数顺序说明 (验收:与线框同构、三档降级顺序写清;产出:current/screens/01-accounts.html)
  验证: id=P3-4-T1 三条与线框逐条对应（无供应商 / 有供应商但无数字 / 三档取数顺序），保留「未知而非 ¥0.00」的规则 · 08:38
- [x] 5.6 实现主题与语言切换 (验收:与主面板一致的持久化行为、首帧不闪烁;产出:current/screens/01-accounts.html)
  验证: head 内首帧脚本先读 kuma.theme / kuma.lang；页内读同一组 localStorage 键，切主题或语言后与本页保持一致；切换入口只留在主面板（本页不新增字典外的按钮） · 08:44
- [x] 5.7 无障碍与自检 (验收:焦点可见、对比度达标、零外部请求、id 与字典一致;产出:current/screens/01-accounts.html)
  验证: grep 无 http(s)/script src/link/@import → 零外部请求；无 hex 直写；:focus-visible 与 prefers-reduced-motion 就位；.dim/.btn-quiet 与主面板同用 60/40 派生值（对比度实测 5.66/4.92）；12 个 P3 短码与字典 diff 为空；内联脚本语法检查通过 · 08:47

## 阻塞与决定

- 授权与手填需要表单结构，线框未定义：本阶段不加模态，按钮只保留可点状态。
- 本页不提供主题/语言切换入口（线框的页头只有返回链与同步按钮）。切换在主面板完成后，本页读取同一组 localStorage 键保持一致；曾尝试在页头动态注入两个按钮，因会引入字典外的短码（P3-1-B2/B3）而回退。

### 第 2 轮（迭代 · 基线 v1）

- [x] 6.1 账户页跟随家族偏好 (验收:读取 kuma.family、首帧套用 data-family;产出:current/screens/01-accounts.html)
  验证: 首帧脚本与页内脚本都读 kuma.family；页头未新增按钮（维持既有决定）· 09:18

### 第 3 轮（迭代 · 基线 v2）

- [x] 7.1 账户页套用印刷家族 (验收:方格纸底 + 标题带 + 卡片强调线，无索引轨;产出:current/screens/01-accounts.html)
  验证: 与主面板共用同一份家族块与风格增量块；页头未新增按钮；无索引轨所以不留右边距 · 09:36
