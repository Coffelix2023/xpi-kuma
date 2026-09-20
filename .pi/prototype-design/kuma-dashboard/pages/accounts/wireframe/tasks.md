# tasks.md — wireframe (kuma-dashboard / accounts)

> 本阶段的**任务清单与进度**，与 `plan.md` 一起在每轮深挖后覆写，不新建副本。
> 编号顺序即产出顺序；只有非线性依赖才在行尾补 `(依赖: 1.2)`。
> 状态机：待执行是空方框；进行中是空方框加行尾 `⏳ in_progress`；完成是打勾方框并紧跟一条验证子行。
> 一次只推进一项：先标进行中，产出后立刻勾选并写验证子行，不批量补勾。

## 任务

- [x] 2.1 生成账户页骨架 (验收:HTML 结构完整、三块占位符与 data-wireframe-block/data-priority 就位、空 style/script 标签存在;产出:current/screens/01-accounts.html)
  验证: 四块占位（acct-header/acct-summary/acct-list/acct-empty）各带 data-wireframe-block+data-priority 与 id=P3-N，style 与 script 存在 · 07:56
- [x] 2.2 填充线框 tokens 与栅格 (验收:与 dashboard 页同一套四基础 token、1280 栅格、8pt 间距;产出:current/screens/01-accounts.html)
  验证: 四个变量与 dashboard 页逐字一致，max-width 1280，间距均为 8 的倍数（含 .wf-table td padding 4px 8px） · 07:57
- [x] 2.3 实现页面头部与账户概览 (验收:标题、返回主面板链、同步全部按钮、累计充值/当前余额两项可见;产出:current/screens/01-accounts.html)
  验证: id=P3-1-A1 返回链（相对路径 ../dashboard/wireframe/current/screens/）与 id=P3-1-B1 同步按钮就位；id=P3-2-C1/C2 显示累计充值 ¥550.00 与当前余额 ¥175.80 · 07:58
- [x] 2.4 实现供应商账户列表 (验收:六列表头齐全、四行各代表一种数据来源状态（API/需授权/授权过期/手动）;产出:current/screens/01-accounts.html)
  验证: id=P3-3-T1 六列表头齐全；四行分别带 data-src=api/oauth(需授权)/oauth(授权过期)/manual，无余额的行给出「授权」入口（id=P3-3-B1/B2）；合计行 ¥175.80 / ¥550.00 · 07:59
- [x] 2.5 实现空态与来源说明 (验收:无账户信息时的引导可见、三档来源与降级顺序写清;产出:current/screens/01-accounts.html)
  验证: id=P3-4-T1 三条：无供应商 / 有供应商但无数字 / 三档取数顺序（接口 → OAuth → 手填）；写明概览显示「未知」而非 ¥0.00 · 08:00
- [x] 2.6 核对块优先级与语义 ID (验收:每块 data-wireframe-block+data-priority 齐全、可修改元素 id 等于字典短码;产出:current/screens/01-accounts.html)
  验证: 4 块全部带 data-wireframe-block+data-priority（P0/P0/P0/P1）；HTML 的 12 个语义 id 与字典 P3-* short 集合 diff 为空；无硬编码色值；两页互链的相对路径均已核对 · 08:04

## 阻塞与决定

- 服务商余额 API 是否存在：未探测，原型按三档并列呈现，不假设某一档可用。
- 手动填写要写盘（字典 `accounts.list.manual` 的 props 标了 `writes-to-disk: true`），与本项目第 3 轮「面板不需要写盘」的答复相反 —— 按本轮答复为准，实现阶段再定写回 config 还是 sqlite。
