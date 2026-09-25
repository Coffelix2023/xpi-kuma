/**
 * 语义标签映射：生产源码 `data-semantic-id` 全路径 → 字典短码 + 中文标签。
 *
 * 事实来源是 `.pi/prototype-design/kuma-dashboard/semantic-ui-map.yaml`（status: locked
 * 且登记了 impl 的元素）；本表只服务语义徽标调试层（见 `semantic-badge.ts`）。
 * `semantic-map.test.ts` 会比对字典与本表，防止漂移。
 */
export interface SemanticBadgeEntry {
  short: string;
  label: string;
}

export const SEMANTIC_BADGES: Record<string, SemanticBadgeEntry> = {
  "dashboard.header": { short: "P1-1", label: "面板头部" },
  "dashboard.header.title": { short: "P1-1-T1", label: "面板标题" },
  "dashboard.header.period": { short: "P1-1-S1", label: "周期切换" },
  "dashboard.header.theme-toggle": { short: "P1-1-B1", label: "主题切换" },
  "dashboard.header.lang-toggle": { short: "P1-1-B2", label: "语言切换" },
  "dashboard.header.family-toggle": { short: "P1-1-B3", label: "主题家族切换" },
  "dashboard.overview": { short: "P1-2", label: "花费概览" },
  "dashboard.overview.cost": { short: "P1-2-C1", label: "本期花费" },
  "dashboard.overview.tokens": { short: "P1-2-C2", label: "Token 总量" },
  "dashboard.overview.requests": { short: "P1-2-C3", label: "请求数" },
  "dashboard.overview.projects": { short: "P1-2-C4", label: "覆盖项目数" },
  "dashboard.attribution": { short: "P1-3", label: "用量归因" },
  "dashboard.attribution.table": { short: "P1-3-T1", label: "归因明细表" },
  "dashboard.vendors": { short: "P1-4", label: "供应商健康" },
  "dashboard.vendors.grid": { short: "P1-4-L1", label: "供应商卡片网格" },
  "dashboard.vendors.refresh-all": { short: "P1-4-B1", label: "全部刷新" },
  "dashboard.trend": { short: "P1-5", label: "费用与 token 趋势" },
  "dashboard.trend.chart": { short: "P1-5-C1", label: "趋势图" },
  "dashboard-empty.guide.steps": { short: "P2-1-L1", label: "产生数据的三条路径" },
  "dashboard-empty.guide.back": { short: "P2-1-A1", label: "返回主面板" },
  "dashboard-empty.header.lang-toggle": { short: "P2-1-B2", label: "空态语言切换" },
  "accounts.header": { short: "P3-1", label: "账户页头部" },
  "accounts.header.back": { short: "P3-1-A1", label: "回到主面板" },
  "accounts.header.sync-all": { short: "P3-1-B1", label: "同步全部余额" },
  "accounts.summary": { short: "P3-2", label: "账户概览" },
  "accounts.summary.topup": { short: "P3-2-C1", label: "累计充值" },
  "accounts.summary.balance": { short: "P3-2-C2", label: "当前余额" },
  "accounts.list": { short: "P3-3", label: "供应商账户列表" },
  "accounts.list.table": { short: "P3-3-T1", label: "账户明细表" },
  "accounts.list.grant": { short: "P3-3-B1", label: "授权" },
  "accounts.list.manual": { short: "P3-3-B2", label: "手动填写余额" },
  "accounts.empty": { short: "P3-4", label: "账户页空态" },
  "accounts.empty.steps": { short: "P3-4-T1", label: "空态与取数顺序说明" },
  "settings.header": { short: "P4-1", label: "体检页头部" },
  "settings.header.back": { short: "P4-1-A1", label: "体检页返回主面板" },
  "settings.header.reload": { short: "P4-1-B1", label: "重新读取" },
  "settings.config": { short: "P4-2", label: "配置文件" },
  "settings.config.details": { short: "P4-2-T1", label: "配置明细" },
  "settings.config.path": { short: "P4-2-T2", label: "生效路径" },
  "settings.vendors": { short: "P4-3", label: "供应商体检" },
  "settings.vendors.table": { short: "P4-3-T1", label: "供应商体检表" },
  "settings.global": { short: "P4-4", label: "全局与存储" },
  "settings.global.list": { short: "P4-4-L1", label: "全局项列表" },
  "settings.error": { short: "P4-5", label: "解析失败与只读边界" },
  "settings.error.card": { short: "P4-5-T1", label: "解析失败卡" },
  "settings.error.scope": { short: "P4-5-L1", label: "只读边界说明" },
};
