/**
 * xpi-kuma 公共类型定义。
 *
 * 字段命名约定：TypeScript 侧使用 camelCase；SQLite 列使用 snake_case，
 * 映射在 `src/storage/database.ts` 中通过显式 SELECT 别名完成。
 */

/** 使用量记录来源标记。MVP 仅采集真实调用，不写入估算值。 */
export type UsageSource = "real_usage";

/** 一次 LLM 调用的真实使用量（来自 Pi 的 `message_end` 事件）。 */
export interface UsageRecord {
  costCacheRead: number;
  costCacheWrite: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  /** 调用所属项目路径；宿主未提供时为空串，归因查询把它归入「未知」 */
  cwd: string;
  model: string;
  provider: string;
  /** 调用所属会话标识；宿主未提供时为空串，归因查询把它归入「未知」 */
  sessionId: string;
  source: UsageSource;
  /** 毫秒时间戳 */
  timestamp: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensInput: number;
  tokensOutput: number;
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
  costCacheRead: number;
  costCacheWrite: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  model: string;
  period: StatsPeriod;
  provider: string;
  requestCount: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensInput: number;
  tokensOutput: number;
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

/** 供应商价格，单位与费用统计一致，标注基准为每千 tokens。 */
export interface VendorPrice {
  /** 每千输入 token 价格 */
  input: number;
  /** 每千输出 token 价格 */
  output: number;
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
  /** OpenAI-compatible base URL，例如 `https://api.openai.com/v1` */
  endpoint: string;
  model: string;
  name: string;
  price?: VendorPrice;
  probe: VendorProbeConfig;
}

/** 数据保留策略。 */
export interface RetentionConfig {
  /** 原始使用量记录保留天数 */
  rawRecords: number;
}

/** `.pi/xpi-kuma/config.yaml` 的解析结果。 */
export interface KumaConfig {
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

/** footer 状态栏展示的当前会话累计值。 */
export interface SessionTotals {
  totalCost: number;
  totalTokens: number;
}
