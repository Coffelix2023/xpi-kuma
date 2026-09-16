## Purpose

定期主动探测配置的 AI 模型供应商的性能指标（TTFT、响应时间）和可用性状态，为供应商选择提供数据支撑。

## ADDED Requirements

### Requirement: 定期探测供应商性能

系统 SHALL 根据配置文件中每个供应商的 `probe.interval` 设置，定期向供应商 API 发送测试请求，测量以下指标：
- TTFT（Time To First Token，首字延迟）：从请求发送到接收到第一个流式响应块的时间（毫秒）
- 总响应时间：从请求发送到响应完成的总时间（毫秒）
- 可用性状态：`up`（正常）、`down`（失败）、`degraded`（部分可用）

#### Scenario: 成功探测供应商

- **WHEN** 配置了 OpenAI 供应商，`probe.interval: "5m"`，当前时间距离上次探测已超过5分钟
- **THEN** 系统向 OpenAI API 发送测试请求（prompt: "hi", max_tokens: 1），记录 TTFT 和总响应时间到数据库，状态标记为 `up`

#### Scenario: 探测超时

- **WHEN** 向供应商发送测试请求，配置的 `probe.timeout: 30000`（30秒），但30秒内未收到响应
- **THEN** 系统取消请求，状态标记为 `down`，TTFT 和总响应时间记录为 `null`

#### Scenario: 探测失败

- **WHEN** 向供应商发送测试请求，收到 HTTP 500 错误或网络错误
- **THEN** 系统状态标记为 `down`，TTFT 和总响应时间记录为 `null`，并记录错误消息

### Requirement: 最小化探测成本

系统 SHALL 使用最小化的测试 prompt（固定为 "hi"）和 `max_tokens: 1` 来减少每次探测的 token 消耗，确保每次探测不超过 5 个 token。

#### Scenario: 限制探测 token 用量

- **WHEN** 执行一次探测请求
- **THEN** 请求体包含 `messages: [{ role: 'user', content: 'hi' }]` 和 `max_tokens: 1`

#### Scenario: 记录探测消耗

- **WHEN** 探测完成且供应商返回 usage 信息
- **THEN** 系统记录探测消耗的 tokens（input 和 output）到 `probe_records` 表的 `tokens_input` 和 `tokens_output` 字段

### Requirement: 可配置探测间隔

系统 SHALL 支持为每个供应商独立配置探测间隔，支持以下格式：
- 分钟：`"5m"`, `"10m"`
- 小时：`"1h"`, `"5h"`
- 禁用：`enabled: false`

#### Scenario: 不同供应商不同间隔

- **WHEN** 配置 OpenAI `probe.interval: "5m"`，Anthropic `probe.interval: "1h"`
- **THEN** 系统每5分钟探测 OpenAI，每1小时探测 Anthropic

#### Scenario: 禁用探测

- **WHEN** 供应商配置 `probe.enabled: false`
- **THEN** 系统不对该供应商执行任何探测请求

### Requirement: 探测结果持久化

系统 SHALL 将探测结果存储到 SQLite 数据库的 `probe_records` 表，包含以下字段：
- id, timestamp, vendor, model, status, ttft, total_time, tokens_input, tokens_output
- 索引：`idx_vendor` (vendor), `idx_timestamp` (timestamp)

#### Scenario: 记录成功探测

- **WHEN** 对 OpenAI gpt-4 的探测成功，TTFT 为 230ms，总响应时间 450ms，消耗 input=1, output=1 tokens
- **THEN** 数据库中创建一条记录，status='up', ttft=230, total_time=450, tokens_input=1, tokens_output=1

#### Scenario: 记录失败探测

- **WHEN** 对供应商的探测超时
- **THEN** 数据库中创建一条记录，status='down', ttft=null, total_time=null

### Requirement: 后台任务生命周期管理

系统 SHALL 在 `session_start` 事件时启动探测后台任务，在 `session_shutdown` 事件时停止所有探测任务，确保不泄漏资源。

#### Scenario: 启动时启动探测

- **WHEN** Pi 会话启动，触发 `session_start` 事件
- **THEN** 系统为所有 `probe.enabled: true` 的供应商启动定时探测任务

#### Scenario: 关闭时停止探测

- **WHEN** Pi 会话关闭，触发 `session_shutdown` 事件
- **THEN** 系统取消所有正在进行的探测请求，清除所有定时器

#### Scenario: 探测不阻塞会话关闭

- **WHEN** `session_shutdown` 事件触发时，有一个正在进行的探测请求
- **THEN** 系统在最多 5 秒内取消该请求，不阻塞 Pi 退出

### Requirement: 获取供应商当前状态

系统 SHALL 提供接口查询所有配置供应商的当前状态，包括：
- 供应商名称、模型
- 最新探测时间
- 当前状态（up/down/degraded）
- 最近一次成功探测的 TTFT 和总响应时间
- 配置的价格（从配置文件读取）

#### Scenario: 查询所有供应商状态

- **WHEN** 调用 `getVendorStatus()` 且数据库中有 OpenAI、Anthropic、9router 的探测记录
- **THEN** 返回3个状态对象，每个包含 name, model, status, ttft, totalTime, price, lastProbeTime

#### Scenario: 无探测记录时状态

- **WHEN** 供应商配置了但从未探测过（probe.enabled: false 或首次启动）
- **THEN** 状态对象的 status 为 'unknown'，ttft 和 totalTime 为 null
