/**
 * 界面文案的**单一事实来源**（中英双语字典）。
 *
 * 服务端渲染页面时用 `zh()` 输出默认中文并写上 `data-i18n` 键；页内脚本拿同一份字典
 * 做切换。两处共用一份数据，避免"改了 HTML 忘了脚本"的漂移。
 *
 * 约定：
 *
 * - 键名用 `<域>.<名>`；页内脚本生成的动态文本也要有键；
 * - 含动态值的句子拆成"前缀 + 值 + 后缀"多个键，不做字符串插值；
 * - 服务端生成的诊断结论（含环境变量名等运行期值）不在此表内，保持中文。
 */
export const MESSAGES = {
  "accounts.balanceTotal": {
    en: "Current balance",
    zh: "当前余额",
  },
  "accounts.col.action": {
    en: "Action",
    zh: "动作",
  },
  "accounts.col.balance": {
    en: "Balance",
    zh: "余额",
  },
  "accounts.col.source": {
    en: "Source",
    zh: "数据来源",
  },
  "accounts.col.syncedAt": {
    en: "Last sync",
    zh: "最近同步",
  },
  "accounts.col.topup": {
    en: "Topped up",
    zh: "累计充值",
  },
  "accounts.col.vendorModel": {
    en: "Vendor · model",
    zh: "供应商 · 模型",
  },
  "accounts.legend": {
    en: "Sources: API query / OAuth / manual entry. “Unknown” means the value is unavailable, not 0.",
    zh: "来源图例：接口查询 / OAuth 授权 / 手动填写；「未知」表示取不到值，不是 0。",
  },
  "accounts.promptPrefix": {
    en: "Enter the current balance for ",
    zh: "请输入 ",
  },
  "accounts.promptSuffix": {
    en: " (written back to .pi/xpi-kuma/config.yaml)",
    zh: " 的当前余额（写回 .pi/xpi-kuma/config.yaml）",
  },
  "accounts.topupTotal": {
    en: "Total topped up",
    zh: "累计充值",
  },
  "accounts.trustAllFresh": {
    en: "All values are freshly fetched",
    zh: "全部为自动获取的最新值",
  },
  "accounts.trustFx": {
    en: "Totals add raw values across currencies, no FX conversion",
    zh: "合计按各供应商上报币种原值累加，未做汇率换算",
  },
  "accounts.trustManualSuffix": {
    en: " manually entered",
    zh: " 项为手动填写",
  },
  "accounts.trustNoNumbers": {
    en: "No balance number available yet",
    zh: "还没有取到任何余额数字",
  },
  "accounts.trustStaleSuffix": {
    en: " stale values kept after OAuth expiry",
    zh: " 项为授权过期后保留的旧值",
  },
  "action.authorize": {
    en: "Authorize",
    zh: "授权",
  },
  "action.fill": {
    en: "Enter value",
    zh: "填写",
  },
  "action.reauthorize": {
    en: "Re-authorize",
    zh: "重新授权",
  },
  "aria.dimension": {
    en: "Attribution dimension",
    zh: "归因维度",
  },
  "aria.rail": {
    en: "Section index",
    zh: "分区索引",
  },
  "aria.timeRange": {
    en: "Time range",
    zh: "时间范围",
  },
  "attribution.cost": {
    en: "Cost",
    zh: "花费",
  },
  "attribution.dimension": {
    en: "Dimension",
    zh: "维度",
  },
  "attribution.share": {
    en: "Share",
    zh: "占比",
  },
  "attribution.tokens": {
    en: "Token",
    zh: "Token",
  },
  "chart.aria": {
    en: "Cost and token trend over time",
    zh: "按时间的费用与 token 趋势折线图",
  },
  "chart.desc": {
    en: "Cost lines (left axis) and a dashed token total line (right axis) over time, one line per vendor; hover a point for details.",
    zh: "按时间的费用折线（左轴）与 token 总量虚线（右轴），每个供应商一条折线；悬停某一时间点可看该点明细。",
  },
  "chart.missingPrice": {
    en: "Not configured",
    zh: "未配置",
  },
  "chart.svgTitle": {
    en: "Cost and token trend",
    zh: "费用与 token 趋势",
  },
  "check.apiKey": {
    en: "API key",
    zh: "API Key",
  },
  "check.endpoint": {
    en: "Endpoint",
    zh: "Endpoint",
  },
  "check.model": {
    en: "Model",
    zh: "模型",
  },
  "check.price": {
    en: "Price completeness",
    zh: "价格完整性",
  },
  "check.probe": {
    en: "Probe config",
    zh: "探测配置",
  },
  "check.required": {
    en: "Required fields",
    zh: "必填字段",
  },
  "common.colon": {
    en: ": ",
    zh: "：",
  },
  "common.comma": {
    en: ", ",
    zh: "，",
  },
  "common.connectionFailed": {
    en: "Connection failed",
    zh: "连接失败",
  },
  "common.missingToken": {
    en: "Missing access token — re-run /xpi-kuma",
    zh: "缺少访问凭据，请重新执行 /xpi-kuma",
  },

  "common.never": {
    en: "Never",
    zh: "从未",
  },
  "common.noData": {
    en: "No data",
    zh: "暂无数据",
  },
  "common.notANumber": {
    en: "must be a number",
    zh: "必须是数字",
  },
  "common.periodClose": {
    en: ")",
    zh: "）",
  },
  "common.periodOpen": {
    en: " (",
    zh: "（",
  },
  "common.probing": {
    en: "Probing…",
    zh: "探测中…",
  },
  "common.refresh": {
    en: "Refresh",
    zh: "刷新",
  },
  "common.reopenHint": {
    en: "Re-run /xpi-kuma",
    zh: "请重新执行 /xpi-kuma",
  },
  "common.sentenceEnd": {
    en: ".",
    zh: "。",
  },
  "common.separator": {
    en: "; ",
    zh: "；",
  },
  "common.unknown": {
    en: "Unknown",
    zh: "未知",
  },
  "common.updatedAt": {
    en: "Updated at",
    zh: "更新于",
  },
  "dimension.project": {
    en: "Project",
    zh: "项目",
  },
  "dimension.session": {
    en: "Session",
    zh: "会话",
  },
  "dimension.vendorModel": {
    en: "Vendor · model",
    zh: "供应商·模型",
  },
  "font.group": {
    en: "Font size",
    zh: "字号",
  },
  "font.larger": {
    en: "Increase font size",
    zh: "放大字号",
  },
  "font.reset": {
    en: "Reset",
    zh: "重置",
  },
  "font.smaller": {
    en: "Decrease font size",
    zh: "缩小字号",
  },
  "global.bytesPrefix": {
    en: "Exists (",
    zh: "存在（",
  },
  "global.bytesSuffix": {
    en: ")",
    zh: "）",
  },
  "global.configuredValue": {
    en: " (configured)",
    zh: "（配置值）",
  },
  "global.cwd": {
    en: "Session working dir",
    zh: "会话工作目录",
  },
  "global.databasePath": {
    en: "Usage DB path",
    zh: "用量库路径",
  },
  "global.databaseState": {
    en: "Usage DB state",
    zh: "用量库状态",
  },
  "global.defaultValue": {
    en: " (default)",
    zh: "（默认值）",
  },
  "global.probeDefaults": {
    en: "Probe defaults",
    zh: "探测默认参数",
  },
  "global.probeSummaryMiddle": {
    en: ", timeout ",
    zh: "，超时 ",
  },
  "global.probeSummaryPrefix": {
    en: "Every ",
    zh: "间隔 ",
  },
  "global.probeSummarySuffix": {
    en: " ms",
    zh: " ms",
  },
  "global.retention": {
    en: "Retention (days)",
    zh: "记录保留天数",
  },
  "guide.dataPath1": {
    en: "Use Pi normally in this project: new LLM calls are recorded via message_end.",
    zh: "在本项目里正常使用 Pi：新的 LLM 调用会经 message_end 自动计入用量。",
  },
  "guide.dataPath2": {
    en: "Configure vendors in .pi/xpi-kuma/config.yaml so probes and accounts can show up.",
    zh: "在 .pi/xpi-kuma/config.yaml 里配置供应商，面板才能展示探测与账户信息。",
  },
  "guide.dataPath3": {
    en: "Re-run /xpi-kuma to reopen the panel; once data exists the dashboard replaces this page.",
    zh: "执行 /xpi-kuma 重新打开面板；数据出现后主面板会替换本页。",
  },
  "guide.hasRecordsMiddle": {
    en: " calls (",
    zh: " 次调用（",
  },
  "guide.hasRecordsPrefix": {
    en: "Already recorded ",
    zh: "已经记录 ",
  },
  "guide.hasRecordsSuffix": {
    en: " in this range) — go back to the dashboard to view them.",
    zh: " 内），可以返回主面板查看。",
  },
  "guide.noRecords": {
    en: "No usage records yet: pick any of the three paths above to produce the first one.",
    zh: "还没有任何使用量记录：上面三条路径任选其一，就能产生第一份数据。",
  },
  "guide.vendorsIntro": {
    en: "The config has no vendor yet, so there is nothing to show for vendors, accounts or probes.",
    zh: "配置文件里目前没有任何供应商，面板因此没有供应商、账户与探测信息可展示。",
  },
  "guide.vendorsStep1": {
    en: "Open .pi/xpi-kuma/config.yaml (a template is created on first run).",
    zh: "打开 .pi/xpi-kuma/config.yaml（首次运行面板时会自动生成模板）。",
  },
  "guide.vendorsStep2": {
    en: "Add an entry under vendors: name / endpoint / model / api_key.",
    zh: "在 vendors 下补一个条目：name / endpoint / model / api_key。",
  },
  "guide.vendorsStep3": {
    en: "Go back to the dashboard and open “Config diagnostics” to verify all six checks.",
    zh: "回到主面板进入「配置体检」，核对六项检查是否全部通过。",
  },
  "lang.ariaSwitch": {
    en: "Switch language",
    zh: "切换界面语言",
  },
  "lang.toChinese": {
    en: "中文",
    zh: "中文",
  },
  "lang.toEnglish": {
    en: "English",
    zh: "English",
  },
  "link.accounts": {
    en: "Account details",
    zh: "账户详情",
  },
  "link.backToDashboard": {
    en: "Back to dashboard",
    zh: "返回主面板",
  },
  "link.guide": {
    en: "See the three ways to produce data",
    zh: "查看产生数据的三条路径",
  },
  "link.settings": {
    en: "Config diagnostics",
    zh: "配置体检",
  },
  "overview.cost": {
    en: "Spend this period",
    zh: "本期花费",
  },
  "overview.emptyPrefix": {
    en: "No usage recorded this period",
    zh: "本期还没有使用量记录",
  },
  "overview.projects": {
    en: "Projects covered",
    zh: "覆盖项目数",
  },
  "overview.requests": {
    en: "Requests",
    zh: "请求次数",
  },
  "overview.tokens": {
    en: "Total tokens",
    zh: "Token 总量",
  },
  "page.accounts.syncAll": {
    en: "Sync all balances",
    zh: "同步全部余额",
  },
  "page.accounts.syncing": {
    en: "Syncing…",
    zh: "同步中…",
  },

  "page.accounts.title": {
    en: "Vendor accounts",
    zh: "供应商账户",
  },
  "page.dashboard.loading": {
    en: "Loading…",
    zh: "正在加载…",
  },
  "page.dashboard.refreshAll": {
    en: "Refresh all",
    zh: "全部刷新",
  },

  "page.dashboard.title": {
    en: "xpi-kuma Dashboard",
    zh: "xpi-kuma 监控面板",
  },
  "page.dashboard.toAtlas": {
    en: "Atlas",
    zh: "图鉴风",
  },
  "page.dashboard.toDark": {
    en: "Dark",
    zh: "暗色",
  },
  "page.dashboard.toDefault": {
    en: "Default",
    zh: "默认风",
  },
  "page.dashboard.toLight": {
    en: "Light",
    zh: "亮色",
  },
  "page.empty.subtitle": {
    en: "Checking current data and config…",
    zh: "正在检查当前数据与配置…",
  },

  "page.empty.title": {
    en: "No data to show yet",
    zh: "还没有可展示的数据",
  },

  "page.settings.title": {
    en: "Config diagnostics",
    zh: "配置体检",
  },
  "range.1h": {
    en: "1 hour",
    zh: "1小时",
  },
  "range.7d": {
    en: "7 days",
    zh: "7天",
  },
  "range.24h": {
    en: "24 hours",
    zh: "24小时",
  },
  "range.30d": {
    en: "30 days",
    zh: "30天",
  },
  "section.accountRows": {
    en: "Account details",
    zh: "账户明细",
  },
  "section.accountsOverview": {
    en: "Account overview",
    zh: "账户概览",
  },
  "section.attribution": {
    en: "Usage attribution",
    zh: "用量归因",
  },
  "section.chart": {
    en: "Cost & token trend",
    zh: "费用与 token 趋势",
  },
  "section.configDetail": {
    en: "Config detail",
    zh: "配置明细",
  },
  "section.globalStorage": {
    en: "Global & storage",
    zh: "全局与存储",
  },
  "section.guideData": {
    en: "Three ways to produce data",
    zh: "产生数据的三条路径",
  },
  "section.guideVendors": {
    en: "Configure a vendor first",
    zh: "先配置一个供应商",
  },

  "section.overview": {
    en: "Spend overview",
    zh: "花费概览",
  },
  "section.stats": {
    en: "Usage stats",
    zh: "使用量统计",
  },
  "section.vendorChecks": {
    en: "Vendor checks",
    zh: "供应商体检",
  },
  "section.vendors": {
    en: "Vendor health",
    zh: "供应商健康",
  },
  "settings.actionNone": {
    en: "—",
    zh: "—",
  },
  "settings.allPass": {
    en: "All checks passed",
    zh: "全部通过",
  },
  "settings.col.action": {
    en: "Next step",
    zh: "下一步",
  },
  "settings.col.check": {
    en: "Check",
    zh: "检查项",
  },
  "settings.col.detail": {
    en: "Detail",
    zh: "说明",
  },
  "settings.col.result": {
    en: "Result",
    zh: "结果",
  },
  "settings.col.vendor": {
    en: "Vendor",
    zh: "供应商",
  },
  "settings.errorFilePrefix": {
    en: "File: ",
    zh: "文件：",
  },
  "settings.errorHint": {
    en: "Fix the config and click “Reload”. This page never auto-fixes or writes files.",
    zh: "改好配置后点「重新读取」。本页不会自动修复，也不会写入任何文件。",
  },
  "settings.errorLinePrefix": {
    en: "At line ",
    zh: "出错位置：第 ",
  },
  "settings.errorLineSuffix": {
    en: "",
    zh: " 行",
  },
  "settings.fail": {
    en: "Fail",
    zh: "未通过",
  },
  "settings.fileExists": {
    en: "Exists",
    zh: "存在",
  },
  "settings.fileMissing": {
    en: "Missing",
    zh: "不存在",
  },
  "settings.issuesPrefix": {
    en: "Issues: ",
    zh: "待处理 ",
  },
  "settings.issuesSuffix": {
    en: "",
    zh: " 项",
  },
  "settings.noVendor": {
    en: "No vendor in the config",
    zh: "配置里没有任何供应商",
  },
  "settings.parseFail": {
    en: "Failed",
    zh: "失败",
  },
  "settings.parseFailedTitle": {
    en: "Config parse failed",
    zh: "配置解析失败",
  },
  "settings.parseOk": {
    en: "Passed",
    zh: "通过",
  },
  "settings.pass": {
    en: "Pass",
    zh: "通过",
  },
  "settings.readonly": {
    en: "This page is read-only: no template creation, no config edits, no database writes.",
    zh: "本页只读取与校验，不产生任何写盘操作：不创建模板、不修改配置文件、不写数据库。",
  },
  "settings.reload": {
    en: "Reload",
    zh: "重新读取",
  },
  "settings.row.fileState": {
    en: "File",
    zh: "文件状态",
  },
  "settings.row.modifiedAt": {
    en: "Modified at",
    zh: "修改时间",
  },
  "settings.row.parseResult": {
    en: "Parse result",
    zh: "解析结果",
  },
  "settings.row.path": {
    en: "Effective path",
    zh: "生效路径",
  },
  "settings.row.source": {
    en: "Config source",
    zh: "配置来源",
  },
  "settings.sourceNote": {
    en: "Project .pi/xpi-kuma/config.yaml",
    zh: "项目内 .pi/xpi-kuma/config.yaml",
  },
  "source.api": {
    en: "API query",
    zh: "接口查询",
  },
  "source.manual": {
    en: "Manual entry",
    zh: "手动填写",
  },
  "source.oauth": {
    en: "OAuth",
    zh: "OAuth 授权",
  },
  "source.oauthStale": {
    en: "OAuth (stale value)",
    zh: "OAuth 授权（旧值）",
  },
  "stats.cacheRead": {
    en: "Cache read",
    zh: "缓存读",
  },
  "stats.cacheWrite": {
    en: "Cache write",
    zh: "缓存写",
  },
  "stats.requests": {
    en: "Requests",
    zh: "请求数",
  },
  "stats.tokensInput": {
    en: "Input tok",
    zh: "输入 tok",
  },
  "stats.tokensOutput": {
    en: "Output tok",
    zh: "输出 tok",
  },
  "stats.totalCost": {
    en: "Total cost",
    zh: "总费用",
  },
  "stats.vendorModel": {
    en: "Vendor / model",
    zh: "供应商 / 模型",
  },
  "unit.day": {
    en: " days",
    zh: " 天",
  },
  "vendor.lastProbe": {
    en: "Last probe",
    zh: "最近探测",
  },
  "vendor.noVendor": {
    en: "No vendor configured — edit .pi/xpi-kuma/config.yaml",
    zh: "未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml",
  },
  "vendor.pricePerK": {
    en: "Price / 1k tok",
    zh: "价格/千tok",
  },
  "vendor.probeNow": {
    en: "Probe now",
    zh: "立即探测",
  },
  "vendor.responseTime": {
    en: "Response time",
    zh: "响应时间",
  },
  "vendor.ttft": {
    en: "TTFT",
    zh: "TTFT",
  },
} as const;

/** 词条键；服务端与页内脚本共用同一套键名。 */
export type MessageKey = keyof typeof MESSAGES;

/** 默认（服务端渲染）语言下的文案。 */
export function zh(key: MessageKey): string {
  return MESSAGES[key].zh;
}

/** `data-i18n` 属性；元素内容由 `zh()` 一并写出，首帧就是正确语言。 */
export function i18nAttr(key: MessageKey): string {
  return ` data-i18n="${key}"`;
}

/** `data-i18n-aria` 属性；用于 aria-label 这类不可见但需要翻译的文案。 */
export function i18nAria(key: MessageKey): string {
  return ` data-i18n-aria="${key}" aria-label="${zh(key)}"`;
}
