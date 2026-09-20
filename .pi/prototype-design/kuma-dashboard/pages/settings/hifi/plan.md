# plan.md — hifi (kuma-dashboard / settings)

> 本阶段唯一需求事实来源。每轮深挖后**覆写本文件**，不新建副本。

## 1. 目的 (Why)

让用户一眼看出「我的配置到底长什么样、哪一项缺了、缺了会怎样」。
只读体检：把 `config.yaml` 的真实解析结果摊开，每个缺失项配一句下一步动作。

## 2. 受众 (Who)

xpi-kuma 开源用户。首次运行时 `config.yaml` 由模板自动生成，用户往往没意识到
`api_key` 的环境变量还没设、`price` 还没填——面板此时给出的数字会莫名其妙。

## 3. 范围

### 包含

- `P4-1` 头部：生效路径 · 返回主面板 · 重新读取
- `P4-2` 配置文件：路径 / 来源（模板生成 vs 已有）/ YAML 解析结果 / 修改时间
- `P4-3` 供应商体检表：每行一个供应商，检查 name / endpoint / model / api_key 环境变量 /
  price / probe 六项，缺失项给可执行动作
- `P4-4` 全局与存储：`retention.raw_records`、`usage.db` 存在性与大小、三项默认值提示
- `P4-5` 只读边界与下一轮写盘策略说明

### 不包含

- **任何写盘**：增删改供应商、改价格、改探测开关全部留给下一轮
- 密钥明文：`api_key` 只显示它指向的环境变量名与是否已设置，不回显值
- 探测/用量数据（那是主面板与账户页的职责）

### 数据来源（已逐条核对 `src/config.ts`，非推测）

| 体检项 | 代码依据 |
| :--- | :--- |
| 生效路径 | `resolveConfigPath()` → `<cwd>/.pi/xpi-kuma/config.yaml` |
| 首次运行由模板生成 | `loadConfig()` 内 `copyFileSync(TEMPLATE_PATH, configPath)` |
| YAML 解析结果 | `parseDocument(raw).errors[0]`，`ConfigError` 带行号 |
| name / endpoint / model 必填 | `requireString(...)` |
| api_key 可选、`${VAR}` 未设时原样保留 | `expandEnvPlaceholders()` |
| price 需 input 与 output 同为数字，否则整个 price 为 undefined | `parseVendors()` |
| probe 默认关闭、`5m`、`30000ms` | `DEFAULT_PROBE_*` |
| retention 默认 7 天 | `DEFAULT_RETENTION_DAYS` |
| usage.db 位置 | `join(getAgentDir(), "data", "xpi-kuma", "usage.db")` |

## 4. 页面清单

| ID | 页面 | 优先级 | 状态覆盖 |
| :--- | :--- | :--- | :--- |
| P4 | 配置体检（只读） | P0 | main / parse-error |

## 5. 交付形态

- [x] desktop 1280 单文件
- [ ] mobile 390 —— 不做
- [x] 状态覆盖：正常 / 解析失败（`parse-error`）

## 6. 主题与语言

- 与既有三页共用同一套：Default-Themes 为默认家族 + dark，Atlas-Themes 可选
- 页内不新增主题/语言按钮，读取主面板写入的 `kuma.theme` / `kuma.lang` / `kuma.family`

## 7. 启用技能

- [x] design-token / spacing-system —— 复用既有 token 与 8pt 节奏
- [x] ux-writing —— 「下一步动作」的措辞是这一页的主要交付物
- [x] error-handling-ux —— 解析失败态与 fail-closed 的呈现
- [x] design-qa-checklist —— 对照 `src/config.ts` 逐项核对
- [ ] component-spec / state-machine —— 无弹窗、无多状态面板，跳过

## 8. 任务编排

> 任务清单与进度在同目录 `tasks.md`。

切分理由：与既有页同构（骨架 → token/基座 → 头部 → 各块 → 自检）。因为无上游线框，
骨架一步就把五块占位与 id 定死，后续只填内容，避免结构漂移。

## 9. 成功标准

- [x] 每个 ✗ 旁边都有一句可执行动作，不是只有颜色
- [x] 解析失败时不显示半截数据，只显示错误与文件路径
- [x] 密钥在页面上永远只以 `$ENV_VAR` 形式出现
- [x] 零外部请求

## 10. 未决问题

- [ ] 增删改表单的具体字段与交互 —— 下一轮，写盘策略已定（保注释定点改 + `.bak` + 原子写）
- [ ] 「重新读取」是否需要在面板里真的重扫文件 —— 本轮原型是静态数据，按钮只做忙碌态
