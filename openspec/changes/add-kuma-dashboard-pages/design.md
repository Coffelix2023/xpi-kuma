## Context

动机与范围见 `proposal.md`；行为契约见本 change 的 5 份 delta spec（`dashboard-ui`、`usage-attribution`、`vendor-accounts`、`config-diagnostics`、`usage-collection`）。这里只记录约束与由此产生的技术选择。

**当前实现约束（实测）**

- `src/ui/dashboard.ts` 用 `node:http` 起单服务，路由硬编码 4 条：`GET /`、`GET /api/dashboard`、`POST /api/probes`、`POST /api/probes/<name>`。`GET /` 不校验凭据（首帧无法携带 fragment），其余全部要求 Bearer 凭据；写操作额外校验 `Origin`。CSP 目前放行 `'nonce-...'` 与 Chart.js CDN 两个脚本来源。
- `src/ui/dashboard-html.ts`、`dashboard-css.ts`、`dashboard-client.ts`、`theme.ts` 各为一个"返回大字符串"的模块，合计约 800 行；页面脚本、样式、token 全部塞在单页里。
- 面板配色 token（`--kuma-*`）是从 `DESIGN.md` 的暗色终端画布派生的 10 个变量，只有明暗两套，**没有家族维度**。原型照抄的是 `THEMES.md` 的 30+ 个 token 与两套家族（Default / Atlas），两者不是同一套体系。
- `src/storage/database.ts` 只有 `CREATE TABLE IF NOT EXISTS`，**没有任何版本或迁移机制**；`usage_records` 无 `cwd` / `session_id`。
- `src/index.ts` 的 `message_end` 处理函数当前只接 `event`，未使用第二个参数。
- 配置模型（`src/types.ts` / `src/config.ts`）只有 `vendors` 与 `retention`，没有余额、充值或授权字段。
- 探测链路（`src/monitors/vendor-monitor.ts`）已具备可复用的形态：`fetch` + `AbortController` 超时 + 结果落库。

**Pi API 事实（已核对 `@earendil-works/pi-coding-agent@0.84.4` 的 `.d.ts`）**

- `ExtensionHandler<E, R> = (event: E, ctx: ExtensionContext) => ...`，即 **`message_end` 同样能拿到 `ctx`**。
- `ExtensionContext.cwd` 提供当前工作目录；`ctx.sessionManager` 是 `ReadonlySessionManager`，含 `getSessionId()` 与 `getCwd()`。
- `SessionStartEvent` 本身不含会话标识，只有 `reason` 与 `previousSessionFile`。

## Goals / Non-Goals

**Goals**

- 四页共用一套服务、凭据、主题与语言偏好，新增页面不复制粘贴认证与轮询逻辑。
- 把页面脚本、样式、token 拆成可单测的小模块，阻止 `dashboard-client.ts` 继续膨胀。
- 归因与余额两类新数据都有明确的持久化与迁移路径，且历史数据不被丢弃。
- 余额、授权、密钥三条路径的安全边界在实现前定死。

**Non-Goals**

- 不引入前端框架、打包器或图表库；沿用"服务端拼字符串 + 原生 DOM"。
- 不做服务端渲染数据（页面外壳仍是静态的，数据一律由页内脚本拉取）。
- 不改 `DESIGN.md`；它继续管终端渲染（footer 状态栏等），Web 面板改用 `THEMES.md`。
- 不做供应商详情下钻页、模态框、分栏拖拽（原型未定义）。
- 不在体检页做任何写盘（增删改供应商留给后续 change）。

## Decisions

### D1. 路由与页面外壳的凭据边界

新增 `GET /empty`、`GET /accounts`、`GET /settings`。**四个页面外壳一律不校验凭据**，因为它们与 `GET /` 同理：首帧请求无法携带 fragment。安全由两层保证：

1. 页面外壳是纯静态结构，不含任何监控数据、凭据或配置值；
2. 所有数据接口（含新增的归因、账户、体检接口）继续走 `authorized()`，写操作继续走 `sameOrigin()`。

页面之间的跳转由页内脚本生成带 `#<token>` 的链接，fragment 不进 HTTP 请求。用户手输 `/accounts` 而没有 fragment 时，外壳照常加载，脚本发现无凭据后显示"需要凭据，请重新执行 `/xpi-kuma`"，而不是空白页。

*备选*：让页面路由也要求凭据 —— 被否，会导致首帧 401 与用户手输地址直接失败。*备选*：把凭据放 query —— 被否，spec 明确禁止凭据进入查询参数。

### D2. 页面与 API 的路由表分派

`dashboard.ts` 已到 326 行，直接堆更多 `if` 会失控。改为：

- `src/ui/routes/pages.ts`：页面路径 → shell 生成函数的映射；
- `src/ui/routes/api.ts`：API 路径 → 处理函数的映射（含方法校验）；
- `dashboard.ts` 保留服务启动、凭据、Host/Origin 校验、CSP、关闭逻辑，只做"查表 + 分派"。

*备选*：保持单文件 `if` 链 —— 被否，AGENTS.md 的单文件规模约束与可测性都不允许。

### D3. 前端模块拆分

`dashboard-client.ts` 的单一大函数拆为 `src/ui/client/` 下的一组模块，每个导出一个返回脚本片段的函数，由页面 shell 按需拼装：

- `bootstrap.ts`：fragment 凭据读取与地址栏清除、偏好首帧应用；
- `api.ts`：带 `Authorization` 的 `fetch` 封装与错误归一；
- `poll.ts`：可见性感知轮询（5s、隐藏暂停、恢复立即刷新、in-flight 去重）；
- `i18n.ts`：`data-i18n` 字典与切换；
- `theme.ts`：明暗、家族切换与偏好持久化；
- `chart.ts`：内联 SVG 折线图渲染与 hover；
- `pages/{dashboard,empty,accounts,settings}.ts`：各页的装配与事件绑定。

拼装顺序固定（bootstrap 必须最先执行，否则首帧会闪），由 shell 生成函数集中控制。

*备选*：引入 Vite/esbuild 打包 —— 被否，`AGENTS.md` 明确禁止构建步骤与 dist 产物。

### D4. 主题 token 迁移到 THEMES.md 家族

面板 token 从 `--kuma-*`（DESIGN.md 派生，10 个）迁移到 `THEMES.md` 的家族 token，并保留 `data-family` 维度：

- Default 家族为默认，Atlas 家族由 `[data-family="atlas"]` 覆盖同名变量；
- 半径一律写 `max(0px, calc(var(--radius) - Npx))`，避免 Atlas 的 `--radius: 0rem` 算出负值；
- 状态色只用家族已有的前景色 / 破坏色 / 弱化前景色，不自造 success 绿。

*备选*：继续用 `--kuma-*` 并只加一套 Atlas 覆盖 —— 被否，两套 token 体系并存会让每个新页面都要维护两份映射。

### D5. i18n 用属性字典，不做运行时替换 DOM 文本

页面文案由服务端按 `data-i18n="key"` 输出默认中文，页内脚本持有中英字典，切换时按属性批量替换文本与 `aria-label`。`<html lang>` 同步更新。

*备选*：服务端按语言参数渲染两套 —— 被否，会与"页面外壳无状态"冲突，且偏好存在浏览器本地。

### D6. 趋势图改内联 SVG，服务端不再放行任何外部来源

删除 `CHART_JS_CDN` 与 CSP 中的 CDN 放行，`chart.ts` 用内联 `<svg>` 绘制双轴折线。CSP 收紧为 `script-src 'nonce-...'`（仅自身），并保留 `connect-src 'self'`。

*备选*：服务端渲染 SVG 字符串 —— 被否，数据是客户端拉取的，服务端渲染会引入第二套数据路径；hover 交互也更难做。

### D7. 归因采集：`message_end` 直接用 `ctx`

```ts
pi.on("message_end", (event, ctx) => handleMessageEnd(event, ctx));
```

项目路径取 `ctx.cwd`，会话标识取 `ctx.sessionManager.getSessionId()`，两者都包在 try/catch 内；取不到就写空值，绝不因为拿不到元数据而丢掉这条使用量记录。

*备选*：在 `session_start` 缓存 cwd/sessionId 到 `Runtime` —— 被否，多一份需要随会话切换同步的状态，而 `ctx` 已经是当前会话的权威来源。

### D8. 数据库迁移：列存在性检查 + `ALTER TABLE`

在 `initSchema()` 之后新增 `migrateSchema()`：读 `PRAGMA table_info(usage_records)`，缺 `cwd` / `session_id` 则 `ALTER TABLE ... ADD COLUMN`，并补 `(cwd, timestamp)` 与 `(session_id, timestamp)` 索引。幂等、无版本号、不需要用户操作。

*备选*：引入 `PRAGMA user_version` 版本机 —— 当前只有一次增量，版本机是过度设计；等出现第二次不兼容变更再引入。

*备选*：新建表并拷数据 —— 被否，`ALTER TABLE ADD COLUMN` 在 SQLite 上是常数时间且不重写数据。

### D9. 归因查询：三个 GROUP BY 变体，共用时间窗

`getAttribution(period, dimension)` 复用现有的 `PERIOD_MS` 时间窗与 `StatsRow` 别名映射，按维度选择分组列；空值分组用 SQL 的 `COALESCE` 归一后由 UI 显示"未知"。占比在 UI 侧按总花费计算，避免 SQL 里再做一次全表聚合。

### D10. 余额三档：能力探测 + 逐档回落

`src/accounts/` 下三个模块，`resolveBalance(vendor)` 按顺序尝试：

1. `balance-api.ts`：配置里声明了余额接口路径时，用供应商 API Key 请求；
2. `oauth.ts`：配置了 OAuth 且本地有未过期 token 时，用 token 请求；
3. 回落：返回"未知"并附上"授权"或"填写"动作。

每一档的结果都带 `source` 与 `error`，逐档失败不抛错、只记录。**不猜测任何供应商的余额接口**：配置里没声明就不尝试，实现阶段先实测再往 `config.example.yaml` 里补样例。

### D11. 余额与充值的持久化位置

- **余额快照**：数据库新表 `account_balances`（vendor、balance、currency、source、topup、synced_at、error），面板重开即读，符合 spec 的"重开保留上次值"。
- **手动填写的余额与充值**：写回 `<cwd>/.pi/xpi-kuma/config.yaml` 的供应商条目，用 yaml `Document` API 定点改以保留注释与未知字段，写前备份 `config.yaml.bak-<时间戳>`，临时文件 + `rename` 原子替换。
- **OAuth token**：`~/.pi/agent/data/xpi-kuma/oauth.json`，创建时 `chmod 0600`，只存 token 与过期时间，不存 client secret。

*备选*：把手动余额也只放数据库 —— 被否，用户会期望"我填的值在我的配置文件里"，而且 `config.yaml` 已经是供应商信息的单一来源。

### D12. OAuth 回调：state 校验，且是唯一豁免 Bearer 的写路径

回调地址为 `http://127.0.0.1:<port>/oauth/callback`。服务商重定向回来时不带我们的 Bearer，因此该路径豁免凭据校验，改为强制校验：

- `state` 必须是本次授权发起时生成并保存在内存中的一次性随机值，用后即焚；
- `Host` 头仍必须是当前监听地址；
- 只接受 `GET`，且只处理 `code` 与 `error` 两个参数。

授权发起前先校验该供应商的 OAuth 配置完整（`authorize_url` / `token_url` / `client_id` / `scopes`），不完整直接给出配置缺失提示，不打开浏览器。

*风险已知*：部分服务商要求预注册 `client_id` 或不支持 `127.0.0.1` 回调。这属于实现期验证项，见 Open Questions。

### D13. 配置模型扩展

`VendorConfig` 新增可选段，全部缺省时行为与今天完全一致：

```yaml
vendors:
  - name: "[OI]"
    # ...现有字段...
    balance:
      api_path: "/dashboard/billing/credit_grants"   # 可选：余额接口路径
      manual: 42.6                                    # 可选：手动填写的余额
      topup: 200                                      # 可选：累计充值
    oauth:                                            # 可选
      authorize_url: "https://..."
      token_url: "https://..."
      client_id: "..."
      scopes: ["..."]
```

解析保持 fail-closed：段存在但字段类型不对即抛 `ConfigError`；段缺失则视为未配置。

### D14. 体检数据：只读快照，不碰 `loadConfig` 的副作用

`loadConfig()` 在文件缺失时会创建模板 —— 体检页**不能**用它，否则违反"只读"要求。体检走独立的 `inspectConfig(cwd)`：用 `existsSync` 判断存在性，存在才读并用同一套解析器，捕获 `ConfigError` 后把 `message` 与 `line` 原样返回。存储项用 `statSync` 取大小与 mtime，全部包在 try/catch 内。

### D15. 测试策略

沿用现有 vitest 与"一个模块一个测试文件"的形态：

- 服务层：路由表（含新页面与新 API 的未授权、错误 Host、错误 Origin 用例）、CSP 收紧后的断言；
- 数据层：迁移幂等（对同一个库连开两次）、存量行新列为空、归因三档总和相等；
- 账户层：三档降级的回落顺序、取不到值不返回 0、手动写盘保留注释与备份；
- 体检层：解析失败时不出供应商表、缺失文件不创建模板；
- 前端：HTML 结构断言 + 脚本行为的 fake timer/DOM 测试（沿用 `dashboard-client.test.ts` 的现有手法）。

## Risks / Trade-offs

- **[OAuth 可行性未知]** 各服务商的余额接口、回调要求、客户端注册方式都未验证 → 实现期先做一次性探测（`tasks.md` 的首个任务），把结论写进 `config.example.yaml` 与 README；不支持的服务商按 D10 降级到手动填写，而不是伪造数字。
- **[单次范围过大]** 4 页 + 迁移 + OAuth 一次落地，review 面很宽 → 按 capability 分阶段提交，每阶段结束时 `typecheck` / `lint` / `test` 三绿再进入下一阶段；阶段之间保持可运行。
- **[token 体系迁移会牵动所有既有样式]** 面板外观在迁移中途会短暂不一致 → 先一次性换掉 token 层（含明暗与家族），再改页面结构，避免两件事混在一起。
- **[手动写 `config.yaml` 有损坏用户配置的风险]** → yaml `Document` API 定点改 + 备份 + 原子替换；解析失败时拒绝写入并提示先修配置。
- **[存量记录的项目/会话维度不可用]** 历史数据没有 cwd/sessionId → 按 spec 归入"未知"分组并显式标注，不猜测、不回填。
- **[OAuth token 落盘]** 密钥纪律风险 → 独立文件 + `0600` + 不进日志/页面/错误响应；日志只记供应商名与错误类别。
- **[页面外壳不再有凭据保护]** 任何人只要知道端口就能取到静态外壳 → 端口是随机的且仅回环监听；外壳不含任何数据；数据接口与写操作的保护不变。

## Migration Plan

1. **数据**：扩展启动时自动执行 D8 的列补齐，幂等且向前兼容（旧版本代码读新库时，多出的列不影响其显式 `SELECT`）。
2. **配置**：新字段全部可选，旧配置不改也能启动；`config.example.yaml` 补上样例并注明"可选"。
3. **前端**：无构建步骤，扩展加载即生效；用户浏览器需重新执行 `/xpi-kuma` 拿到新 shell（旧的已打开页面在服务重启后即失效，符合现有生命周期 spec）。
4. **回滚**：全部改动在 git 内，`git revert` 即可回到当前行为；数据库新增列对旧代码无影响，无需回滚脚本。若需彻底清理，删除 `usage.db` 会重建（代价是丢失历史使用量，属于用户显式选择）。

## Open Questions

- 各供应商余额接口的实际路径与响应结构，以及哪些服务商支持 `127.0.0.1` 回调 —— 实现期第一步探测，结论只影响 `config.example.yaml` 样例与 README，不改变本设计的分层与降级顺序。
- OAuth 是否需要在 token 过期时自动刷新 —— 可以先只做"过期即标注并要求重新授权"，若实测刷新接口稳定再补。
- 归因的"会话"维度用什么做可读标识（会话名 vs 短 id）—— 取决于 `getSessionName()` 的可得性，实现期确认；两种都不影响聚合与占比口径。
