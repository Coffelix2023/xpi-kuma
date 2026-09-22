import { buildInsights, type InsightInput } from "../insights.ts";
import type { Database, TrendSeries } from "../storage/database.ts";
import type {
  AggregatedStats,
  AttributionDimension,
  AttributionRow,
  EfficiencyRow,
  Insight,
  StatsPeriod,
  UsageRecord,
} from "../types.ts";

/**
 * 使用量收集器：把 Pi 的 `message_end` 事件转换成数据库写入，
 * 并对外提供面板需要的统计查询。
 */
export class UsageCollector {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** 记录一次真实调用：写入数据库，返回记录 id。 */
  record(data: UsageRecord): number {
    return this.database.insertUsageRecord(data);
  }

  /** 按时间范围查询聚合统计。 */
  getStats(period: StatsPeriod): AggregatedStats[] {
    return this.database.getUsageStats(period);
  }

  /** 真实调用效率排行（provider × model，含样本门槛标记）。 */
  getEfficiency(period: StatsPeriod): EfficiencyRow[] {
    return this.database.getEfficiency(period);
  }

  /** 基于已聚合的统计与效率生成只读洞察；失败由调用方降级，不影响基础统计。 */
  getInsights(input: InsightInput): Insight[] {
    return buildInsights(input);
  }

  /** 趋势数据，供面板折线图使用。 */
  getTrend(period: StatsPeriod): TrendSeries[] {
    return this.database.getTrend(period);
  }

  /** 按项目 / 会话 / 供应商·模型聚合的归因数据。 */
  getAttribution(
    period: StatsPeriod,
    dimension: AttributionDimension,
  ): AttributionRow[] {
    return this.database.getAttribution(period, dimension);
  }
}
