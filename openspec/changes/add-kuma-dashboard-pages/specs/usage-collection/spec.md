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

#### Scenario: 成功记录一次 LLM 调用

- **WHEN** Pi 完成一次 assistant 消息且 `event.message.usage` 包含 `inputTokens: 100, outputTokens: 50, cost.total: 0.005`
- **THEN** 系统在数据库中创建一条记录，timestamp 为当前时间，tokens_input=100, tokens_output=50, cost_total=0.005

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

### Requirement: 数据持久化到 SQLite

系统 SHALL 将收集的使用量数据存储到本地 SQLite 数据库文件 `~/.pi/agent/data/xpi-kuma/usage.db`，包含以下表结构：
- `usage_records` 表：id, timestamp, provider, model, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, source, cwd, session_id
- 索引：`idx_provider_model` (provider, model), `idx_timestamp` (timestamp)

数据库 SHALL 在打开既有数据库文件时自动补齐新增列，MUST NOT 要求用户手工迁移或删除既有数据。

#### Scenario: 数据库文件自动创建

- **WHEN** 首次启动扩展且 `~/.pi/agent/data/xpi-kuma/` 目录不存在
- **THEN** 系统自动创建目录和 `usage.db` 文件，并初始化表结构

#### Scenario: 并发写入安全

- **WHEN** 两个并发的 `message_end` 事件几乎同时触发记录操作
- **THEN** 系统确保两条记录都成功写入，无数据丢失或损坏

#### Scenario: 既有数据库自动补齐新列

- **WHEN** 扩展打开一个由旧版本创建、不含项目与会话列的 `usage.db`
- **THEN** 系统自动补齐这些列并保留全部既有记录，后续写入的记录带上新列

#### Scenario: 迁移幂等

- **WHEN** 同一个已迁移过的数据库被再次打开
- **THEN** 系统不重复执行列补齐，也不报错

#### Scenario: 存量记录的新列为空

- **WHEN** 查询迁移前写入的记录
- **THEN** 这些记录的项目与会话值为空，且不影响其费用与 token 统计
