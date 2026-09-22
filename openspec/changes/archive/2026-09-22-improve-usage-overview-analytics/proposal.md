## Why

当前使用量总览已经能展示费用、tokens、请求数、项目归因和趋势，但用户仍需要自行拼接多个区域，才能回答“钱花在哪里”“哪个项目消耗最多”“哪个模型更省钱或更快”。同时，现有供应商 probe 延迟不能代表真实会话体验，面板缺少基于真实调用数据的效率比较。现在补齐受约束的统计与解释型建议，可以在不引入外部观测平台、不自动改变用户配置的前提下提升总览的决策价值。

## What Changes

- 在总览中增加缓存命中率、费用占比和单请求成本等消费结构指标。
- 增强 provider/model 与项目排行，突出费用、tokens、请求数和缓存收益最高的对象。
- 增加真实调用的延迟与结果状态采集，在有可靠时间点时计算 p50/p95 首字延迟、总响应时间和成功率。
- 增加带样本量、时间范围、依据和置信度的成本、效率、缓存解释型建议。
- 保持建议只读，不自动切换模型、不自动修改供应商配置。
- 优先创建独立原型验证总览页面布局、信息层级和空数据状态，再实现生产面板。
- 保持本地 SQLite、回环 Web 服务、无外部页面资源和现有中英文/主题偏好约束。

## Capabilities

### New Capabilities

- `usage-overview-insights`: 提供消费结构、效率排行、缓存分析和带证据的解释型建议。
- `usage-overview-prototype`: 在生产实现前提供可评审的总览页面原型，覆盖主要数据态和响应式布局。

### Modified Capabilities

- `dashboard-ui`: 扩展使用量总览的模块、排行、效率展示、建议展示和响应式信息层级。
- `usage-collection`: 在 Pi 事件能可靠提供时间点时记录真实调用延迟与结果状态；缺失时不得使用估算值。
- `usage-attribution`: 扩展项目消费结果，支持费用占比及总览一致性校验。

## Impact

- 领域类型：`src/types.ts`。
- 数据库和迁移：`src/storage/database.ts`，可能涉及 `usage_records` schema 和聚合查询。
- 采集：`src/collectors/usage-collector.ts` 及 Pi 事件类型适配。
- API：`src/ui/routes/api.ts`，扩展 dashboard 响应，避免前端重复计算统计口径。
- 页面：`src/ui/client/overview.ts`、`src/ui/client/pages/dashboard.ts`、相关渲染、文案和 CSS 模块。
- 测试：usage collector、database、dashboard API/UI 测试。
- 原型：优先写入 `.pi/prototype-design/` 版本化产物；本变更阶段不修改生产代码。
- 不新增外部数据库、遥测服务、图表依赖或自动路由系统。
