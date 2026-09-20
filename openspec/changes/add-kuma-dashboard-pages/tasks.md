## 1. 前置探测（先定未知项，再动代码）

- [x] 1.1 逐个探测配置样例里三家供应商（[OI] / Anthropic / 9router）是否提供可用的余额查询接口，把结论写进 `docs/probe-balance-and-oauth.md`，并据此决定 `config.example.yaml` 的 `balance.api_path` 样例；验证方式是笔记里每家都有明确的「有 / 无 + 证据」结论且不出现凭据明文。**证据等级为文档级**：本机 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `NINE_ROUTER_API_KEY` 均未设置，无法发真实请求；需要凭据才能完成的实测逐条列在笔记 §5，未冒充已完成。结论：三家的第一档余额接口全部不可用（[OI] 的 `credit_grants` 拒绝 API key、Anthropic 只有成本报告、9router 是 `*.example` 占位域名）。
- [x] 1.2 探测 OAuth 授权可行性并给出每家的结论与阻塞点；验证方式是笔记里逐家列出结论。结论见笔记 §2：对当前三家样例供应商，第二档 OAuth 均不可用或不推荐 —— Anthropic 只有未文档化端点且官方限定 OAuth token 专用于 [CC]、第三方调用有封号风险，[OI] 的 OAuth 面向订阅登录不提供余额接口，9router 无法探测。因此按降级顺序继续实现机制，但**第一、二档对开箱样例均无可用供应商**，这一发现已报告并建议在实现 7.3 / 7.4 前重新确认投入。
- [x] 1.3 确认 `ctx.sessionManager.getSessionName()` 的可得性并定下归因「会话」维度的标识策略；验证方式是 `pnpm typecheck` 通过，且策略以注释落在 `src/index.ts` 的 `handleMessageEnd` 上方。类型核对结论：`getSessionName()` 返回 `string | undefined`（来自最新的 `session_info` 条目，用户没命名过即为空），而 `getSessionId()` 始终有值 —— 因此策略调整为**分组键用 `sessionId`、会话名不落库、展示用标识短前缀**（原计划的「名称优先」会引入可变元数据快照与额外列）。完整结论见 `docs/probe-balance-and-oauth.md` §6。

## 2. 主题 token 迁移（先换底座，再改结构）

- [x] 2.1 把 `THEMES.md` 的 Default 家族全量 token 与 Atlas 家族覆盖块搬进代码（替换 `src/ui/theme.ts` 的 `--kuma-*` 派生 token），半径消费一律写 `max(0px, calc(var(--radius) - Npx))`；验证方式是主题单测断言两套家族的同名变量取值不同、且 Atlas 下不产生负半径。
- [x] 2.2 落地明暗 + 家族三态切换：`data-theme` 与 `data-family` 写到 `<html>`，偏好存 `localStorage` 的 `kuma.theme` / `kuma.family`，并在首帧前应用；验证方式是脚本测试断言首帧前应用、切换后刷新保持，以及 Atlas 专属装饰仅在 Atlas 下出现。
- [x] 2.3 删除 `CHART_JS_CDN` 与 CSP 里的外部脚本放行，并把趋势图从 Chart.js 改写为页内内联 SVG（`design.md` D6），CSP 收紧为仅 `'nonce-...'` 脚本来源；验证方式是服务测试断言响应头不含任何外部来源、页面 HTML 不出现外部 `src`/`href`，且脚本测试断言折线图按数据渲染出 SVG 折线与悬停详情、空数据时不报错。**（原描述遗漏了内联 SVG 重写：只删 CDN 会让趋势图失效并违反 spec 的「零外部请求」。已按用户确认并入本任务。）**

## 3. 前端模块拆分（阻止单文件继续膨胀）

- [x] 3.1 建立 `src/ui/client/` 目录骨架，把 `dashboard-client.ts` 的凭据引导与地址栏清除逻辑迁到 `bootstrap.ts`，并确认旧测试仍通过；验证方式是 `pnpm test` 全绿且新模块有独立测试文件。
- [x] 3.2 把带 `Authorization` 的请求封装与错误归一迁到 `client/api.ts`，把可见性感知轮询迁到 `client/poll.ts`；验证方式是脚本测试覆盖 5 秒间隔、隐藏暂停、恢复立即刷新、in-flight 去重与失败不产生无界重试。
- [x] 3.3 建立 `client/pages/` 装配层，让每个页面 shell 按固定顺序拼装脚本片段（bootstrap 必须最先）；验证方式是 HTML 生成测试断言脚本顺序与各页脚本内容互不串页。
- [x] 3.4 拆分后确认 `src/ui/` 下没有单文件超过 300 行，超出的继续按职责切分；验证方式是 `wc -l` 逐个检查并记录结果。 结果：生产代码全部 ≤300 行（client/ 页面片段 201、chart 188、render 171、poll 31、api 21、bootstrap 58；theme 拆为 theme.ts 119 + theme-tokens.ts 244 数据表；装配层 dashboard-client.ts 48）。超限 3 个各有理由：`dashboard.ts` 302（服务端路由，任务 4.1 拆 routes/ 表）；`dashboard-client.test.ts` 686 与 `dashboard.test.ts` 348（集成测试套件，拆分会破坏 harness 一致性，豁免）。

## 4. 多页面路由与外壳

- [x] 4.1 把 `src/ui/dashboard.ts` 的路由链抽成 `src/ui/routes/pages.ts` 与 `src/ui/routes/api.ts` 两张表，服务只保留启动、凭据、Host/Origin 校验、CSP 与关闭逻辑；验证方式是现有服务测试全部通过，且 `dashboard.ts` 行数下降。
- [x] 4.2 新增 `GET /empty`、`GET /accounts`、`GET /settings` 三个页面外壳，均为不含任何数据与凭据的静态结构；验证方式是服务测试断言四个页面路径均返回 200、内容不含凭据，且数据接口在无凭据时仍返回 401。
- [x] 4.3 实现页面互链：主面板供应商健康块头提供「账户详情」与「配置体检」入口，子页页头提供「返回主面板」，链接通过 URL fragment 携带凭据；验证方式是 HTML 测试断言链接形态，且断言凭据不出现在 query 中。
- [x] 4.4 处理无凭据直达：脚本发现 URL 无凭据时显示「需要凭据，请重新执行 `/xpi-kuma`」而不是空白页；验证方式是脚本测试覆盖该分支。

## 5. 归因数据层

- [x] 5.1 在 `message_end` 处理函数中接入 `ctx`，记录 `ctx.cwd` 与 `ctx.sessionManager.getSessionId()`，取值包在 try/catch 内、取不到写空值；验证方式是指令测试覆盖「有 ctx 时写入」与「取值抛错时仍写入记录」两条路径。
- [x] 5.2 在 `Database` 中新增 `migrateSchema()`：按 `PRAGMA table_info` 判断缺列后 `ALTER TABLE ADD COLUMN` 补 `cwd` / `session_id`，并补 `(cwd, timestamp)`、`(session_id, timestamp)` 索引；验证方式是迁移测试断言旧库打开后列存在、既有记录保留、连续打开两次不报错。
- [x] 5.3 实现 `getAttribution(period, dimension)`，支持项目 / 会话 / 供应商·模型三档分组，返回花费、token 总量、请求次数并按花费倒序；验证方式是聚合测试断言三档的花费、token、请求次数总和彼此相等且等于 `getStats` 总量。
- [x] 5.4 让缺少项目或会话信息的存量记录归入「未知」分组而不是被丢弃；验证方式是在迁移后的库里插入空 cwd 记录并断言其落入「未知」行。
- [x] 5.5 新增 `GET /api/attribution`，参数为时间范围与维度，非法参数返回 400；验证方式是服务测试覆盖合法、非法时间范围、非法维度三种请求。

## 6. 主面板新区块

- [x] 6.1 落地花费概览区块（本期花费 / token 总量 / 请求数 / 覆盖项目数），随周期切换刷新；验证方式是 HTML 测试断言四项结构存在，且数据接口返回的概览值与统计一致。结论：四项由 `GET /api/dashboard` 新增的 `overview` 字段返回，服务端在同一份 `stats` 上累加（覆盖项目数取项目维度归因的非空分组数，「未知」不算项目），因此概览与统计表口径天然一致；断言见 `dashboard-client.test.ts`「花费概览与用量归因」与 `dashboard.test.ts`「概览四项与统计一致」。
- [x] 6.2 落地用量归因区块：维度切换（项目 / 会话 / 供应商·模型）+ 明细表（维度 / 花费 / token / 请求数 / 占比），按花费倒序；验证方式是脚本测试覆盖维度切换与占比计算，并在无数据时显示「暂无数据」。结论：归因改由 `GET /api/dashboard?dimension=` 与统计一起返回（一次刷新只发一个请求，`/api/attribution` 仍保留给其它消费方）；占比在页内按总花费现算，会话维度显示标识短前缀、空键显示「未知」；断言见 `dashboard-client.test.ts`「花费概览与用量归因」。
- [x] 6.3 落地分区索引轨（仅 Atlas 家族显示，点击滚动到对应区块并更新 `aria-current`，窄视口隐藏）；验证方式是脚本测试覆盖滚动定位与视口隐藏分支。结论：轨在 `[data-family="atlas"] .kuma-rail` 下才得到 `display: flex`，`@media (max-width: 1100px)` 内再置 `display: none`（该媒体查询必须排在 `.kuma-atlas-only` 规则之后才压得住 `revert`，已写进注释）；脚本测试覆盖点击滚动与 `aria-current` 互斥，视口隐藏以 CSS 断言覆盖。
- [x] 6.4 调整主面板信息层级：花费概览置于首屏，供应商健康降为次级块，趋势图保持在归因之后；验证方式是 HTML 测试断言区块顺序，并人工核对首屏一眼能看出「本期花了多少」。结论：区块顺序为 花费概览 → 用量归因 → 使用量统计 → 费用与 token 趋势 → 供应商健康，时间范围按钮随概览移到首屏（切换后概览、归因、统计与趋势一起刷新）；顺序断言见 `dashboard-html.test.ts`「主面板信息层级与分区索引轨」，人工核对归入 11.3 冒烟。

## 7. 供应商账户页

- [x] 7.1 扩展配置模型与 `config.example.yaml`：`VendorConfig` 新增可选 `balance`（`api_path` / `manual` / `topup`）与 `oauth`（`authorize_url` / `token_url` / `client_id` / `scopes`）段，解析保持 fail-closed；验证方式是配置测试覆盖「段缺失视为未配置」「字段类型错误抛 `ConfigError`」两种情况，并确认旧配置不改仍能加载。结论：段缺失 → `undefined`，段存在但字段类型不符 → `ConfigError`；OAuth 四项缺任意一项按「未配置授权」处理（不报错，用户可能只用余额接口）；`config.example.yaml` 补注释样例并注明探测结论（三家样例都无可用接口，不预设路径）；测试见 `config.test.ts`「余额与授权配置段」。
- [x] 7.2 新增 `account_balances` 表与读写方法（vendor、balance、currency、source、topup、synced_at、error）；验证方式是数据库测试覆盖写入、覆盖更新与读取，并断言重开数据库后值仍在。结论：实现为 vendor 主键 + 上述列（外加 `stale` 标记旧值），`upsertAccountBalance` 用 `ON CONFLICT(vendor) DO UPDATE` 覆盖更新，未知值存 NULL 而不是 0；`getAccountBalances()` / `getAccountBalance(vendor)` 供面板读取；测试见 `database.test.ts`「余额快照」。
- [x] 7.3 实现第一档余额取数：按配置的 `balance.api_path` 请求供应商接口，复用 `fetch` + `AbortController` 超时形态；验证方式是单测覆盖成功、超时、非 2xx 三种情况，且错误信息不含凭据。结论：`src/accounts/balance-api.ts` 只请求显式声明的路径（未声明直接失败，不猜端点）；响应按键名词根（balance / credit / available / remaining / quota）广度优先取第一个数值，找不到即失败而**不是随便挑一个数字**；错误信息只有状态码或 `timeout`，不含 URL 之外的凭据；测试见 `balance-api.test.ts`。
- [x] 7.4 实现第二档 OAuth 授权与查询：授权发起、`/oauth/callback` 的 `state` 一次性校验、token 落盘 `~/.pi/agent/data/xpi-kuma/oauth.json`（`0600`）与过期判定；验证方式是单测覆盖 state 不匹配被拒、过期 token 不参与查询、文件权限为 `0600`，以及回调路径之外仍要求凭据。结论：`oauth.ts` 提供 `OAuthTokenStore`（0600、只存令牌与过期时间、损坏即当未授权）与 `OAuthFlow`（state 一次性、授权地址构造、code 换令牌，**不参与 client secret**）；`/oauth/callback` 由 `routes/oauth.ts` 处理并豁免 Bearer，`AccountService.completeAuthorization` 校验 state 后才换令牌落盘；过期判定留 30s 余量，过期令牌不进入第二档查询而是标「授权已过期」；测试见 `oauth.test.ts` 与 `dashboard.test.ts`「账户接口」。
- [x] 7.5 实现第三档手动填写：用 yaml `Document` API 定点改 `<cwd>/.pi/xpi-kuma/config.yaml`，写前生成 `config.yaml.bak-<时间戳>`，临时文件 + `rename` 原子替换，解析失败时拒绝写入；验证方式是单测断言注释与未知字段保留、备份文件生成、解析失败时不改动原文件。结论：`src/accounts/manual.ts` 已有 `balance` 段就原地补字段（保住既有 `api_path`），没有就整段建出来；供应商不存在同样拒绝写入；测试见 `manual.test.ts`。
- [x] 7.6 实现 `resolveBalance(vendor)` 的三档降级编排，任一档失败只记录不抛错；验证方式是单测覆盖「接口可用」「接口失败回落 OAuth」「两档都不通回落手动」「全部不可得时返回未知而非 0」四条路径。结论：`src/accounts/resolve.ts` 按 接口 → OAuth → 手动 顺序尝试，每档失败只累加原因；全部失败时若有上次成功值就保留它并标 `stale`（附「显示上次成功获取的值」说明），从未拿到过则 `balance: null`（界面显示「未知」，**绝不返回 0**）；`resolveBalances` 逐供应商执行，单个出错不影响其他行；测试见 `resolve.test.ts`。
- [x] 7.7 新增账户接口：`GET /api/accounts`（概览 + 明细）、`POST /api/accounts/sync`（同步全部）、`POST /api/accounts/manual`（写入手动值），全部要求凭据且写操作校验 Origin；验证方式是服务测试覆盖未授权 401、错误 Origin 403、单供应商失败不影响其他行。结论：另加 `POST /api/accounts/authorize`（发起授权，返回地址）与 `GET /oauth/callback`（唯一豁免 Bearer 的写路径，靠一次性 state 把关）；`AccountService` 以配置为准生成行（新增供应商落成未知、已删除的不再展示）、按余额升序且未知排最后；请求体读取有 8KB 上限；测试见 `dashboard.test.ts`「账户接口」。
- [x] 7.8 落地账户页 UI：账户概览（累计充值 / 当前余额 + 不可信数字说明）、按余额升序的明细表（供应商·模型 / 数据来源 / 余额 / 累计充值 / 最近同步 / 动作）、来源图例、空态（无供应商 / 无可用数字两条分支）；验证方式是 HTML 测试断言结构与来源标记，并断言「未知」不渲染成 ¥0.00。结论：概览说明「多少项为手动填写、多少项是授权过期旧值」并声明合计未做汇率换算；明细行给出来源标记与下一步动作（填写 / 授权 / 重新授权）；无供应商时不渲染明细表而提示编辑 `config.yaml`；测试见 `dashboard-client.test.ts`「账户页脚本」与 `dashboard-html.test.ts`「供应商账户页结构」。

## 8. 配置体检页

- [ ] 8.1 实现只读 `inspectConfig(cwd)`：不调用会创建模板的 `loadConfig()`，用 `existsSync` 判断存在性，存在才解析，捕获 `ConfigError` 并原样返回 `message` 与 `line`；验证方式是单测断言「文件缺失时不创建文件」与「解析失败返回行号」。
- [ ] 8.2 实现逐供应商六项检查（必填字段 / endpoint / model / api_key 环境变量是否存在 / 价格完整性 / 探测配置）与待处理项计数，缺失项带下一步动作；验证方式是单测覆盖环境变量未设置、价格缺输出项、缺 endpoint、未配密钥四种情形。
- [ ] 8.3 实现全局与存储项（保留天数及来源、用量库路径与存在性及大小、探测默认值、会话 cwd），文件不存在时标注「不存在」；验证方式是单测覆盖用量库存在与不存在两种情况。
- [ ] 8.4 新增 `GET /api/diagnostics` 并要求凭据；验证方式是服务测试覆盖未授权 401 与正常返回。
- [ ] 8.5 落地体检页 UI：配置明细、供应商体检表（密钥只显示变量名）、全局与存储、只读声明、解析失败替代卡（不展示半截供应商表）；验证方式是 HTML 测试断言解析失败时供应商表与全局项均不出现，并断言页面出现只读声明。

## 9. 零数据引导态

- [ ] 9.1 实现空态判定与引导页内容：未配供应商 / 有供应商但无记录两条分支，分别给出配置文件指引与产生数据的三条路径；验证方式是 HTML 测试覆盖两条分支，且返回主面板链接存在。
- [ ] 9.2 让主面板在无数据时引导用户前往引导页，而不是渲染空表；验证方式是脚本测试断言无记录时出现引导入口。

## 10. 中英双语

- [ ] 10.1 为四个页面的可见文案建立 `data-i18n` 键与中英字典，切换时同步更新文本、`aria-label` 与 `<html lang>`；验证方式是脚本测试覆盖切换后文本与属性更新、刷新后语言保持。
- [ ] 10.2 人工核对四个页面在英文下的排版不溢出（按钮、表头、空态文案）；验证方式是在浏览器里逐页切换语言并确认无截断或换行错位。

## 11. 收尾与验证

- [ ] 11.1 更新 `README.md` 与 `README.zh-CN.md`：四个页面的进入方式、余额三档降级与手动填写位置、体检页只读边界、OAuth 的配置要求与不支持时的降级；验证方式是两份文档内容一致且不包含任何凭据示例明文。
- [ ] 11.2 运行 `pnpm typecheck`、`pnpm -w run lint`、`pnpm test` 并全部通过；验证方式是三条命令退出码为 0 且无新增 lint error。
- [ ] 11.3 运行 `pi -e ./src/index.ts` 冒烟：手工验证四个页面均可打开、主面板归因与概览随周期刷新、账户页同步按钮可用、体检页展示真实配置、Pi 退出后端口关闭；验证方式是逐项手工确认并记录结果。
- [ ] 11.4 用旧版本的 `usage.db` 副本做一次真实迁移冒烟，确认扩展启动后既有记录仍可查询、归因把历史记录归入「未知」；验证方式是查询结果包含迁移前后的记录且总花费不变。
