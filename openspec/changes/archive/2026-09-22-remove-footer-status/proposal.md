## Why

xpi-kuma 在 footer 上通过 `ctx.ui.setStatus()` 显示的 `💰 ¥0.00 | 📊 0` 与 Pi 内置 footer 的 stats 行重复：内置行已展示 token 明细（`↑input ↓output RcacheRead WcacheWrite`）、缓存命中率、费用和 context 占用。重复之外它还标注了错误的货币符号——Pi 的 usage cost 单位是美元（`dist/core/cache-stats.d.ts`：`Cost is $/million tokens`，内置 footer 显示 `$`），而 xpi-kuma 硬编码了 `¥`。

该指示器独占 footer 一行，是本仓库里唯一只服务于此、不被面板复用的展示逻辑。删除后会话级费用仍由内置 footer 可见，周期聚合统计仍由面板提供。

## What Changes

- **BREAKING**（对 `footer-status` capability）：移除 footer 状态栏显示，不再注册 `"xpi-kuma"` 状态键。
- 删除展示层：`src/lib/format.ts` 及其测试（`formatStatus` / `formatCostBadge` / `formatTokensBadge`，连带无人引用的 `formatTokens` / `formatCost`）。
- 删除会话累加器：`UsageCollector` 的 `sessionTotals` / `getCurrentSessionStats()` / `resetSession()`，以及 `SessionTotals` 类型。落库职责（`record()` 与聚合查询）保持不变。
- 删除宿主接线：`STATUS_KEY`、`clearStatus()`、`updateFooter()`、`turn_end` 与 `session_shutdown` 监听，以及 `session_start` 中的状态写入。
- 同步清理相关测试断言。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `footer-status`: 整个 capability 移除。原本要求"在 Footer 显示会话统计""仅统计当前会话""状态栏 ID 唯一性""实时更新""格式化显示规则""清除状态""容错处理"全部作废，因为该能力与 Pi 内置 footer 重复且货币符号有误。

## Impact

- 代码：`src/lib/format.ts`（删）、`src/types.ts`、`src/collectors/usage-collector.ts`、`src/index.ts`、`src/lib/format.test.ts`（删）、`src/index.test.ts`、`src/collectors/usage-collector.test.ts`
- 规格：`openspec/specs/footer-status/spec.md` 随本变更归档删除
- 数据：无 schema 迁移，数据库表与既有记录不受影响
- 依赖与配置：无新增依赖，无配置项变更
- 用户可观察：footer 少一行 `💰 … | 📊 …`；会话累计费用改看内置 footer 的 `$cost`；周期聚合改看面板
