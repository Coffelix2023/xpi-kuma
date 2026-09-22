## MODIFIED Requirements

### Requirement: 自动收集真实使用量

系统 SHALL 监听 Pi 的 `message_end` 事件，当事件的 `message.role` 为 `assistant` 且包含 `usage` 字段时，自动提取并记录以下数据到本地数据库：
- 时间戳（毫秒精度）
- 供应商名称（provider）
- 模型 ID（model）
- Token 使用量：输入、输出、缓存读取、缓存写入
- 费用：各类 token 的单项费用和总费用
- 数据来源标记（固定为 `real_usage`）
- 本次调用所属的项目路径与会话标识
- 若 Pi 事件可靠提供：请求开始时间、首个响应 token 时间、完成时间和结果状态

系统 MUST NOT 根据相邻记录、固定延迟、主动 probe 或其他间接数据估算真实调用延迟；若时间点或结果状态不可得，相关字段 SHALL 保持未知而不阻断基础 usage 记录。

#### Scenario: 成功记录一次 LLM 调用
- **WHEN** Pi 完成一次 assistant 消息且 `event.message.usage` 包含 `inputTokens: 100, outputTokens: 50, cost.total: 0.005`
- **THEN** 系统在数据库中创建一条记录，timestamp 为当前时间，tokens_input=100, tokens_output=50, cost_total=0.005

#### Scenario: 记录可用的真实时间点
- **WHEN** Pi 为同一次 assistant 调用提供可靠的请求开始、首个响应 token 和完成时间
- **THEN** 系统保存这些时间点与结果状态，供后续真实延迟统计使用

#### Scenario: 不估算缺失时间点
- **WHEN** Pi 只提供 message_end 和 usage，无法可靠确定请求开始或首个响应 token 时间
- **THEN** 系统照常保存 token 与费用，但相关延迟字段为空，不使用估算值

#### Scenario: 忽略非 assistant 消息
- **WHEN** Pi 发出 `message_end` 事件但 `message.role` 为 `user`
- **THEN** 系统不创建任何数据库记录

#### Scenario: 处理缺失 usage 字段
- **WHEN** `message_end` 事件的 `message.role` 为 `assistant` 但 `usage` 字段为 `undefined`
- **THEN** 系统不创建任何数据库记录

#### Scenario: 同时记录项目与会话
- **WHEN** Pi 在某项目路径下的会话中完成一次 assistant 消息并成功记录使用量
- **THEN** 该条记录同时带上该项目路径与该会话的标识，供后续按项目或会话归因

#### Scenario: 项目路径不可得时仍写入
- **WHEN** 采集时无法确定当前会话的项目路径
- **THEN** 系统仍写入该条使用量记录，项目值留空，不因此丢弃记录

### Requirement: 按时间范围聚合统计

系统 SHALL 支持按时间范围（1小时、24小时、7天、30天）查询聚合统计，返回以下数据：
- 时间范围标识（period）
- 供应商和模型名称
- Token 总量（分类：input/output/cacheRead/cacheWrite）
- 费用总计（分类和总和）
- 请求次数
- 可计算的缓存命中率、费用占比和单请求成本

#### Scenario: 查询最近24小时统计
- **WHEN** 调用 `getStats('24h')` 且数据库中有过去24小时内 OpenAI gpt-4 的3条记录，tokens 分别为 [100,50], [200,100], [150,75]
- **THEN** 返回的聚合结果包含 `totalTokens: 675`, `requestCount: 3`, `period: '24h'`, `provider: 'openai'`, `model: 'gpt-4'`

#### Scenario: 空数据时返回零值
- **WHEN** 查询最近1小时统计但数据库中无该时间范围内的记录
- **THEN** 返回空数组或 `totalTokens: 0`, `requestCount: 0` 的零值对象

#### Scenario: 缓存命中率分母为零
- **WHEN** 某 provider/model 组合的 input tokens 与 cache read tokens 总和为零
- **THEN** 该组合的缓存命中率返回未知而不是0%

### Requirement: 按供应商和模型分组

系统 SHALL 支持同时查询多个供应商和模型的独立统计，每个供应商-模型组合返回独立的聚合结果。

#### Scenario: 多供应商查询
- **WHEN** 数据库中有 OpenAI gpt-4、Anthropic claude-3、9router gpt-4 的记录
- **THEN** `getStats('24h')` 返回3个独立的聚合对象，每个对象的 `provider` 和 `model` 字段唯一标识一个组合

### Requirement: 数据持久化到 SQLite

系统 SHALL 将收集的使用量数据存储到本地 SQLite 数据库文件 `~/.pi/agent/data/xpi-kuma/usage.db`，包含以下表结构：
- `usage_records` 表：id, timestamp, provider, model, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, source, cwd, session_id，以及可选的真实调用时间点和结果状态字段
- 索引：`idx_provider_model` (provider, model), `idx_timestamp` (timestamp)

数据库 SHALL 在打开既有数据库文件时自动补齐新增列，MUST NOT 要求用户手工迁移或删除既有数据。

#### Scenario: 数据库文件自动创建
- **WHEN** 首次启动扩展且 `~/.pi/agent/data/xpi-kuma/` 目录不存在
- **THEN** 系统自动创建目录和 `usage.db` 文件，并初始化表结构

#### Scenario: 并发写入安全
- **WHEN** 两个并发的 `message_end` 事件几乎同时触发记录操作
- **THEN** 系统确保两条记录都成功写入，无数据丢失或损坏

#### Scenario: 既有数据库自动补齐新列
- **WHEN** 系统打开一个由旧版本创建、不含真实延迟字段的 `usage.db`
- **THEN** 系统自动补齐新增字段并保留全部既有记录，旧记录的真实延迟字段为空

#### Scenario: 迁移幂等
- **WHEN** 同一个已迁移过的数据库被再次打开
- **THEN** 系统不重复执行列补齐，也不报错

#### Scenario: 存量记录的新列为空
- **WHEN** 查询迁移前写入且没有真实延迟字段的记录
- **THEN** 这些记录的真实延迟字段为空，且不影响其费用与 token 统计

### Requirement: 数据保留策略

系统 SHALL 支持配置原始记录的保留天数，默认保留7天，定期自动删除超过保留期的原始记录。

#### Scenario: 自动清理过期数据
- **WHEN** 配置 `retention.raw_records: 7` 且数据库中有8天前的记录
- **THEN** 系统在下次清理任务运行时删除所有超过7天的数据

#### Scenario: 可配置保留期
- **WHEN** 用户在配置文件中设置 `retention.raw_records: 30`
- **THEN** 系统保留30天内的原始记录，只删除超过30天的数据
