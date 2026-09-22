/**
 * xpi-kuma 公共类型定义。
 *
 * 字段命名约定：TypeScript 侧使用 camelCase；SQLite 列使用 snake_case，
 * 映射在 `src/storage/database.ts` 中通过显式 SELECT 别名完成。
 */

/** 使用量记录来源标记。MVP 仅采集真实调用，不写入估算值。 */
export type UsageSource = "real_usage";

/** 单次调用的结果状态，对齐 Pi 的 `StopReason` 全集；事件不可得时不写入（NULL）。 */
export type CallResultStatus =
  | "aborted"
  | "deferred"
  | "error"
  | "length"
  | "pending"
  | "stop"
  | "toolUse";

/** 一次 LLM 调用的真实使用量（来自 Pi 的 `message_end` 事件）。 */
export interface UsageRecord {
  /** 完成时刻（毫秒，来自 message_end 到达观测）；不可得时缺省 → 列为 NULL */
  completedAt?: number;
  costCacheRead: number;
  costCacheWrite: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  /** 调用所属项目路径；宿主未提供时为空串，归因查询把它归入「未知」 */
  cwd: string;
  /** 首个响应 token 时刻（毫秒，首个 message_update 到达观测）；无流事件时缺省 */
  firstTokenAt?: number;
  model: string;
  provider: string;
  /** 结果状态（message_end.message.stopReason）；不可得时缺省 */
  resultStatus?: CallResultStatus;
  /** 调用所属会话标识；宿主未提供时为空串，归因查询把它归入「未知」 */
  sessionId: string;
  source: UsageSource;
  /** 请求开始时刻（毫秒，before_provider_request 到达观测）；不可得时缺省 */
  startedAt?: number;
  /** 毫秒时间戳 */
  timestamp: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensInput: number;
  tokensOutput: number;
  /** 该次调用发起的工具调用（toolCall）条数 */
  toolCalls: number;
}

/** 供应商可用性状态。`unknown` 表示尚未探测过。 */
export type ProbeStatus = "up" | "down" | "degraded" | "unknown";

/** 一次主动探测的结果。 */
export interface ProbeResult {
  /** 失败原因，成功时为 null */
  error: string | null;
  model: string;
  status: ProbeStatus;
  /** 毫秒时间戳 */
  timestamp: number;
  tokensInput: number;
  tokensOutput: number;
  /** 总响应时间（毫秒）；失败时为 null */
  totalTime: number | null;
  /** 首字延迟（Time To First Token，毫秒）；失败时为 null */
  ttft: number | null;
  vendor: string;
}

/** 聚合统计的时间范围。 */
export type StatsPeriod = "1h" | "24h" | "7d" | "30d";

/** 每个 `provider × model` 组合在指定时间范围内的聚合结果。 */
export interface AggregatedStats {
  /** 可计算的缓存命中率 = cacheRead / (input + cacheRead)；分母为 0 时为 null（未知） */
  cacheHitRate?: number | null;
  costCacheRead: number;
  costCacheWrite: number;
  costInput: number;
  costOutput: number;
  /** 单请求成本 = costTotal / requestCount；请求数为 0 时为 null（3.1 聚合填充） */
  costPerRequest?: number | null;
  /** 费用占比 0..1，按同时间范围总花费计算；总花费为 0 时为 null（3.1 聚合填充） */
  costShare?: number | null;
  costTotal: number;
  model: string;
  period: StatsPeriod;
  provider: string;
  requestCount: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensInput: number;
  tokensOutput: number;
  /** 该分组的工具调用条数之和 */
  toolCalls: number;
  /** 四类 token 之和 */
  totalTokens: number;
}

/**
 * 归因维度：按项目（cwd）/ 会话 / 供应商·模型聚合花费与用量。
 *
 * 对应的分组键分别是 `cwd`、`session_id`、`provider · model`。
 */
export type AttributionDimension = "project" | "session" | "vendorModel";

/** 归因结果的一行：某个维度取值在指定时间范围内的聚合。 */
export interface AttributionRow {
  /** 可计算的缓存命中率；分母为 0 时为 null（3.1 聚合填充） */
  cacheHitRate?: number | null;
  /** 单请求成本 = costTotal / requestCount；请求数为 0 时为 null（3.1 聚合填充） */
  costPerRequest?: number | null;
  /** 费用占比 0..1；总花费为 0 时为 null（3.1 聚合填充） */
  costShare?: number | null;
  /** 花费合计 */
  costTotal: number;
  /**
   * 维度取值。空串表示宿主未提供该维度的信息（存量记录没有项目与会话），
   * 界面据此显示「未知」，不丢弃也不并入其他分组。
   */
  key: string;
  /** 请求次数 */
  requestCount: number;
  /** 四类 token 之和 */
  tokens: number;
}

/** 效率聚合的最低样本门槛：低于该值的组合不进效率排行与最佳建议（design 决策 3，第一版不配置化）。 */
export const MIN_EFFICIENCY_SAMPLES = 10;

/**
 * 某 provider/model 的真实调用效率聚合。
 * 时间点来自 Pi 事件链直接观测（见 src/pi-event-timing.test.ts 的 2.1 结论）；
 * 返回的排行数组由聚合查询限长（有界），样本不足时 `sufficient` 为 false。
 */
export interface EfficiencyRow {
  model: string;
  /** 总耗时 p50（毫秒）；无合格样本时为 null，不以 0 顶替 */
  p50TotalMs: number | null;
  /** 首字延迟 p50（毫秒）；同上 */
  p50TtftMs: number | null;
  /** 总耗时 p95（毫秒）；同上 */
  p95TotalMs: number | null;
  /** 首字延迟 p95（毫秒）；同上 */
  p95TtftMs: number | null;
  provider: string;
  /** 带完整真实时间点的样本数 */
  sampleSize: number;
  /** 成功样本 / 该组合请求总数；分母为 0 时为 null */
  successRate: number | null;
  /** 是否达到 MIN_EFFICIENCY_SAMPLES；false 时界面显示「样本不足」 */
  sufficient: boolean;
}

/** 解释型建议（只读）：输出对象、依据、样本数、时间范围与置信度（spec usage-overview-insights）。 */
export interface Insight {
  confidence: InsightConfidence;
  dimension: InsightKind;
  /** 比较依据，例如「单请求成本 ¥0.126 vs ¥0.187」 */
  evidence: string;
  /** 时间范围（口径与总览/统计一致） */
  period: StatsPeriod;
  /** 参与比较的样本数 */
  sampleSize: number;
  /** 结论文案；只述成本/延迟/缓存，不作无依据的综合最佳表述 */
  statement: string;
  /** 建议对象，例如 provider/model 组合或项目 */
  target: string;
}

export type InsightConfidence = "high" | "low" | "medium";

export type InsightKind = "cache" | "cost" | "efficiency";

/** 缓存分析摘要；分母为零时 hitRate 为 null，界面显示「未知」而非 0%。 */
export interface CacheStats {
  cacheReadTokens: number;
  /** cacheRead / (input + cacheRead)；分母为 0 时为 null */
  hitRate: number | null;
  inputTokens: number;
}

/** 余额数值的来源；三档降级里各自对应一档。 */
export type BalanceSource = "api" | "manual" | "oauth";

/**
 * 一个供应商的余额快照。
 *
 * `null` 一律表示「不知道」而不是 0：取不到值时界面显示「未知」，绝不拿 0 顶替。
 * `stale` 标记数值来自上一次成功获取（如授权已过期）而不是本次同步。
 */
export interface AccountBalance {
  /** 当前余额；未知时为 null */
  balance: number | null;
  /** 计费币种，缺省 `CNY` */
  currency: string;
  /** 最近一次同步的失败原因（已脱敏）；成功时为 null */
  error: string | null;
  /** 数值来源；未知时为 null */
  source: BalanceSource | null;
  /** 数值是上一次成功获取的旧值 */
  stale: boolean;
  /** 最近一次同步时间（毫秒时间戳）；从未同步过为 null */
  syncedAt: number | null;
  /** 累计充值；未知时为 null */
  topup: number | null;
  vendor: string;
}

/** 供应商价格，单位与费用统计一致，标注基准为每千 tokens。 */
export interface VendorPrice {
  /** 每千输入 token 价格 */
  input: number;
  /** 每千输出 token 价格 */
  output: number;
}

/**
 * 供应商余额取数配置；三段全部可选。
 *
 * 段缺失即视为「未配置」，不做任何猜测性请求 —— 服务商余额接口的路径必须由用户
 * 明确声明（探测结论见 `docs/probe-balance-and-oauth.md`）。
 */
export interface VendorBalanceConfig {
  /** 余额接口路径，相对 `endpoint`；以 `http` 开头时按绝对地址请求 */
  apiPath?: string;
  /** 手动填写的当前余额 */
  manual?: number;
  /** 累计充值 */
  topup?: number;
}

/**
 * 供应商 OAuth 授权配置。
 *
 * 四项齐全才算配置完整；缺项视为未配置授权，不发起授权流程。
 */
export interface VendorOAuthConfig {
  authorizeUrl: string;
  clientId: string;
  scopes: string[];
  tokenUrl: string;
}

/** 单个供应商的探测调度配置。 */
export interface VendorProbeConfig {
  enabled: boolean;
  /** 间隔，支持 `"5m"` / `"10m"` / `"1h"` / `"5h"` 形式 */
  interval: string;
  /** 单次探测超时，毫秒 */
  timeout: number;
}

/** 一个被监控的供应商。 */
export interface VendorConfig {
  /** 支持 `${ENV_VAR}` 占位符，解析后仅存在于内存 */
  apiKey?: string;
  /** 余额取数配置（可选） */
  balance?: VendorBalanceConfig;
  /** OpenAI-compatible base URL，例如 `https://api.openai.com/v1` */
  endpoint: string;
  model: string;
  name: string;
  /** OAuth 授权配置（可选） */
  oauth?: VendorOAuthConfig;
  price?: VendorPrice;
  probe: VendorProbeConfig;
}

/** 数据保留策略。 */
export interface RetentionConfig {
  /** 原始使用量记录保留天数 */
  rawRecords: number;
}

/** 面板服务配置。 */
export interface DashboardConfig {
  /** 监听端口；被占用时回退系统随机端口 */
  port: number;
}

/** 全局配置 `~/.pi/agent/data/xpi-kuma/config.yaml` 的解析结果。 */
export interface KumaConfig {
  dashboard: DashboardConfig;
  retention: RetentionConfig;
  vendors: VendorConfig[];
}

/** `getVendorStatus()` 返回的单个供应商当前状态。 */
export interface VendorStatus {
  /** 最近一次探测时间（毫秒时间戳），从未探测时为 null */
  lastProbeTime: number | null;
  model: string;
  name: string;
  price: VendorPrice | null;
  status: ProbeStatus;
  totalTime: number | null;
  ttft: number | null;
}
