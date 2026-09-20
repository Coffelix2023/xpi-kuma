## Context

见 `proposal.md` 的动机。本扩展当前在 `message_end` 中采集使用量、通过同一 SQLite 连接查询聚合数据，并由 `VendorMonitor` 管理定时和手动探测。展示层已经由自包含 HTML、CSS 和浏览器脚本组成，但 `dashboard.ts` 依赖 Glimpse 的进程桥接；`session_shutdown` 当前同步关闭探测器和数据库。

此次改动跨越扩展生命周期、HTTP 边界、浏览器交互与依赖清理，并新增本机接口的访问控制，因此需要在实现前固定安全和资源所有权。

## Goals / Non-Goals

**Goals:**

- 保持 Pi Hook 采集、SQLite 数据模型和供应商探测语义不变，只替换展示传输层。
- 使用现有 Node.js 运行时能力提供零新增框架的本机 Web 服务。
- 让一个 Pi 扩展会话只拥有一个可复用、可关闭的面板服务实例。
- 让所有数据和探测接口具备可测试的本机访问控制。
- 保持现有面板内容、主题和响应式能力，并在5秒内自动反映新增使用量。

**Non-Goals:**

- 不把 Pi 聊天、工具调用或 session 管理迁移到浏览器。
- 不提供局域网或公网监听、用户账号、TLS 或反向代理配置。
- 不创建独立 daemon，也不保证 Pi 退出后仍可查看历史数据。
- 不改变 usage 统计口径、SQLite schema、保留策略或供应商探测协议。
- 不引入 Web 框架、WebSocket 或前端构建步骤。

## Decisions

### 1. Web 服务仍运行在 Pi 扩展进程内

`/xpi-kuma` 首次执行时创建会话级服务；后续执行复用服务。服务持有现有 `UsageCollector` 和 `VendorMonitor` 引用，避免新增数据库连接、进程间协议或重复探测任务。`session_shutdown` 先关闭 HTTP 服务，再停止探测器并关闭数据库。

替代方案：独立 sidecar 读取 SQLite。该方案可在 Pi 退出后继续提供历史数据，但无法直接复用手动探测运行时，并增加进程管理与配置归属，不符合本轮仅监控、本机、最小改造的范围。

### 2. 使用 Node.js 标准库 HTTP 服务和短轮询

服务使用 `node:http`，绑定 `127.0.0.1` 和端口 `0`，由操作系统分配随机端口。接口保持最小：

- `GET /`：只返回不含监控数据和密钥的 Web UI shell。
- `GET /api/dashboard?period=<1h|24h|7d|30d>`：返回有界的 `DashboardData` JSON。
- `POST /api/probes`：立即探测全部供应商。
- `POST /api/probes/<encoded-vendor>`：立即探测单个供应商。

浏览器在可见时每5秒执行一次数据请求。每轮使用单个 in-flight 标记；页面隐藏时停止定时器，恢复可见时立即刷新。手动探测完成后复用同一数据刷新路径。

替代方案：Server-Sent Events 或 WebSocket。当前数据变化低频，轮询代码更少、资源清理更简单；实时推送不提供足够收益。

### 3. 访问凭据放在 URL fragment，并由 API 使用 Authorization header

服务启动时用 `crypto.randomBytes(32)` 生成一次性凭据。打开地址采用 `http://127.0.0.1:<port>/#<token>`；fragment 不会进入 HTTP 请求、服务器访问路径或 Referer。页面脚本读取后立即通过 `history.replaceState` 清除地址栏 fragment，并在 API 请求中发送 `Authorization: Bearer <token>`。

根页面只包含静态 shell，不嵌入初始监控数据。所有 `/api/` 请求需要：

- Host 精确匹配 `127.0.0.1:<port>`；
- Bearer 凭据按固定长度、常量时间比较；
- 修改状态的 POST 请求还要求 Origin 精确匹配本服务 origin；
- 仅接受已知 method/path/period，单供应商名称必须匹配现有配置；
- 响应包含 `Cache-Control: no-store`、`Referrer-Policy: no-referrer` 和限制资源来源的 CSP（内容安全策略）。

页面可继续加载当前固定版本的 Chart.js CDN，但 `Referrer-Policy` 保证地址信息不外发；凭据本身在首个页面脚本执行后从地址栏清除。

替代方案：query 参数。它会进入请求目标、历史记录和常见访问日志，风险更高。Cookie 需要额外 bootstrap 与 CSRF（跨站请求伪造）设计，超出本机只读面板的最小需求。

### 4. 平台命令只负责打开浏览器，失败时降级为通知 URL

扩展通过参数数组调用平台原生命令（macOS `open`、Linux `xdg-open`、Windows `cmd /c start`），不得经 shell 拼接 URL，也不得让子进程 stderr 继承 Pi 终端。打开失败不关闭已经启动的服务；命令处理器通过 `ctx.ui.notify` 提供带 fragment 的可复制本机 URL。

不新增 `open` 类 npm 依赖，因为平台命令足以覆盖项目支持环境，并能消除 Glimpse 的原生宿主和 stderr shim。

### 5. 服务句柄进入 Runtime，关闭流程改为可等待且幂等

`Runtime` 增加可空的 dashboard server 句柄。启动函数处理并发命令：同一时刻只有一个启动 Promise，成功后缓存句柄，失败后清空以允许重试。关闭函数可重复调用，并为 `server.close()` 设置有限等待；不追踪或等待浏览器标签页。

Pi 的 `session_start` 和 `session_shutdown` handler 改为等待清理完成，确保 reload/new/resume/fork 不遗留端口。关闭完成后才关闭共享数据库，防止在途 API 读到已关闭连接。

### 6. 保留展示生成器，移除 Glimpse 特有协议与文件

`dashboard-html.ts` 继续负责页面结构，改为生成无敏感初始数据的 shell。`dashboard-client.ts` 用 `fetch`、可见性监听和定时器替换 `window.glimpse.send()` / `win.send()`。`dashboard.ts` 负责数据聚合、路由和服务句柄，不承担前端状态渲染。

删除 `glimpseui`、`glimpseui.d.ts`、`glimpse-host.ts` 及专用测试。锁文件通过 pnpm 正常更新，不保留兼容层。

## Risks / Trade-offs

- [Pi 会话切换会使旧页面失效] → 页面显示连接已关闭；README 明确要求在新会话中重新执行 `/xpi-kuma`。
- [本机其他进程可尝试访问回环端口] → 随机端口之外再使用256位随机凭据，并保护所有数据与动作接口。
- [恶意网页向 localhost 发请求] → Bearer 凭据、严格 Host/Origin 校验和非简单 POST 共同阻断跨站触发。
- [浏览器自动打开命令在精简环境缺失] → 服务保持运行并通过 Pi 通知提供 URL，不把打开失败视为服务失败。
- [5秒轮询产生持续查询] → 仅可见页面轮询、禁止请求重叠，现有查询结果与趋势点均有界。
- [Chart.js CDN 不可用] → 保持现有无图表降级；统计表与供应商卡片仍可用，不新增本地打包流程。
- [异步 shutdown 与数据库关闭竞态] → 停止接收请求并等待 HTTP 服务关闭后，再停止探测并关闭数据库。

## Migration Plan

1. 新增本机 Web 服务和接口测试，先复用现有数据聚合与 HTML 生成器。
2. 将浏览器客户端切换到带凭据的 fetch 和可见性轮询，并更新 HTML shell。
3. 将服务句柄接入扩展 Runtime、命令与异步 shutdown；补充重复打开和 reload 生命周期测试。
4. 移除 Glimpse 代码、声明、依赖和专用测试，更新 pnpm 锁文件。
5. 更新中英文 README，运行类型检查、Biome、Vitest 和 `pi -e ./src/index.ts` 冒烟。

回滚时恢复上一版本的 Glimpse `dashboard.ts`、宿主防护文件和依赖即可；SQLite schema 与配置格式未变化，无数据迁移或回滚步骤。
