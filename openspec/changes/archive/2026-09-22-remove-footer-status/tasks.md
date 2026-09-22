## 1. 删除展示层

- [x] 1.1 删除 `src/lib/format.ts` 与 `src/lib/format.test.ts`，验证 `rg -n "formatStatus|formatCost|formatTokens" src/` 无残留引用
- [x] 1.2 复核 `src/ui/` 下确无对 `lib/format` 的引用（面板自带格式化），验证 `rg -n "lib/format" src/ui/` 为空

## 2. 删除会话累加器

- [x] 2.1 从 `src/collectors/usage-collector.ts` 移除 `sessionTotals` 字段、`getCurrentSessionStats()`、`resetSession()` 及 `SessionTotals` import，保留 `record()` 落库与聚合查询方法，验证 `pnpm typecheck` 通过
- [x] 2.2 从 `src/types.ts` 删除 `SessionTotals` 接口，验证 `rg -n "SessionTotals" src/` 为空
- [x] 2.3 更新 `src/collectors/usage-collector.test.ts`，删除针对累加器的用例并保留落库用例，验证该测试文件通过

## 3. 解除宿主接线

- [x] 3.1 从 `src/index.ts` 删除 `STATUS_KEY`、`clearStatus()`、`updateFooter()`，验证 `rg -n "setStatus|STATUS_KEY|clearStatus|updateFooter" src/index.ts` 为空
- [x] 3.2 从 `src/index.ts` 移除 `turn_end` 与 `session_shutdown` 事件监听（两者只服务 footer 刷新与清除），验证 `pi.on(` 调用不再包含这两个事件
- [x] 3.3 移除 `session_start` 中的 `resetSession()` 调用与 `setStatus()` 写入，验证会话启动路径不再触碰 footer
- [x] 3.4 清理 `src/index.test.ts` 中 footer 相关断言与 `fakeCtx` 的 `setStatus` mock，验证该测试文件通过

## 4. 验证与归档

- [x] 4.1 运行 `pnpm typecheck && pnpm -w run lint && pnpm test`，三条命令全部通过
- [x] 4.2 冒烟 `pi -e ./src/index.ts`，验证 footer 不再出现 `xpi-kuma` 状态行，且宿主 stderr 为空、面板开关 `/xpi-kuma` 功能正常
- [x] 4.3 运行 `openspec validate remove-footer-status --strict`，验证变更校验通过
