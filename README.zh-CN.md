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
- **Pi 原生 UI。** 扩展在终端里显示的一切都走 `ctx.ui.*`（通知），绝不劫持终端，也不引入竞争性的终端框架；面板本身是回环 Web 页面，不在终端里渲染。
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
| `/xpi-kuma` / `/xpi-kuma on` | 启动（或重启）本机监控服务并用浏览器打开面板，误关页面后再次执行即可重开（供应商状态、使用量统计、费用/token 趋势） |
| `/xpi-kuma off` | 关闭服务并释放端口；探测与用量采集随之中止，直到再次 `on` |

### 配置

扩展读取全局配置 `~/.pi/agent/data/xpi-kuma/config.yaml`（与 `usage.db` 同目录）。该文件在首次
会话启动时由内置模板生成，编辑它来声明需要监控的供应商。配置刻意做成全局的：它不属于某个项目。

扩展不会在你的项目里创建 `.pi/xpi-kuma/` 目录 —— 它唯一写出的配置位于
`~/.pi/agent/data/xpi-kuma/`。

`dashboard.port` 指定监听端口（默认 `5180`）。端口被占用时服务回退到随机端口，并告知实际使用
的端口号。

旧的项目配置（项目根下的 `.pi/xpi-kuma/config.yaml`）只会在启动时提示一次，扩展绝不自动搬动
它。需要迁移时在项目根执行：

```bash
cp ./.pi/xpi-kuma/config.yaml ~/.pi/agent/data/xpi-kuma/config.yaml
```

```yaml
dashboard:
  port: 5180                      # 被占用时回退随机端口

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

  - name: "commandcode"         # command-code 上游 API 可达性探测样例
    endpoint: "https://api.commandcode.ai/provider/v1"
    model: "<your-commandcode-model>"   # 占位：按你的订阅填写 model
    api_key: "${COMMANDCODE_API_KEY}"
    price: { input: 0, output: 0 }       # 无公开价目，按你的实际价目填写
    probe:
      enabled: true
      interval: "5m"
      timeout: 30000

retention:
  raw_records: 7                  # 原始记录保留天数
```

- `api_key` 支持 `${ENV_VAR}` 占位符，只在内存中展开。变量未设置时保留原样，
  便于你及时察觉，而不是带着空密钥去探测。
- 探测固定发送 `"hi"` 且 `max_tokens: 1`，单次仅消耗几个 token。
  流里有数据但没有可见文本时（部分模型在该 token 上限下只吐空内容块）依然判定为可达：
  状态记为 `up`、TTFT 显示未知，而不是误判成 `down`。
  对限流严格的中转站把 `probe.enabled` 设为 `false` 即可关闭。

扩展写入的数据：

| 表 | 写入时机 | 内容 |
| --- | --- | --- |
| `usage_records` | 每条 assistant 消息（`message_end`） | 供应商上报的真实 token 数、费用与工具调用条数 |
| `probe_records` | 每次定时或手动探测 | 状态、TTFT、总响应时间 |

会话级的 token 与费用看 Pi 内置 footer 的 stats 行（已含 token 明细、缓存命中率与 `$cost`）；本扩展
不再往 footer 写任何内容，周期聚合统一看面板。

### 监控面板

`/xpi-kuma` 会启动一个仅绑定 `127.0.0.1` 的 Web 服务（默认端口 `5180`，见 `dashboard.port`），
然后用系统默认浏览器打开面板。服务常驻整个 Pi 进程而不只是某个会话；重复执行该命令会复用已有
服务，不会启动第二个。

- **仅本机。** 服务不监听任何非回环网卡，局域网内无法访问；访问由持久复用的 256 位随机凭据保护。
- **凭据放在 URL fragment**（`http://127.0.0.1:<端口>/#<凭据>`）。fragment 不会进入 HTTP 请求、
  不写访问日志，也不会通过第三方资源的 `Referer` 外泄；页面加载后立即把它从地址栏清除，并在这个标签页的
  `sessionStorage` 里留一份，因此刷新页面仍然可用（标签页关闭后这份缓存即消失）。
- **凭据持久化在** `~/.pi/agent/data/xpi-kuma/dashboard.json`（权限 `0600`），因此书签与常驻页面在
  重启后依然可用；删除该文件即可轮换凭据。
- **浏览器没自动打开？** 服务保持运行，Pi 会通过通知给出同一个可复制的 URL。
- **误关了页面？** 服务在整个 Pi 进程内继续运行，再次运行 `/xpi-kuma` 即可用同一凭据重新打开同一个面板，不会启动第二个服务。
- **自动刷新。** 页面可见时每 5 秒轮询一次；标签页隐藏时暂停轮询，恢复可见时立即刷新一次。
  请求不会重叠，刷新失败时保留上一次已渲染的数据。手动刷新页面（`F5`）也不会丢凭据：标签页自己留了一份。
- **零外部资源。** 面板不加载任何 CDN 脚本或样式：趋势图是内联 SVG，颜色、字号与圆角全部取自仓库内的
  主题 token，离线也完整可用。
- **跟随 Pi 进程，而不是会话。** 退出、reload、新建、恢复或 fork 会话都不会关闭服务；只有
  `/xpi-kuma off`（或退出 Pi）才会关。`/xpi-kuma on` 会在同一端口、用同一凭据重新启动。

### 面板页面

同一个回环服务提供四个页面。入口都挂在主面板上，页内链接会把凭据带在 URL fragment 里继续传递，
因此从其他页面点进去仍然是有凭据的。

| 页面 | 路径 | 内容 |
| --- | --- | --- |
| 主面板 | `/` | 四个标签页：使用量总览、使用量统计、趋势图、供应商总览 |
| 供应商账户 | `/accounts` | 各供应商余额、这个数字的来源，以及刷新它需要做的动作 |
| 配置体检 | `/settings` | 对 `config.yaml` 的只读体检：逐供应商六项检查，外加全局与存储项 |
| 开始使用 | `/empty` | 未配供应商、或还没有任何用量记录时的引导 |


主面板的四个区块是标签页，一次只显示一个；页头的主题家族是下拉（默认 / 图鉴），亮暗另有独立按钮。
无偏好时的默认外观是**图鉴 · 亮色**，偏好存在 `localStorage` 的 `kuma.family` 与 `kuma.theme`，同样在首帧渲染前生效。
页头的 actions 行还带时间范围按钮（1 小时 / 24 小时 / 7 天 / 30 天）。它是页面级筛选：切换后
总览、统计、趋势与供应商四个标签一起按该周期刷新，选中的周期是全局的，不隶属任何单个标签。
页头有中英切换按钮（`#kuma-lang`），偏好存在 `localStorage` 的 `kuma.lang`，在首帧渲染前就已生效。

同一个页头还带字号调节（`A−` / `A+` / 重置），四个页面都有，共五档（85% 到 130%）；偏好存在
`localStorage` 的 `kuma.font`，同样在首帧前生效。面板里的数量、金额与时长的数字统一加千分位，
到达百万级自动换成 `M`、到亿级换成亿，长数字一眼可辨。

主面板的使用量统计表按 **供应商 / 模型 / 请求次数 / 输入、输出、缓存读、缓存写的 tokens 与费用 / 工具调用次数 / 单请求成本 / 缓存命中率 / tokens 占比 / 费用占比**
十二类列展示；占比按当前时间范围的全表合计算出，单请求成本为「费用 ÷ 请求次数」。首屏最多展示 8 行，
其余组合折叠成一行「其余 N 个组合已汇总」（数值相加，占比与单请求成本按汇总值重算）。正文宽度上限 `1280px`，列更宽时表格在正文内横向滚动，不撑破布局。

使用量总览标签页首屏是五项指标（本期花费 / token 总量 / 请求次数 / 覆盖项目数 / 缓存命中率），其下依次是
**解释型建议**、**provider/model 与项目费用排行**，以及**效率排行**。缓存命中率按
`cacheRead / (input + cacheRead)` 计算，分母为零时显示「未知」，不用 `0%` 顶替。

**建议是解释层，不是决策层。** 每条建议只说明对象、依据、样本数、时间范围与置信度；面板不因此切换模型、
不写入供应商配置，也不发起探测。

**效率排行只用真实调用时间点。** 请求开始、首个响应 token 与完成时刻都取自 Pi 事件链的直接观测；一个
provider/model 组合要有至少 10 条带完整时间点的成功记录才进入排行（门槛固定为 10，第一版不配置化），
不足的组合标注「样本不足」，没有可靠时间点的历史记录显示「暂无真实效率数据」—— 不用相邻记录、探测数据或
估算值替代。建议或效率计算失败时，基础总览与统计照常显示，只把该区块标为「洞察暂不可用」。

**余额按三档依次降级**，逐供应商执行；某一档失败只累加原因，不会中断整行。

1. **余额接口** —— 按 `balance.api_path` 相对 `endpoint` 请求，绝不替你猜路径。
2. **OAuth 授权** —— 需要 `oauth.authorize_url`、`token_url`、`client_id`、`scopes` 四项齐全，缺任意一项即视为
   未配置该档。在账户页发起授权；令牌落在 `~/.pi/agent/data/xpi-kuma/oauth.json`，权限 `0600`，
   且不包含 client secret。过期的令牌（留 30 秒余量）不参与查询，该行标注「授权已过期」。
3. **手动填写** —— 在账户页写入全局配置 `~/.pi/agent/data/xpi-kuma/config.yaml`，原地修改，写前生成
   `config.yaml.bak-<时间戳>` 备份；注释与未知字段都会保留。

三档全部失败时页面显示「未知」而不是 `0`；此前取到过的值会保留并标注为旧值，而不是被丢掉。

**配置体检页严格只读。** 它不会创建配置模板、不会修复损坏的文件，也绝不显示 API Key —— 只回显
`${ENV_VAR}` 占位符的名字，以及该变量当前是否已设置。解析失败时整块隐藏供应商表与全局项，
改为显示错误、行号与路径，而不是展示半截数据。

没有可用的余额接口才是常态，不是缺陷：`config.example.yaml` 里的四家样例目前都没有公开的余额接口，
探测结论见 [`docs/probe-balance-and-oauth.md`](./docs/probe-balance-and-oauth.md)。

### 边界

`/xpi-kuma` 是本扩展注册的唯一命令。它会:

- **读取** 全局 `~/.pi/agent/data/xpi-kuma/config.yaml` 与 `usage_records` / `probe_records` 两张表。
- **启动**一个归属当前 Pi 进程的回环 HTTP 服务（`on` / `off` 控制，缺省等同 `on`），然后用系统默认浏览器打开。
- **写入**仅发生在你明确触发时:探测会为每个供应商发一次最小请求,消耗几个 token;同步余额会查询供应商接口;
  手动填写在备份之后改写全局配置。
- **拒绝**监听非回环网卡、把供应商 API Key 交给浏览器、在余额字段之外改写配置文件,
  或在 `/xpi-kuma off` 之后继续提供服务。

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
├── AGENTS.md / CONTEXT.md / DESIGN.md / THEMES.md
├── README.md / README.zh-CN.md / LICENSE
├── docs/                      # Git 工作流、仓库约束与参考资料
└── src/
    ├── index.ts               # 扩展入口(register 函数)
    ├── config.ts              # 全局 config.yaml 读取与 ${ENV_VAR} 展开
    ├── types.ts               # 共享领域类型
    ├── insights.ts            # 成本 / 效率 / 缓存三类只读洞察(纯函数,不读库不写配置)
    ├── collectors/            # 用量落库与聚合查询
    ├── monitors/              # 定时供应商探测
    ├── storage/               # SQLite 持久化
    ├── lib/                   # 日志、浏览器唤起
    └── ui/                    # 面板 HTTP 服务、页面渲染与主题
```

## 设计规范

本项目遵循 [Google Labs DESIGN.md 规范](https://github.com/google-labs-code/design.md),并专门为终端 TUI 场景定制。详见 [`DESIGN.md`](./DESIGN.md) 查看设计 Token(颜色、等宽字阶、间距网格与组件定义)。

## 约定与约束

- **术语表**:[`CONTEXT.md`](./CONTEXT.md) 定义了本仓库的统一语言,代码、文档与提交中禁止术语漂移。
- **Git 纪律**:提交或推送前先读 [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) 与 [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md)。以 `docs/GIT-WORKFLOW.md` 为单一事实来源:默认直接在 `main` 上以小粒度 Conventional Commits 提交并推送,分支与 PR 只在你显式提出时才进入流程。
- **Token 安全**:密钥与 Token 绝不写入代码、日志、示例或文档。
- **Agent 契约**:[`AGENTS.md`](./AGENTS.md) 是本仓库的唯一事实来源。口头约定、历史代码或本 README 与它冲突时,以 `AGENTS.md` 为准。

## 致谢

- [Pi Coding Agent](https://github.com/earendil-works/pi) —— 由 [earendil-works](https://github.com/earendil-works) 开发。本扩展寄宿其中:扩展 API、`ctx.ui` 契约和包清单规范都来自该项目。

## 许可

MIT
