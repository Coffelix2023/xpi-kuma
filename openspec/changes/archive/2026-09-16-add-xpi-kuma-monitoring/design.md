## Context

xpi-kuma 是一个 Pi 扩展，当前仅有基础骨架（注册一个 `/xpi-kuma` 命令显示版本号）。项目遵循以下约束：
- **无构建步骤**：Pi 直接加载 `src/index.ts`，不使用 bundler
- **Pi 原生 UI**：通过 `ctx.ui.*` 和 `glimpseui` 交互，不劫持终端
- **严格类型检查**：TypeScript strict 模式
- **轻量依赖**：仅在必要时引入依赖，优先使用 Pi 提供的 API

现有目录结构：
```
src/
  └── index.ts  # 扩展入口，需要扩展为完整监控系统
```

参考资料：
- [xpi-research 研究报告](前述对话内容) - 包含 Uptime Kuma 的 MonitorType 抽象、Heartbeat 数据模型、数据清理逻辑
- Pi 扩展 API 文档 - `message_end`、`session_start`、`session_shutdown`、`turn_end` 事件
- Glimpse UI 示例 - 原生窗口渲染

## Goals / Non-Goals

**Goals:**
- 自动收集真实 LLM 使用量数据，零手动操作
- 提供直观的 Glimpse 监控面板
- 最小化探测成本（每次不超过 5 tokens）
- 数据持久化到本地 SQLite，支持跨会话查询
- Footer 状态栏实时显示当前会话统计

**Non-Goals:**
- 不支持多用户/多项目隔离（MVP 阶段）
- 不实现复杂告警规则（仅在 specs 中预留，实现阶段不做）
- 不导出报表功能（后续扩展）
- 不支持非 OpenAI-compatible 的供应商 API（MVP 仅支持标准格式）

## Decisions

### Decision 1: 数据采集策略 - 被动监听为主，主动探测为辅

**选择**：通过 Pi 的 `message_end` 事件收集真实使用量，通过定时探测获取性能指标。

**理由**：
- Pi 的 `message_end` 事件已包含完整的 `usage` 对象（input/output/cacheRead/cacheWrite tokens 和 cost），无需额外 API 调用
- 真实使用量数据准确性 100%，无估算误差
- 性能指标（TTFT、响应时间）无法从事件中获取，需要主动探测
- 探测使用最小 prompt（"hi" + max_tokens=1）将成本控制在每次 1-2 tokens

**替代方案及缺陷**：
- **纯主动探测**：每次探测消耗 tokens，成本高，且探测数据不等于真实使用量
- **从供应商 API 同步**：需要每个供应商提供 usage API，9router 等中转站可能不支持

### Decision 2: 存储方案 - better-sqlite3 + 简单表结构

**选择**：使用 `better-sqlite3` 存储到 `~/.pi/agent/data/xpi-kuma/usage.db`，包含两张表：
- `usage_records`：原始使用量记录（每次 `message_end`）
- `probe_records`：探测结果（每次定时探测）

**理由**：
- `better-sqlite3` 是 Node.js 生态中最轻量的 SQLite 库，同步 API，无回调地狱
- SQLite 无需额外进程，文件数据库易于备份和迁移
- 两张表分离关注点：真实使用量和性能探测数据来源不同，查询模式不同
- 索引 `(provider, model)` 和 `(timestamp)` 加速常见查询

**替代方案及缺陷**：
- **JSON 文件**：并发写入不安全，查询聚合困难
- **内存缓存 + 定期落盘**：会话崩溃导致数据丢失
- **PostgreSQL/MySQL**：过重，需要额外进程

### Decision 3: 聚合计算 - 查询时聚合，不预计算

**选择**：聚合统计（按时间范围和供应商分组）在查询时通过 SQL `SUM()` 和 `GROUP BY` 实时计算。

**理由**：
- 查询频率低（仅在打开面板或刷新时），实时计算性能足够
- 避免维护预聚合表的复杂性（何时更新？如何保证一致性？）
- 数据量预期不大（7天保留期，每天几百条记录），SQL 聚合耗时毫秒级

**替代方案及缺陷**：
- **预聚合表**：需要在每次 `message_end` 时更新，增加写入复杂度，收益不明显
- **后台定时聚合**：数据可能不是最新，且增加后台任务

### Decision 4: 探测调度 - 简单 `setInterval`，不引入调度库

**选择**：为每个启用探测的供应商创建一个 `setInterval` 定时器。

**理由**：
- 需求简单：固定间隔（5分钟、1小时）
- `setInterval` 是 Node.js 内置，零依赖
- 在 `session_shutdown` 时 `clearInterval()` 清理，生命周期清晰

**替代方案及缺陷**：
- **node-cron**：过重，支持 cron 表达式但 MVP 不需要
- **Worker Thread**：增加复杂性，简单定时器足够

### Decision 5: Glimpse UI 实现 - 自包含 HTML，Chart.js 趋势图

**选择**：生成完整的 HTML 字符串，内联 CSS（使用 DESIGN.md 的 oklch tokens），通过 CDN 引入 Chart.js。

**理由**：
- Glimpse 接受 HTML 字符串，无需构建步骤
- Chart.js 是轻量级图表库，CDN 引入无需打包
- 内联 CSS 确保主题一致，避免外部样式文件管理

**替代方案及缺陷**：
- **React/Vue 组件**：需要构建步骤，违反项目约束
- **纯 CSS 图表**：实现复杂，交互性差
- **Canvas 手绘图表**：代码量大，不如成熟库

### Decision 6: Footer 状态实现 - 会话内存累加器

**选择**：在 `session_start` 时初始化一个内存计数器对象 `{ totalCost: 0, totalTokens: 0 }`，每次 `turn_end` 累加，通过 `ctx.ui.setStatus()` 更新。

**理由**：
- Footer 仅显示当前会话统计，不需要持久化
- 内存累加器性能最优，无数据库查询开销
- 会话结束时自动重置（新的 `session_start` 初始化新对象）

**替代方案及缺陷**：
- **每次查询数据库**：`turn_end` 频繁触发，数据库查询耗时不必要
- **依赖 session storage**：Pi 的会话存储用于持久化聊天历史，不适合临时统计

### Decision 7: 配置文件格式 - YAML，放置在 `.pi/xpi-kuma/config.yaml`

**选择**：使用 YAML 格式，路径为 `.pi/xpi-kuma/config.yaml`（项目级配置）。

**理由**：
- YAML 可读性强，适合手动编辑
- `.pi/xpi-kuma/` 遵循 Pi 的项目级扩展配置约定
- 与 Pi 的 `settings.json` 分离，避免污染全局配置

**配置结构**：
```yaml
vendors:
  - name: "OpenAI"
    endpoint: "https://api.openai.com/v1"
    model: "gpt-4"
    api_key: "${OPENAI_API_KEY}"
    probe:
      enabled: true
      interval: "5m"
      timeout: 30000
retention:
  raw_records: 7  # 天
```

## Risks / Trade-offs

### Risk 1: 探测请求失败率高

**风险**：供应商 API 不稳定或限流，导致频繁探测失败，用户看到大量 `down` 状态。

**缓解**：
- 探测超时设置为 30 秒，足够网络波动恢复
- 失败后不立即重试，等下一个间隔周期
- 用户可配置 `probe.enabled: false` 禁用探测

### Risk 2: SQLite 并发写入冲突

**风险**：`message_end` 事件和探测任务可能同时写数据库，SQLite 的写锁可能导致 `SQLITE_BUSY` 错误。

**缓解**：
- `better-sqlite3` 默认启用 WAL 模式（Write-Ahead Logging），支持并发读写
- 设置 `busy_timeout` 为 5000ms，写入冲突时自动重试
- 写入失败记录到日志，不中断 Pi 运行

### Risk 3: Glimpse 窗口性能

**风险**：Chart.js 渲染大量数据点（如 7 天 * 24 小时 = 168 个点）时可能卡顿。

**缓解**：
- 限制图表最多显示 100 个数据点，超过则采样（如 7 天数据按每 2 小时聚合）
- Glimpse 窗口独立进程，不阻塞 Pi 主进程

### Risk 4: 数据保留策略未自动执行

**风险**：用户配置 `retention.raw_records: 7` 但系统未定期清理，导致数据库无限增长。

**缓解**：
- 在 `session_start` 时执行一次清理检查
- 清理逻辑使用 `DELETE FROM usage_records WHERE timestamp < ?`，SQLite 的 `VACUUM` 在会话空闲时异步执行

### Risk 5: 配置文件缺失或格式错误

**风险**：用户首次安装扩展，`.pi/xpi-kuma/config.yaml` 不存在，或 YAML 语法错误。

**缓解**：
- 首次启动时检测配置文件，不存在则从模板自动创建
- YAML 解析错误时显示友好错误消息，指向具体行号
- 提供 `config.example.yaml` 作为参考

## Migration Plan

**部署步骤**：
1. 用户通过 `pi install git:github.com/<owner>/xpi-kuma@<ref>` 安装
2. 首次 `session_start` 时：
   - 检测 `~/.pi/agent/data/xpi-kuma/` 目录，不存在则创建
   - 初始化 SQLite 数据库和表结构
   - 检测 `.pi/xpi-kuma/config.yaml`，不存在则从内置模板创建
3. 用户编辑配置文件，添加供应商
4. 重启 Pi 会话或执行 `/reload` 使配置生效

**回滚策略**：
- 执行 `pi remove git:github.com/<owner>/xpi-kuma` 卸载扩展
- 数据库文件 `~/.pi/agent/data/xpi-kuma/` 保留，不自动删除（用户可手动删除）
- 配置文件 `.pi/xpi-kuma/` 保留，便于重新安装后恢复

**兼容性**：
- 新增表字段向后兼容：添加字段使用 `ALTER TABLE ... ADD COLUMN ... DEFAULT`
- 配置文件增加字段向后兼容：旧配置缺失字段使用默认值

## Open Questions

无。所有技术决策已明确，可直接进入任务拆分阶段。
