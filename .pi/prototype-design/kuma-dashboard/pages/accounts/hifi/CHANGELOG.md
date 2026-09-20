# CHANGELOG — hifi

> 最新迭代在最上方，倒序排列。每轮产出后由 `prototype_snapshot` 追加一条。

<!-- ENTRIES -->

## 2026-09-16 08:42 · v4
- 变更：修正印刷家族下标题带内控件文字色（账户页「返回主面板 / 同步全部余额」原本不可见）
- 原因：与主面板同一处漏改；实测计算色 rgb(20,40,62) 压在 #0C1F33 带底上。
- 文件：`current/screens/01-accounts.html`
- 回滚到 v3：cp -R .pi/prototype-design/kuma-dashboard/accounts/hifi/v3/. .pi/prototype-design/kuma-dashboard/accounts/hifi/current/

## 2026-09-16 08:41 · v3
- 变更：账户页套用复古印刷家族（方格纸底 + 藏青标题带 + 卡片强调线）
- 原因：与主面板共用同一家族语言，切换后两页观感一致。
- 文件：`current/screens/01-accounts.html`
- 回滚到 v2：cp -R .pi/prototype-design/kuma-dashboard/accounts/hifi/v2/. .pi/prototype-design/kuma-dashboard/accounts/hifi/current/

## 2026-09-16 08:23 · v2
- 变更：账户页跟随 kuma.family 家族偏好（读偏好 + 首帧套用 data-family）
- 原因：账户页页头不新增主题按钮，但观感必须与主面板一致。
- 文件：`current/screens/01-accounts.html`
- 回滚到 v1：cp -R .pi/prototype-design/kuma-dashboard/accounts/hifi/v1/. .pi/prototype-design/kuma-dashboard/accounts/hifi/current/

## 2026-09-16 08:05 · v1
- 变更：首版高保真：供应商账户页（概览 + 六列列表 + 三档来源徽标 + 空态说明）
- 原因：线框 v1 已确认；三档来源编码沿用线框的实线/虚线/点线，升级为徽标。
- 文件：`current/screens/01-accounts.html`
