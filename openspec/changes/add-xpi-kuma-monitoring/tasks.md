## 1. 项目基础设施

- [x] 1.1 添加依赖到 package.json：`better-sqlite3`，运行 `pnpm install` 验证安装成功
- [x] 1.2 创建类型定义文件 `src/types.ts`，定义 `UsageRecord`、`ProbeResult`、`VendorConfig`、`AggregatedStats` 接口，运行 `pnpm typecheck` 验证无类型错误
- [x] 1.3 创建配置模板文件 `src/config.example.yaml`，包含供应商配置和保留策略示例，手动检查 YAML 语法正确
- [x] 1.4 创建目录结构：`src/storage/`、`src/collectors/`、`src/monitors/`、`src/ui/`，验证所有目录已创建

## 2. 数据库层 (storage)

- [x] 2.1 实现 `src/storage/database.ts`，导出 `Database` 类，包含初始化、连接管理方法，验证可实例化且无类型错误
- [x] 2.2 实现数据库初始化逻辑，在构造函数中创建 `usage_records` 和 `probe_records` 表及索引，手动运行后检查 `~/.pi/agent/data/xpi-kuma/usage.db` 文件存在且包含两张表
- [x] 2.3 实现 `insertUsageRecord(record: UsageRecord)` 方法，写入 usage_records 表，编写单元测试验证插入后可查询到该记录
- [x] 2.4 实现 `insertProbeRecord(record: ProbeResult)` 方法，写入 probe_records 表，编写单元测试验证插入成功
- [x] 2.5 实现 `getUsageStats(period: '1h' | '24h' | '7d' | '30d')` 方法，返回按供应商和模型分组的聚合统计，编写单元测试验证聚合逻辑正确（插入3条记录，查询返回正确的 totalTokens 和 requestCount）
- [x] 2.6 实现 `getProbeHistory(vendor: string, limit: number)` 方法，查询指定供应商的最近 N 次探测记录，编写单元测试验证按时间倒序返回
- [x] 2.7 实现 `cleanOldRecords(retentionDays: number)` 方法，删除超过保留期的 usage_records，编写单元测试验证插入8天前的记录后调用该方法可删除旧记录


## 3. 使用量收集器 (collectors)

- [x] 3.1 实现 `src/collectors/usage-collector.ts`，导出 `UsageCollector` 类，包含构造函数接受 `Database` 实例，验证可实例化
- [x] 3.2 实现 `record(data: UsageRecord)` 方法，调用 `database.insertUsageRecord()`，编写单元测试验证调用数据库插入方法
- [x] 3.3 实现 `getStats(period: string)` 方法，调用 `database.getUsageStats()`，编写单元测试验证返回聚合统计
- [x] 3.4 实现 `getCurrentSessionStats()` 方法，返回会话内存累加器的当前值，编写单元测试验证初始值为 0


## 4. 供应商监控器 (monitors)

- [x] 4.1 实现 `src/monitors/vendor-monitor.ts`，导出 `VendorMonitor` 类，包含构造函数接受 `Database` 和配置，验证可实例化
- [x] 4.2 实现 `start(ctx: ExtensionContext)` 方法，为每个启用探测的供应商创建 `setInterval` 定时器，手动运行后检查定时器已创建（不实际发送请求）
- [x] 4.3 实现 `stop()` 方法，清除所有定时器，手动运行 start 后调用 stop，验证定时器已清除（使用 `clearInterval` 的返回值或内部状态）
- [x] 4.4 实现 `probeVendor(vendor: VendorConfig)` 方法，发送测试请求到供应商 API，测量 TTFT 和总响应时间，使用 mock API 验证可记录 TTFT 和 totalTime
- [x] 4.5 在 `probeVendor` 中处理超时和错误情况，状态标记为 `down`，TTFT 为 null，编写单元测试验证超时后返回 down 状态
- [x] 4.6 实现 `getVendorStatus()` 方法，查询所有供应商的当前状态（从数据库读取最新探测记录），编写单元测试验证返回包含 status、ttft、totalTime 的对象数组
- [x] 4.7 实现 `triggerProbe(vendorName: string)` 方法，立即对指定供应商执行一次探测，手动测试验证可立即触发探测


## 5. 配置管理

- [x] 5.1 实现 `src/config.ts`，导出 `loadConfig()` 函数，从 `.pi/xpi-kuma/config.yaml` 读取配置，返回解析后的对象，编写单元测试验证可解析示例配置
- [x] 5.2 实现配置文件不存在时的自动创建逻辑，从 `src/config.example.yaml` 复制到 `.pi/xpi-kuma/config.yaml`，手动测试验证首次运行创建配置文件
- [x] 5.3 实现 YAML 解析错误处理，返回友好错误消息，编写单元测试验证解析无效 YAML 时抛出包含行号的错误


## 6. Pi 扩展集成 (src/index.ts)

- [x] 6.1 在 `src/index.ts` 中导入所有依赖（Database、UsageCollector、VendorMonitor、loadConfig），验证无导入错误
- [x] 6.2 注册 `message_end` 事件监听器，在 `message.role === 'assistant'` 且 `usage` 存在时调用 `usageCollector.record()`，使用 `pi -e ./src/index.ts` 运行后发送一条消息，检查数据库中有新记录
- [x] 6.3 注册 `session_start` 事件监听器，初始化数据库、加载配置、启动 VendorMonitor、执行数据清理、初始化会话统计累加器，手动测试验证启动后 VendorMonitor 已运行
- [x] 6.4 注册 `session_shutdown` 事件监听器，停止 VendorMonitor、清除 footer 状态，手动测试验证退出 Pi 后定时器已清除
- [x] 6.5 注册 `turn_end` 事件监听器，累加会话统计并调用 `ctx.ui.setStatus("xpi-kuma", <格式化字符串>)`，手动测试验证 footer 显示 "💰 ¥0.05 | 📊 1.2K"
- [x] 6.6 实现格式化工具函数 `formatTokens(n: number): string` 和 `formatCost(n: number): string`，编写单元测试验证各范围格式化正确（999 → "999", 1234 → "1.2K", 1234567 → "1.2M"）

## 7. Glimpse UI 面板 (ui)

- [x] 7.1 实现 `src/ui/dashboard.ts`，导出 `openDashboard(ctx, usageCollector, vendorMonitor)` 函数，调用 `glimpseui.open()`，手动测试验证可打开空白 Glimpse 窗口
- [x] 7.2 实现 `generateDashboardHTML(stats, vendors)` 函数，生成包含供应商卡片网格的 HTML，手动测试验证 HTML 包含卡片结构
- [x] 7.3 在 HTML 中嵌入内联 CSS，使用 DESIGN.md 的 oklch token，包含暗色主题变量，手动测试验证页面使用暗色背景
- [x] 7.4 实现供应商卡片 HTML 结构，包含状态图标、名称、价格、TTFT、响应时间、刷新按钮，手动测试验证卡片显示正确数据
- [x] 7.5 实现使用量统计表格 HTML 结构，包含时间范围选择器和统计表格，手动测试验证表格显示聚合数据
- [x] 7.6 通过 CDN 引入 Chart.js，实现趋势图表的 `<canvas>` 元素和初始化脚本，手动测试验证图表渲染费用曲线
- [x] 7.7 实现刷新按钮的 `onclick` 事件，调用页面到宿主的消息通道，在宿主回调中处理刷新逻辑，手动测试验证点击刷新按钮触发探测
- [x] 7.8 实现时间范围切换逻辑，点击不同时间范围按钮时重新查询数据并更新表格和图表，手动测试验证切换时间范围更新显示
- [x] 7.9 实现主题切换按钮，点击时切换 CSS 变量从暗色到亮色（或反之），手动测试验证主题切换生效

> 备注：7.1–7.9 在浏览器与真实 Glimpse 窗口两条路径上都做过渲染验证；
> 7.7 的实现改用 Glimpse 官方桥接 `window.glimpse.send()`，详见下方说明。

## 8. 命令注册

- [x] 8.1 修改 `src/index.ts` 中的 `/xpi-kuma` 命令 handler，调用 `openDashboard(ctx, usageCollector, vendorMonitor)`，手动测试验证执行 `/xpi-kuma` 打开监控面板
- [x] 8.2 处理配置文件不存在或无供应商配置的情况，显示友好提示消息，手动测试验证无配置时面板显示 "未配置任何供应商"

## 9. 测试与验证

- [x] 9.1 运行 `pnpm typecheck` 验证所有文件无类型错误
- [x] 9.2 运行 `pnpm -w run lint` 验证代码符合 Biome 规范
- [x] 9.3 运行 `pnpm test` 验证所有单元测试通过（覆盖 Database、UsageCollector、VendorMonitor 的核心方法）
- [x] 9.4 手动集成测试：启动 Pi，执行几条 LLM 调用，打开 `/xpi-kuma` 面板，验证统计数据正确显示
- [x] 9.5 手动测试 footer 状态：发送消息后验证 footer 显示更新的费用和 token 数量
- [x] 9.6 手动测试探测功能：配置一个真实供应商，等待探测间隔后检查数据库中有探测记录，面板显示 TTFT 和状态


> 9.5 证据：真实交互式 TUI（Python pty 驱动）实测 —— session_start 后 footer 为 `💰 ¥0.00 | 📊 0`，
> 一次真实 LLM 调用后变为 `💰 ¥0.00 | 📊 12.8K`，同时数据库落入该次调用的记录。
> 常规版 `README.md` / `README.zh-CN.md` 由 task 10.1 同步更新。

## 10. 文档与清理

- [x] 10.1 更新 README.md，将 `/xpi-kuma` 命令的描述从 "Show extension status" 改为 "打开监控面板"，添加配置文件说明
- [x] 10.2 创建 `.pi/xpi-kuma/config.example.yaml` 示例配置文件（如果不存在），包含 OpenAI、Anthropic、9router 的示例配置
- [x] 10.3 验证 `pnpm typecheck && pnpm -w run lint && pnpm test` 全部通过

> 10.1 同时更新了 `README.zh-CN.md`（两份 README 由仓库约定成对维护）。
> 10.2 额外把运行时会生成、可能含明文密钥的 `.pi/xpi-kuma/config.yaml` 加入 `.gitignore`，
> 并加测试锁住两份示例配置的一致性与占位符格式。
