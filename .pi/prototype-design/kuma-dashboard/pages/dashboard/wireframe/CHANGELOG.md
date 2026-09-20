# CHANGELOG — wireframe

> 最新迭代在最上方，倒序排列。每轮产出后由 `prototype_snapshot` 追加一条。

<!-- ENTRIES -->

## 2026-09-16 07:52 · v2
- 变更：供应商健康块由方块网格改为行列表，状态改用指示灯；块头加账户页入口
- 原因：方块网格垂直占用过大；状态本就三态，文字标签换成指示灯更省横向空间。
- 文件：`current/screens/01-dashboard.html`
- 回滚到 v1：cp -R .pi/prototype-design/kuma-dashboard/dashboard/wireframe/v1/. .pi/prototype-design/kuma-dashboard/dashboard/wireframe/current/

## 2026-09-16 06:51 · v1
- 变更：首版线框：主面板信息架构重构（花费概览置顶）+ 新增用量归因块 + 零数据引导态
- 原因：开源用户第一需求是「钱花在哪了」，旧版首屏被供应商探测卡占据；预算与告警经追问后从本轮移除。
- 文件：`current/screens/01-dashboard.html`, `current/screens/02-empty.html`
