## Why

开发者使用多个 AI 模型供应商（OpenAI、Claude 中转站、9router 网关等）时，缺乏统一的成本与性能监控。无法回答"本月各供应商花费多少"、"哪个供应商响应最快"、"缓存命中率如何"等关键问题，导致成本失控和供应商选择缺乏数据支撑。Pi 已内置完整的 token 使用量统计（通过 `message_end` 事件），但数据散落在每次对话中，无法跨会话聚合、对比和趋势分析。

## What Changes

- 新增 **使用量收集器 (Usage Collector)**：监听 Pi 的 `message_end` 事件，自动记录每次 LLM 调用的 token 使用量（input/output/cacheRead/cacheWrite）和费用到本地 SQLite 数据库
- 新增 **供应商性能探测器 (Vendor Monitor)**：定期向配置的供应商发送测试请求，测量 TTFT（首字延迟）和总响应时间，评估可用性状态（up/down/degraded）
- 新增 **Glimpse 监控面板**：通过 `/xpi-kuma` 命令打开原生窗口，展示：
  - 供应商卡片网格（状态、价格、性能指标）
  - 多时间维度使用量统计（1小时/24小时/7天/30天）
  - 费用与 token 趋势图表
- 新增 **Footer 状态栏**：实时显示当前会话的累计费用和 token 用量
- 新增配置文件 `.pi/xpi-kuma/config.yaml`：定义监控的供应商列表、探测间隔、数据保留策略

## Capabilities

### New Capabilities

- `usage-collection`: 通过 Pi 扩展 API 的 `message_end` 事件自动收集真实 token 使用量和费用，存储到本地 SQLite 数据库，支持按供应商/模型/时间范围聚合查询
- `vendor-monitoring`: 定期主动探测配置的 AI 模型供应商的性能（TTFT、响应时间）和可用性，记录探测结果到数据库
- `dashboard-ui`: 提供 Glimpse 原生窗口监控面板，展示供应商状态、使用量统计和趋势图表
- `footer-status`: 在 Pi 的 footer 状态栏实时显示当前会话的费用和 token 统计

### Modified Capabilities

<!-- No existing capabilities are being modified -->

## Impact

**新增文件**：
- `src/collectors/usage-collector.ts` - 使用量收集器
- `src/monitors/vendor-monitor.ts` - 供应商探测器
- `src/ui/dashboard.ts` - Glimpse 面板实现
- `src/storage/database.ts` - SQLite 数据库封装
- `src/types.ts` - 类型定义
- `.pi/xpi-kuma/config.yaml` - 配置文件模板

**修改文件**：
- `src/index.ts` - 注册事件监听器（`message_end`、`session_start`、`session_shutdown`、`turn_end`）和 `/xpi-kuma` 命令

**新增依赖**：
- `better-sqlite3` - 轻量级 SQLite 数据库
- `glimpseui` - 原生窗口渲染（已在 Pi 生态中）
- 可能需要 `chart.js` 或类似库用于趋势图表

**影响范围**：
- 仅影响安装了此扩展的用户
- 不修改 Pi 核心行为
- 数据存储在 `~/.pi/agent/data/xpi-kuma/` 下，不影响其他扩展
- 探测请求会消耗少量 token（每次探测约 1-2 input tokens），用户可配置探测间隔或禁用
