import type { Database, TrendSeries } from "../storage/database.ts";
import type {
  AggregatedStats,
  AttributionDimension,
  AttributionRow,
  SessionTotals,
  StatsPeriod,
  UsageRecord,
} from "../types.ts";

/**
 * 使用量收集器：把 Pi 的 `message_end` 事件转换成数据库写入，
 * 并维护当前会话的内存累加器（供 footer 状态栏使用）。
 *
 * 累加器生命周期与会话一致：新建实例即清零，不读取历史会话数据。
 */
export class UsageCollector {
  private readonly database: Database;
  private sessionTotals: SessionTotals = {
    totalCost: 0,
    totalTokens: 0,
  };

  constructor(database: Database) {
    this.database = database;
  }

  /**
   * 记录一次真实调用：写入数据库并累加到当前会话统计。
   *
   * 累加放在这里而不是 `turn_end`，避免一个 turn 内多条 assistant 消息被重复计数。
   */
  record(data: UsageRecord): number {
    const id = this.database.insertUsageRecord(data);
    this.sessionTotals = {
      totalCost: this.sessionTotals.totalCost + data.costTotal,
      totalTokens:
        this.sessionTotals.totalTokens +
        data.tokensInput +
        data.tokensOutput +
        data.tokensCacheRead +
        data.tokensCacheWrite,
    };
    return id;
  }

  /** 按时间范围查询聚合统计。 */
  getStats(period: StatsPeriod): AggregatedStats[] {
    return this.database.getUsageStats(period);
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

  /** 当前会话的内存累加值；初始为 0。 */
  getCurrentSessionStats(): SessionTotals {
    return {
      ...this.sessionTotals,
    };
  }

  /** 重置会话累加器（新建/切换会话时调用）。 */
  resetSession(): void {
    this.sessionTotals = {
      totalCost: 0,
      totalTokens: 0,
    };
  }
}
