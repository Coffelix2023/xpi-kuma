## Purpose

在 Pi 的 footer 状态栏实时显示当前会话的累计费用和 token 使用量统计，提供快速可见的成本监控。

## ADDED Requirements

### Requirement: 在 Footer 显示会话统计

系统 SHALL 在每个 turn 结束时（`turn_end` 事件），通过 `ctx.ui.setStatus()` 在 Pi 的 footer 状态栏显示当前会话的累计统计，格式为：`💰 ¥{费用} | 📊 {tokens}`

#### Scenario: 成功显示统计

- **WHEN** Pi 完成一个 turn，当前会话累计费用为 ¥0.15，累计 tokens 为 12,345
- **THEN** footer 状态栏显示 "💰 ¥0.15 | 📊 12.3K"

#### Scenario: 大数值格式化

- **WHEN** 当前会话累计 tokens 超过 1,000,000
- **THEN** footer 显示为 "📊 1.2M"（保留一位小数）

#### Scenario: 会话开始时初始化

- **WHEN** Pi 启动新会话，尚无任何 LLM 调用
- **THEN** footer 显示 "💰 ¥0.00 | 📊 0"

### Requirement: 仅统计当前会话

系统 SHALL 仅统计当前 Pi 会话（从 `session_start` 到 `session_shutdown`）内的使用量，不包含历史会话数据。

#### Scenario: 新会话重置统计

- **WHEN** 用户执行 `/new` 命令创建新会话
- **THEN** footer 统计重置为 ¥0.00 和 0 tokens，不包含上一个会话的数据

#### Scenario: 会话恢复不累加

- **WHEN** 用户执行 `/resume` 切换到另一个已存在的会话
- **THEN** footer 统计仅显示该会话从加载后的新增使用量，不包含该会话之前保存时的历史数据

### Requirement: 状态栏 ID 唯一性

系统 SHALL 使用唯一的状态栏 ID `"xpi-kuma"` 注册 footer 状态，避免与其他扩展冲突。

#### Scenario: 与其他扩展共存

- **WHEN** 同时安装了其他使用 `ctx.ui.setStatus()` 的扩展
- **THEN** xpi-kuma 的状态显示在 footer 的 `xpi-kuma` 区域，不覆盖其他扩展的状态

### Requirement: 实时更新

系统 SHALL 在每次 `turn_end` 事件后立即更新 footer 统计，确保用户看到的是最新数据。

#### Scenario: Turn 结束后更新

- **WHEN** Pi 完成一次 turn，产生新的 assistant 消息和 usage 数据
- **THEN** footer 统计在 1 秒内更新为包含该 turn 的新累计值

### Requirement: 格式化显示规则

系统 SHALL 使用以下格式化规则：
- 费用：保留两位小数，前缀货币符号（¥）
- Tokens：
  - 小于 1000：显示原始数字
  - 1000-999999：显示为 K（千），保留一位小数（如 12.3K）
  - 100万及以上：显示为 M（百万），保留一位小数（如 1.2M）

#### Scenario: 各范围格式化

- **WHEN** tokens 为 999
- **THEN** 显示 "📊 999"

- **WHEN** tokens 为 1,234
- **THEN** 显示 "📊 1.2K"

- **WHEN** tokens 为 1,234,567
- **THEN** 显示 "📊 1.2M"

### Requirement: 清除状态

系统 SHALL 在 `session_shutdown` 事件时清除 footer 状态，避免遗留陈旧数据。

#### Scenario: 会话关闭清除

- **WHEN** Pi 会话关闭（用户退出或切换会话）
- **THEN** 系统调用 `ctx.ui.setStatus("xpi-kuma", undefined)` 清除 footer 中的 xpi-kuma 状态

### Requirement: 容错处理

系统 SHALL 在无法获取统计数据时显示降级信息，不阻塞 Pi 正常运行。

#### Scenario: 数据库访问失败

- **WHEN** 查询当前会话统计时数据库连接失败
- **THEN** footer 显示 "💰 -" 或保持上次成功的显示值，不抛出错误

#### Scenario: 计算异常

- **WHEN** 统计计算过程中出现数值异常（如 NaN）
- **THEN** footer 显示 "💰 ¥0.00 | 📊 -"，记录错误日志但不中断 Pi
