# 探测笔记：供应商余额接口与 OAuth 可行性

> 对应 change `add-kuma-dashboard-pages` 的任务 `1.1` / `1.2`。
> **证据等级说明**：本次未做真实 API 请求验证 —— 三个 API key 环境变量（`OPENAI_API_KEY`、
> `ANTHROPIC_API_KEY`、`NINE_ROUTER_API_KEY`）在本机均未设置，无凭据可发请求。
> 以下结论来自公开文档与官方社区的一手陈述，等级为**文档级证据**。
> 需要真实请求才能确认的部分，已逐条列在文末「未完成的实测」。
>
> 本文件不记录任何凭据值。

## 1. 结论摘要

| 供应商 | 第一档：余额接口 | 第二档：OAuth 查询 | 实际可用档位 |
| :--- | :--- | :--- | :--- |
| `[OI]` | **不可用** —— 无官方余额接口；`credit_grants` 拒绝 API key | **不可用** —— 无面向余额的 OAuth 授权 | 第三档：手动填写 |
| `Anthropic` | **不可用** —— 只有成本报告接口，非余额；且需 Admin API key | **不推荐** —— 仅未文档化接口，且官方限定 OAuth token 只用于 [CC]，第三方调用有封号风险 | 第三档：手动填写 |
| `9router` | **无法探测** —— `api.9router.example` 是占位域名 | 无法探测 | 第三档：手动填写 |

**总体结论**：三档降级的第一、二档对当前 `config.example.yaml` 里的三家样例供应商**均不可用**。
`vendor-accounts` 的降级顺序（接口 → OAuth → 手动）作为**机制**依然成立且必须实现 ——
它对用户自建的中转站、自托管服务、以及其他供应商仍然有效 —— 但**开箱即用路径实际只有手动填写**。

这个结论不改变 `vendor-accounts` 的 spec（降级顺序与「取不到值不显示零」的要求不变），
但改变了两件事的实际价值判断：`tasks.md` 的 `7.3`（第一档）与 `7.4`（第二档）需要用户重新确认是否投入。

## 2. 逐家证据

### 2.1 `[OI]`（endpoint `https://api.openai.com/v1`）

**第一档不可用。** `/dashboard/billing/credit_grants` 曾经可用，但 [OI] 的更新后改为只接受
浏览器 session key。用 API key 请求会得到明确的拒绝响应：

> Your request to GET /dashboard/billing/credit_grants must be made with a session key
> (that is, it can only be made from the browser). You made it with …

来源：`https://github.com/LaoYutang/openai-balance`（该工具正是为绕过此限制而写，README 直接引用了这段错误原文）。
官方社区多个主题（`community.openai.com/t/get-the-remaining-credits-via-the-api/18827`、
`.../why-is-there-no-api-for-account-balance/577584`）反复确认：**API 不提供余额查询接口**。

[OI] 确实有 `/v1/organization/costs` 端点，但它是**成本报告**（按日聚合的已花费金额），
需要 Admin API key，且回答的是"花了多少"而不是"还剩多少"。用它推算余额需要额外知道充值总额，
属于猜测，不满足 `vendor-accounts` spec 里"不伪造数字"的要求。

**第二档不可用。** [OI] 的 OAuth 流程面向 ChatGPT/Codex 订阅登录，不提供余额查询接口。

### 2.2 `Anthropic`（endpoint `https://api.anthropic.com/v1`）

**第一档不可用。** 官方有 `GET /v1/organizations/cost_report`（需 Admin API key），
同样是**成本报告**而非余额。Anthropic 的余额是预付费额度，只在 `console.anthropic.com` 的
账单页可见，没有文档化的 API。

**第二档明确不推荐。** 社区存在未文档化端点 `GET https://api.anthropic.com/api/oauth/usage`，
但有两个独立问题：

1. **未文档化** —— 接口随时可能变更或消失，属于不稳定的实现依赖。
2. **有封号风险** —— Anthropic 官方限定 OAuth token 专用于 [CC]；把它用于第三方工具调用
   非官方接口，已有账号被自动审查停用的公开报告。

来源：社区工具链（`github.com/robinebers/openusage`、`github.com/roman10/mcode`、
`claude-meter.com`）的 provider 文档，以及 Anthropic 官方对 OAuth token 适用范围的说明。

**结论**：第二档对 Anthropic **不应实现**。若用户坚持，必须在 UI 上明示风险，且默认关闭。

### 2.3 `9router`（endpoint `https://api.9router.example/v1`）

**无法探测，且这不是真实服务。** `api.9router.example` 解析到 `198.18.0.12`，
属于 `198.18.0.0/15` —— RFC 2544 保留的基准测试网段，不可路由。
`curl --max-time 5 https://api.9router.example/v1/models` 返回连接失败（无 HTTP 状态码）。

这是 `config.example.yaml` 里的**占位样例**，不是可用的供应商。因此：

- 无法对它做任何接口探测；
- 它不能作为"第一档可用"的证据；
- 如果将来要保留这个样例，`config.example.yaml` 里应注明它是占位、需替换为真实服务。

## 3. 对设计的实际影响

| 设计条目 | 影响 |
| :--- | :--- |
| `design.md` D10（三档降级编排） | **机制不变**。`resolveBalance()` 的降级顺序与"逐档失败不抛错"仍然正确。 |
| `design.md` D12（OAuth 回调 + state 校验） | **机制不变**，但实现价值取决于用户是否有支持 OAuth 的供应商。对 Anthropic 建议不实现。 |
| `design.md` Open Questions（第 1 条） | **部分回答**：三家样例供应商的第一档全部不可用。剩余未知项是用户真实使用的其他供应商。 |
| `vendor-accounts` spec | **不需要改**。降级顺序、"未知"而非 ¥0.00、来源标记等要求全部仍然成立。 |
| `tasks.md` 7.3 / 7.4 | 需要用户确认是否投入。建议：`7.3` 实现（对自建/中转站有用，成本低），`7.4` 暂缓或默认关闭。 |
| `config.example.yaml` | `balance.api_path` 样例**不应**填写 `[OI]` 的 `credit_grants`（会 403 误导用户）。应留空或标注为占位。 |

## 4. 新增风险（建议补入 `design.md` 的 Risks）

- **[未文档化接口依赖]** Anthropic 的 OAuth 用量端点没有官方文档，随时可能变更 →
  不实现该档位；若将来实现，必须带超时与失败回落，且不得作为唯一数据源。
- **[第三方 OAuth 调用的账号风险]** 把 OAuth token 用于非官方用途可能导致账号被停用 →
  实现前必须在 UI 明示风险；默认关闭该档位；不得在未告知用户的情况下自动尝试。
- **[占位样例被误当真实供应商]** `9router` 的 `*.example` 域名不可路由 →
  `config.example.yaml` 里标注为占位，README 说明需替换。

## 5. 未完成的实测（需要凭据）

以下项目在本次**未验证**，需要真实 API key 才能完成。它们是 `tasks.md` 1.1 / 1.2 的
剩余部分，不是已完成项：

- [ ] 用真实 `OPENAI_API_KEY` 请求 `/dashboard/billing/credit_grants`，确认返回 403 及错误原文。
- [ ] 用真实 `ANTHROPIC_API_KEY` 请求 `/v1/organizations/cost_report`，确认其对普通 API key 的拒绝行为（预期需要 Admin key）。
- [ ] 若用户有 Admin API key，确认 `/v1/organizations/cost_report` 的响应结构与"余额"的可推导性。
- [ ] 若用户有真实的第三方供应商（自建中转站、OpenRouter 等），确认其是否有可用的余额接口 —— 这是决定第一档是否值得投入的关键证据。
- [ ] 确认目标供应商是否支持 `http://127.0.0.1:<随机端口>` 作为 OAuth 回调地址。

## 6. 任务 1.3 结论：归因的会话标识策略

**类型核对**（`@earendil-works/pi-coding-agent@0.84.4` 的 `.d.ts`）：

| 取值 | 签名 | 是否始终有值 |
| :--- | :--- | :--- |
| `ctx.cwd` | `string` | 是 |
| `ctx.sessionManager.getSessionId()` | `string` | 是 |
| `ctx.sessionManager.getSessionName()` | `string \| undefined` | **否**（来自最新的 `session_info` 条目，用户没命名过就是 `undefined`） |

三者都在 `ReadonlySessionManager` 的 `Pick` 白名单里，`message_end` 的 handler 能通过第二个参数
`ctx` 拿到（`ExtensionHandler<E, R> = (event, ctx) => ...`）。

**定下的策略**：

1. **分组键用 `sessionId`**，不用会话名 —— 它稳定且始终有值。
2. **会话名不落库**：会话名是可变元数据，用户随时可重命名；存快照会让历史行与实际名称
   不一致，还要多一列去同步。历史归因的会话展示改用标识的短前缀。
3. **`getSessionName()` 只用于界面提示「当前会话」**，不参与历史归因展示。
4. **取值失败降级为空字符串、不抛错**：拿不到元数据时照常写入使用量记录，归因查询把空值
   归入「未知」分组。丢一条使用量记录比丢一个维度严重得多。

策略已作为注释落在 `src/index.ts` 的 `handleMessageEnd` 上方，供任务 `5.1` 直接落地实现。
此处不预建未被引用的模块 —— 没有使用者的模块是死代码。
