# xpi-kuma

[English](./README.md) · **简体中文**

**一个记录真实 LLM 用量与供应商可用性,并以仅本机可访问的浏览器面板展示的 Pi Coding Agent 扩展。**

**A Pi Coding Agent extension that records real LLM usage and vendor availability, then serves them as a loopback-only browser dashboard.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

```text
> /xpi-kuma
```

## 为什么

Pi 会为每条 assistant 消息报告 token 数与费用,但没有任何地方保留累计值,也不告诉你依赖的
中转站是否真的可达。`xpi-kuma` 同时补上这两块:把每次真实的 `message_end` 用量写入 SQLite,
按配置的间隔探测各供应商,并把结果以回环地址上的面板呈现出来。

面板刻意跑在你自己已有的浏览器里。上一版通过 Glimpse 渲染到原生窗口,代价是一个平台二进制、
一层 stderr 隔离转发脚本,以及窗口生命周期处理 —— 对一个只读面板来说都是纯粹的维护面。
回环 HTTP 服务加一个页面不需要这些,而且用的就是你已经装好的浏览器。

本仓库里的每个扩展都从同样四条规则出发:

- **没有构建步骤。** Pi 直接加载 `./src/index.ts`,没有 `dist/`、没有打包器、不提交编译产物。
- **Pi 原生 UI。** 渲染走 `ctx.ui.*` 与 `@earendil-works/pi-tui`,绝不劫持终端,也不引入竞争性的终端框架。
- **没有重度运行时依赖。** 只用宿主提供的 API 加严格类型;工具 Schema 用 `typebox`,其余依赖都要先证明自己值得。
- **门禁严格,没有例外。** TypeScript strict、Biome、Vitest 三条全绿才能提交。

它也不越界:扩展是被 Pi 主进程加载的插件,不是独立服务。确实需要进程边界时,先写一份 ADR 说明理由,再动手。

## 技术栈

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/),版本锁定在 [`mise.toml`](./mise.toml)
- [Pi Coding Agent](https://github.com/earendil-works/pi) —— 宿主本体、扩展 API 与 `@earendil-works/pi-tui`
- TypeScript strict(`target: ES2024`,`module: NodeNext`)
- [Biome](https://biomejs.dev/) 负责 lint 与格式化
- [Vitest](https://vitest.dev/) 作为测试运行器

## 安装

前置条件:一个可用的 Pi 安装。本包直接从源码加载,安装前不需要任何构建。

```bash
pi install git:github.com/<owner>/xpi-kuma@<ref>
```

| 安装位置 | 命令 |
| --- | --- |
| 全局(用户设置) | `pi install git:github.com/<owner>/xpi-kuma@<ref>` |
| 仅当前项目(`.pi/settings.json`) | `pi install -l git:github.com/<owner>/xpi-kuma@<ref>` |

`pi install` 写入 `~/.pi/agent/settings.json`;加 `-l` 写入项目设置,项目被信任后 Pi 会自动安装。固定的 git ref 不会被 `pi update` 移动。

```bash
pi list                              # 已安装的包
pi update --extensions               # 更新包并校对固定的 ref
pi remove git:github.com/<owner>/xpi-kuma
```

包级调试刻意只走 npm / git 远程源:本地路径安装只是在 settings 里留一条指向工作目录的引用,一旦忘记 `pi remove`,残留的脏路径就会和正式安装双份并存。

## 用法

| 命令 | 说明 |
| --- | --- |
| `/xpi-kuma` | 启动本机监控服务并用浏览器打开面板（供应商状态、使用量统计、费用/token 趋势） |

### 配置

扩展读取 `<项目>/.pi/xpi-kuma/config.yaml`。该文件在首次会话启动时由内置模板生成，
编辑它来声明需要监控的供应商。

```yaml
vendors:
  - name: "OpenAI"
    endpoint: "https://api.openai.com/v1"
    model: "gpt-4o-mini"
    api_key: "${OPENAI_API_KEY}"   # 仅从环境变量解析，不落盘
    price: { input: 0.15, output: 0.6 }   # 每千 tokens
    probe:
      enabled: true
      interval: "5m"              # 支持 5m / 30s / 1h
      timeout: 30000              # 毫秒

retention:
  raw_records: 7                  # 原始记录保留天数
```

- `api_key` 支持 `${ENV_VAR}` 占位符，只在内存中展开。变量未设置时保留原样，
  便于你及时察觉，而不是带着空密钥去探测。
- 探测固定发送 `"hi"` 且 `max_tokens: 1`，单次仅消耗几个 token。
  对限流严格的中转站把 `probe.enabled` 设为 `false` 即可关闭。
- 使用量数据存放在 `~/.pi/agent/data/xpi-kuma/usage.db`，面板读取同一个文件。

扩展写入的数据：

| 表 | 写入时机 | 内容 |
| --- | --- | --- |
| `usage_records` | 每条 assistant 消息（`message_end`） | 供应商上报的真实 token 数与费用 |
| `probe_records` | 每次定时或手动探测 | 状态、TTFT、总响应时间 |

footer 显示当前会话累计值，形如 `💰 ¥0.05 | 📊 1.2K`，每个 turn 结束后刷新。

### 监控面板

`/xpi-kuma` 会启动一个仅绑定 `127.0.0.1` 随机端口的会话级 Web 服务，然后用系统默认浏览器打开面板。
同一会话内重复执行该命令会复用已有服务，不会启动第二个。

- **仅本机。** 服务不监听任何非回环网卡，局域网内无法访问；访问由每次启动生成的 256 位随机凭据保护。
- **凭据放在 URL fragment**（`http://127.0.0.1:<端口>/#<凭据>`）。fragment 不会进入 HTTP 请求、
  不写访问日志，也不会通过第三方资源的 `Referer` 外泄；页面加载后立即把它从地址栏清除。
- **浏览器没自动打开？** 服务保持运行，Pi 会通过通知给出同一个可复制的 URL。
- **自动刷新。** 页面可见时每 5 秒轮询一次；标签页隐藏时暂停轮询，恢复可见时立即刷新一次。
  请求不会重叠，刷新失败时保留上一次已渲染的数据。
- **跟随会话生命周期。** Pi 在退出、reload、新建、恢复或 fork 会话时关闭服务：旧页面不再可用，
  旧凭据也会被拒绝 —— 在新会话里重新执行 `/xpi-kuma` 即可。

### 边界

`/xpi-kuma` 是本扩展注册的唯一命令。它会:

- **读取** `<项目>/.pi/xpi-kuma/config.yaml` 与 `usage_records` / `probe_records` 两张表。
- **启动**一个归属当前 Pi 会话的回环 HTTP 服务,然后用系统默认浏览器打开。
- **写入**仅发生在你触发探测时:每个供应商一次最小请求,消耗几个 token。
- **拒绝**监听非回环网卡、把供应商 API Key 交给浏览器,或在 Pi 会话结束后继续提供服务。

## 开发

```bash
mise install                         # 安装锁定版本的 Node.js 与 pnpm
pnpm install
```

| 门禁 | 命令 |
| --- | --- |
| 类型 | `pnpm typecheck` —— `tsc --noEmit` |
| Lint 与格式 | `pnpm -w run lint` —— Biome 全仓检查 |
| 测试 | `pnpm test` —— Vitest(`vitest run --passWithNoTests`) |

提交前三条必须全绿。Lint 请在 workspace root 显式运行 `pnpm -w run lint`;包装层偶发会把裸写的 `pnpm run lint` 误判为未知递归命令。

开发期运行扩展有两种方式:

```bash
pi -e ./src/index.ts                 # 冒烟:只加载一次,仅本次运行,不写配置
```

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-kuma   # 日常回路:在 Pi 内用 /reload 热载
```

`pi -e` 不写任何设置;软链由扩展目录自动发现,`rm` 掉软链即干净。

## 目录结构

```text
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md
├── docs/                      # Git 工作流与仓库约束
└── src/
    └── index.ts               # 扩展入口(register 函数)
```

## 设计规范

本项目遵循 [Google Labs DESIGN.md 规范](https://github.com/google-labs-code/design.md),并专门为终端 TUI 场景定制。详见 [`DESIGN.md`](./DESIGN.md) 查看设计 Token(颜色、等宽字阶、间距网格与组件定义)。

## 约定与约束

- **术语表**:[`CONTEXT.md`](./CONTEXT.md) 定义了本仓库的统一语言,代码、文档与提交中禁止术语漂移。
- **Git 纪律**:提交或推送前先读 [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) 与 [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md)。默认不直推 `main`,使用小粒度 Conventional Commits。
- **Token 安全**:密钥与 Token 绝不写入代码、日志、示例或文档。
- **Agent 契约**:[`AGENTS.md`](./AGENTS.md) 是本仓库的唯一事实来源。口头约定、历史代码或本 README 与它冲突时,以 `AGENTS.md` 为准。

## 致谢

- [Pi Coding Agent](https://github.com/earendil-works/pi) —— 由 [earendil-works](https://github.com/earendil-works) 开发。本扩展寄宿其中:扩展 API、`ctx.ui` 契约和包清单规范都来自该项目。
- [Chart.js](https://www.chartjs.org/) —— 以固定版本(`4.4.1`)从 jsDelivr CDN 加载,绘制费用与 token
  趋势。CDN 不可达时图表自行隐藏,统计表与供应商卡片仍然可用。

## 许可

MIT
