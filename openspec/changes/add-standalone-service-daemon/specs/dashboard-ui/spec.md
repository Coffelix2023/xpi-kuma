## MODIFIED Requirements

### Requirement: 通过命令打开监控面板
系统 SHALL 提供 `/xpi-kuma` 命令，执行后启动或复用仅监听本机回环地址的监控 Web 服务，并使用系统默认浏览器打开监控面板。当独立服务拥有网页时，Pi 内命令 SHALL 复用独立服务的地址与持久访问凭据，不启动第二个网页监听器。独立服务的 CLI 端口冲突行为以 `standalone-service` 为准。

#### Scenario: 成功打开面板
- **WHEN** 用户在已初始化的 Pi 会话中执行 `/xpi-kuma` 命令且没有独立服务
- **THEN** 系统启动或复用本机监控 Web 服务（默认端口 `5180`，被占用时回退到由系统分配的临时端口并提示实际端口），并使用系统默认浏览器打开带有持久访问凭据的本机 URL

#### Scenario: 浏览器无法自动打开
- **WHEN** Web 服务已成功启动，但系统默认浏览器无法自动打开
- **THEN** 系统保持服务运行，并通过 Pi 通知显示可复制的本机访问 URL

#### Scenario: 重复执行命令
- **WHEN** 用户在同一个 Pi 进程中重复执行 `/xpi-kuma` 命令
- **THEN** 系统复用已有 Web 服务和访问凭据，不创建重复监听器，并再次打开或显示同一面板 URL

#### Scenario: 独立服务持有网页
- **WHEN** 独立服务已经启动且用户在 Pi 中执行 `/xpi-kuma`
- **THEN** Pi 打开或提示独立服务的本机 URL，不创建自己的服务或探测器

#### Scenario: 无配置供应商时提示
- **WHEN** 用户执行 `/xpi-kuma` 但配置文件中无任何供应商
- **THEN** 浏览器面板显示提示信息："未配置任何供应商，请编辑 ~/.pi/agent/data/xpi-kuma/config.yaml"

### Requirement: Web 服务生命周期
系统 SHALL 将 Pi 自有的监控 Web 服务绑定到当前 Pi 进程的生命周期并跨会话常驻，SHALL 在 `/xpi-kuma off`（或 Pi 退出）时停止接受新请求、取消后续页面刷新能力并释放其监听端口，且 MUST NOT 在会话关闭时关闭服务。关闭 Pi 自有服务 MUST NOT 停止 Pi 的实时用量采集。独立服务持有所有权时，Pi SHALL 不启动第二个 Web 服务；独立服务的生命周期不受 Pi 退出或 `/xpi-kuma off` 影响。

#### Scenario: 会话切换不释放服务
- **WHEN** Pi 触发 `session_shutdown`，包括退出、reload、新建、恢复或 fork 会话
- **THEN** Pi 自有的监控 Web 服务在 Pi 进程存活时继续监听，原浏览器页面的请求仍然成功

#### Scenario: off 关闭不阻塞 Pi
- **WHEN** 用户执行 `/xpi-kuma off` 且浏览器仍保持页面打开
- **THEN** 系统在有限时间内完成 Pi 自有服务关闭，不等待浏览器主动断开，后续 Pi 调用的 usage 仍持续录入

#### Scenario: off 后 on 重新启动
- **WHEN** 用户执行 `/xpi-kuma off` 之后再次执行 `/xpi-kuma on` 且独立服务未运行
- **THEN** 系统在同一端口以同一持久凭据重新启动服务，旧 URL 继续可用

#### Scenario: 独立服务不跟随 Pi 退出
- **WHEN** Pi 进程退出或用户执行 Pi 内 `/xpi-kuma off`，独立服务持有网页所有权
- **THEN** 独立服务继续监听，其网页仅由终端 `xpi-kuma off` 停止
