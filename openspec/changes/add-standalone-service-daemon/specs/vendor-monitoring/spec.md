## MODIFIED Requirements

### Requirement: 后台任务生命周期管理
系统 SHALL 在同一 xpi-kuma 数据目录下只允许一个服务所有者执行周期性供应商探测。独立服务持有所有权时，Pi 的 `session_start` MUST NOT 启动重复探测；没有独立服务时，Pi 可在运行时启动探测。服务所有者关闭时 SHALL 取消在途探测并清除所属定时器，且不得停止 Pi 的实时用量记录。

#### Scenario: 启动时启动探测
- **WHEN** Pi 会话启动，触发 `session_start` 且独立服务未持有所有权
- **THEN** Pi 运行时为所有 `probe.enabled: true` 的供应商启动定时探测任务

#### Scenario: 独立服务先运行
- **WHEN** Pi 会话启动时独立服务已经持有有效所有权
- **THEN** 仅独立服务维持探测定时任务，Pi 不产生重复探测请求

#### Scenario: 关闭时停止探测
- **WHEN** 当前服务所有者执行其 `off` 命令或其进程退出
- **THEN** 系统取消该所有者的在途探测并清除所有定时器；关闭 Pi 自有探测不影响独立服务探测

#### Scenario: 探测不阻塞会话关闭
- **WHEN** Pi 关闭其自有服务时有一个正在进行的探测请求
- **THEN** 系统在最多 5 秒内取消该请求，不阻塞 Pi 退出，且 Pi 的实时用量采集在会话存活时继续运行
