## Context

参见 `proposal.md` 与对应 specs。当前 `startSession()` 会初始化数据库和探测器；`stopRuntime()` 同时关闭网页、探测器和数据库，因此现有 `off` 会停掉 Pi 会话内的 `message_end` 采集。会话日志 JSONL 中 assistant 条目保存 `usage`、稳定条目 `id`、timestamp、provider/model 和 session header 的 cwd/session id；扩展收到的 `message_end` 类型没有日志条目 id。现有 `usage_records` 没有源条目身份字段。数据库路径由 `getAgentDir()` 决定并支持 `PI_CODING_AGENT_DIR`，使用 WAL。

## Goals / Non-Goals

**Goals:**
- 明确区分永远随 Pi 会话工作的 usage recorder 与可由独立守护进程拥有的 dashboard/probe service。
- 提供终端可控且退出终端后存活的服务，并安全协调 Pi 与 daemon 的端口和探测所有权。
- 让会话日志 reconciliation（对账补录）可重复执行且不重复计数。

**Non-Goals:**
- Pi 本身关闭时实时获得尚未由 Pi 产生的调用；只能在 Pi 日志中已有记录后补录。
- 从补录数据估算 token 延迟；系统服务管理器、开机自启、远程监听。

## Decisions

### 将服务生命周期拆为 recorder 与 web/probe owner
Pi 的 `message_end` 采集器和数据库连接在 Pi 会话期间保持工作，独立于 `/xpi-kuma on/off`。独立进程负责网页服务及探测；Pi 检测到有效 daemon 所有权时仍写实时 usage，但跳过网页监听与探测。Pi 服务已先启动时，daemon 启动采用失败并说明所有者，而非悄悄接管，避免中断已有页面和 OAuth 流程。

替代方案：让 Pi 退出后即停止所有记录与服务，无法满足连续服务；让 Pi 与 daemon 各跑一套服务会造成端口冲突和重复供应商请求。

### 终端 CLI 作为薄入口，复用现有 TypeScript 模块
新增全局可安装命令入口只解析 `on/off/status` 与端口参数，服务端直接复用既有配置、数据库、账户、探测和 HTTP dashboard 实现。当前 Node 24 能运行可擦除类型的 TypeScript，沿用无构建原则，不另建 HTTP 实现或引入进程管理依赖。

替代方案：复制或重写 server 会造成 API 与安全策略漂移；新增打包器与本仓库约束冲突。CLI 的 Node 运行时最低版本须在实现阶段与仓库 mise 支持策略一致。

### 用原子服务状态文件协调所有权
状态文件位于 `getAgentDir()/data/xpi-kuma/`，记录 PID、实际端口、进程启动标识/命令身份及状态版本。通过排他创建和原子替换避免并发 `on`；Pi 侧检查状态并验证进程存活，不能只信 PID。`off` 先验证目标身份，再发送正常退出信号并有限等待；清理状态前再次核对归属。端口绑定失败时启动失败，不采用现有 Pi 命令的随机端口回退，以保证 CLI 状态与实际监听一致。

### 后台启动隔离宿主终端
父 CLI 使用 Node `spawn` 的 detached 子进程模式，stdin 忽略，stdout/stderr 重定向至 xpi-kuma 日志文件并调用 `unref()`；daemon 自身不得向 stdout/stderr 直接输出。CLI 等待子进程写出就绪状态后再报告成功，启动错误写入日志并通过退出状态/状态查询反馈。

### 会话日志补录使用两类身份
补录是 Pi 扩展与独立服务共用的逻辑，分别在 `session_start` 和 daemon `on` 调用；启动时已有的可识别记录在网页首次查询前落库，并发触发靠数据库唯一约束避免双计。日志条目的 `(session_id, entry.id)` 是补录幂等键，新增可空来源列和唯一索引，重复扫描用事务内冲突忽略。实时事件在持久化前触发，没有 entry.id；新写入的 usage 行须另存 `message.timestamp`，因为现有 `usage_records.timestamp` 是 `message_end` 时的完成时间，不能拿它与消息时间做精确相等判断。新行与日志用会话 ID、消息时间、provider/model、token 计数和费用字段对账；内容摘要仅在两端都有且候选相同的情况下辅助消歧，不作为必须相等的基础键。
旧行没有消息时间及内容摘要：仅在同会话、既有完成时间与日志完成时间处于有界窗口、其余现有字段一致且候选一一对应时，才保守认领；否则计入未核实并写诊断，不能直接当新调用插入。日志中相同指纹出现多条、实时行中指纹冲突、缺少必要字段或格式不合法时同样不自动判定匹配或插入。这是用户接受的显式准确性边界：不能承诺冲突场景自动零断档。补录的 cwd/session id 来自 session header，延迟字段不推断。
替代方案：仅保存日志 id 无法去重旧实时行；内容相似性猜测会双计；单纯高水位可能漏掉更早更新的日志。
### 日志补录与留存策略一致
扫描范围不早于当前时间减 `retention.raw_records`；保留清理后旧会话条目不重新插回数据库。每个文件/条目错误隔离记录，单个损坏文件不阻断 Pi 会话启动和正常实时采集。

## Risks / Trade-offs

- [Pi JSONL 格式或会话分支行为变化] → 隔离解析器，校验版本/字段，失败时不补录并记录诊断；使用样例日志测试。
- [message_end 与持久 session entry 无精确关联] → 采用双键对账，冲突不自动补录，并将未核实项显式报告。
- [指纹碰撞或旧行缺少指纹] → 不自动插入或删除冲突记录，单列未核实数量和日志位置，要求人工核对。
- [陈旧状态或 PID 复用导致误停进程] → 校验进程启动身份与命令行标记，信号发送前后复核；无法确认则停止操作并报告。
- [扫描大量旧会话拖慢启动] → 仅扫描保留窗口，逐文件流式解析并隔离错误；若仍过慢再设计索引/高水位。
- [凭据与 OAuth 回调在 daemon 生命周期变化] → 复用现有持久 dashboard token 与 callback 端口语义，daemon 退出时有界关闭服务。

## Migration Plan

1. 新 schema 以可空来源身份列和唯一索引向前迁移，不删除或重写既有 usage 数据。
2. 先发布 recorder/service 生命周期解耦和可幂等补录，再提供全局命令；既有 `/xpi-kuma` 命令继续可用。
3. 既有 Pi 服务运行时启动 daemon 返回所有权冲突；用户先 `/xpi-kuma off`（仅关闭旧服务，不停止 usage recorder）再执行 CLI `on`。
4. 回滚时停止 daemon，移除其命令入口；保留新增列与历史数据，恢复 Pi 侧网页/探测所有权，不逆向删除数据。
