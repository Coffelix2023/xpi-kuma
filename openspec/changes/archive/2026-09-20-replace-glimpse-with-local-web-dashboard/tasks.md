## 1. 本机 Web 服务

- [x] 1.1 重构 `src/ui/dashboard.ts`，用 `node:http` 在 `127.0.0.1:0` 启动会话级服务，暴露最小 HTML、数据查询和探测路由，并以服务级测试验证随机端口、合法 period、未知路由及有界 JSON 响应。
- [x] 1.2 为所有 API 实现随机 Bearer 凭据、严格 Host 校验、POST Origin 校验、允许列表路由和安全响应头，并以测试验证无凭据、错误 Host/Origin、未知供应商均被拒绝且不会触发探测。
- [x] 1.3 提供幂等的服务句柄与有限等待的 `close()`，以测试验证重复关闭无副作用、端口被释放、关闭后请求失败且不会访问已关闭数据库。

## 2. 浏览器客户端

- [x] 2.1 调整 `src/ui/dashboard-html.ts`，生成不含初始监控数据和访问凭据的 Web UI shell，并以 HTML 测试验证现有面板结构、无供应商提示占位及安全元数据仍存在。
- [x] 2.2 将 `src/ui/dashboard-client.ts` 的 Glimpse 桥替换为 fragment 凭据引导和 `fetch` API 客户端，以脚本测试验证凭据从地址栏清除、Authorization header、时间范围切换、单供应商/全部探测和错误状态恢复。
- [x] 2.3 实现5秒可见页面轮询、隐藏暂停、恢复立即刷新和 in-flight 去重，并以 fake timer/DOM 测试验证新增数据刷新时限及无并发、无界重试。
- [x] 2.4 在窄浏览器视口验证卡片换列、表格横向滚动和图表宽度适配，并更新对应 CSS/HTML 测试覆盖响应式契约。

## 3. Pi 生命周期集成

- [x] 3.1 将 dashboard 服务句柄和启动 Promise 纳入 `src/index.ts` 的 `Runtime`，使 `/xpi-kuma` 启动或复用服务，并以扩展测试验证重复命令不创建重复监听器。
- [x] 3.2 使用无 shell 参数拼接、stderr 不继承终端的平台命令打开默认浏览器，并以测试验证 macOS/Linux/Windows 命令选择及打开失败时通过 Pi 通知返回可复制 URL。
- [x] 3.3 将 `session_start`/`session_shutdown` 清理链路改为可等待且幂等，按“关闭 Web 服务、停止探测、关闭数据库”的顺序执行，并以生命周期测试验证 quit/reload/new/resume/fork 后无遗留端口和旧凭据失效。

## 4. 移除 Glimpse 与更新文档

- [x] 4.1 删除 `glimpseui` 调用、`src/ui/glimpse-host.ts`、`src/ui/glimpse-host.test.ts` 和 `src/glimpseui.d.ts`，移除依赖并更新 `pnpm-lock.yaml`，通过仓库搜索验证无 Glimpse 引用残留。
- [x] 4.2 更新 `README.md` 与 `README.zh-CN.md`，说明 `/xpi-kuma` 的浏览器使用流程、仅本机边界、浏览器打开失败降级、自动刷新及 session 切换后重新执行命令，并人工核对中英文内容一致。
- [ ] 4.3 运行 `pnpm typecheck`、`pnpm -w run lint`、`pnpm test` 和 `pi -e ./src/index.ts` 冒烟，确认全部通过，并手工验证浏览器面板可打开、5秒内反映新 usage、探测按钮可用且 Pi 退出后端口关闭。
