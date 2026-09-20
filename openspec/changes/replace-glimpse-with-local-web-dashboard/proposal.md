## Why

当前监控面板依赖 Glimpse 原生宿主，带来平台二进制、子进程 stderr 隔离和窗口生命周期维护成本，也无法使用普通浏览器查看。将展示层改为仅监听本机的 Web 服务与 Web UI，可复用现有 HTML、统计查询和 Pi Hook 采集链路，同时降低运行依赖与故障面。

## What Changes

- 将 `/xpi-kuma` 的展示目标从 Glimpse 原生窗口改为系统默认浏览器中的本机 Web UI。
- 在 Pi 扩展内按需启动仅绑定 `127.0.0.1` 的 HTTP 服务，并在当前扩展会话关闭时释放监听资源。
- 提供受随机访问令牌保护的面板数据查询、单供应商探测和全部供应商探测接口。
- 将现有 `window.glimpse` 双向桥接改为浏览器 `fetch` 请求，并通过有界轮询自动更新展示数据。
- 保留 `message_end` Hook、SQLite 数据结构、供应商后台探测、footer 状态和现有统计口径。
- 移除 `glimpseui` 运行时依赖、类型补丁、原生宿主 stderr 转发层及其专用测试。
- 更新 README 和面板相关测试，说明浏览器打开方式、本机访问边界及 session/reload 后的服务生命周期。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dashboard-ui`: 将监控面板的载体、交互协议、自动刷新、安全边界和生命周期从 Glimpse 原生窗口改为扩展内嵌的本机 Web 服务与浏览器 UI。

## Impact

- 主要影响 `src/ui/dashboard.ts`、`src/ui/dashboard-client.ts`、`src/index.ts` 及其测试。
- 删除 `src/ui/glimpse-host.ts`、`src/ui/glimpse-host.test.ts`、`src/glimpseui.d.ts` 和 `glimpseui` 依赖。
- 继续使用 Node.js 标准库、现有 `UsageCollector`、`VendorMonitor`、HTML/CSS 生成器和 SQLite 数据库，不新增 Web 框架。
- `/xpi-kuma` 的可观察行为发生变化：由打开固定尺寸原生窗口改为启动或复用本机服务并打开浏览器；Pi session shutdown、reload 或切换 session 后原页面不再可用，需要重新执行命令。
- 服务默认不提供局域网或公网访问，不向浏览器暴露供应商 API Key。
