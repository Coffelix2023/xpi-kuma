## REMOVED Requirements

### Requirement: 在 Footer 显示会话统计
**Reason**: 与 Pi 内置 footer 的 stats 行重复。内置行已显示 token 明细（`↑input ↓output RcacheRead WcacheWrite`）、缓存命中率、费用（`$cost`）与 context 占用；本扩展另起一行的 `💰 ¥… | 📊 …` 不提供新信息。
**Migration**: 需要会话级 token 与费用时，直接查看 Pi 内置 footer 的 stats 行（token 明细 + `$cost`）。

### Requirement: 仅统计当前会话
**Reason**: 该口径存在的前提是 footer 需要会话累计值；footer 显示移除后此约束无承载对象。
**Migration**: 内置 footer 的累计口径绑定当前会话的 session entries，语义等价；跨会话统计改用面板的周期聚合。

### Requirement: 状态栏 ID 唯一性
**Reason**: 本扩展不再调用 `ctx.ui.setStatus()`，`"xpi-kuma"` 状态键随之取消注册，唯一性约束失去对象。
**Migration**: 无。其他扩展的状态键不受影响。

### Requirement: 实时更新
**Reason**: 依赖 `turn_end` 事件刷新 footer；footer 显示移除后该刷新链路一并删除。
**Migration**: 无。内置 footer 由 Pi 自身在渲染时计算，实时性由宿主保证。

### Requirement: 格式化显示规则
**Reason**: `¥` 两位小数与 `K`/`M` 缩写两套规则仅服务 footer 文案，且 `¥` 与 Pi usage cost 的美元单位不符，属于错误标注。
**Migration**: 无。货币符号以 Pi 内置 footer 的 `$` 为准。

### Requirement: 清除状态
**Reason**: 仅在 `session_shutdown` 清除本扩展注册的状态键；不再注册即无状态可清。
**Migration**: 无。

### Requirement: 容错处理
**Reason**: 降级文案（`💰 -`、`📊 -`）只用于 footer 显示路径；该路径整体移除。
**Migration**: 无。使用量落库与聚合查询的容错要求保留在 `usage-collection` capability。
