import {
  type AggregatedStats,
  type EfficiencyRow,
  type Insight,
  type InsightConfidence,
  MIN_EFFICIENCY_SAMPLES,
  type StatsPeriod,
} from "./types.ts";

/**
 * 只读洞察生成（spec usage-overview-insights）。
 *
 * 输入是已经聚合好的统计与效率排行，输出「对象 + 依据 + 样本数 + 时间范围 + 置信度」。
 * 这里不读数据库、不写配置、不切模型；调用方（面板 API）负责在失败时降级，
 * 基础统计不受影响。
 *
 * 每个维度最多一条建议（总数 ≤ 3），保证响应有界。
 */

/** 成本建议的最小比较幅度：最便宜与次便宜的差异需达到 10%。 */
const COST_MIN_DELTA = 0.1;
/** 效率建议的最小比较幅度：p50 总耗时差异需达到 10%。 */
const EFFICIENCY_MIN_DELTA = 0.1;
/** 缓存建议的最小比较幅度：命中率相差 10 个百分点以上。 */
const CACHE_MIN_DELTA = 0.1;
/** 置信度分档：参与比较的样本数达到该档位即升级。 */
const CONFIDENCE_HIGH_SAMPLES = 100;
const CONFIDENCE_MEDIUM_SAMPLES = 30;

export interface InsightInput {
  /** 真实调用效率排行；暂无可靠时间点时为 [] */
  efficiency: EfficiencyRow[];
  /** 与总览 / 统计同源的时间范围 */
  period: StatsPeriod;
  /** 与总览 / 统计同源的聚合结果 */
  stats: AggregatedStats[];
}

/** 生成成本、效率、缓存三个维度各至多一条只读建议。 */
export function buildInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];
  const cost = buildCostInsight(input.stats, input.period);
  if (cost !== null) {
    insights.push(cost);
  }
  const efficiency = buildEfficiencyInsight(input.efficiency, input.period);
  if (efficiency !== null) {
    insights.push(efficiency);
  }
  const cache = buildCacheInsight(input.stats, input.period);
  if (cache !== null) {
    insights.push(cache);
  }
  return insights;
}

/** 单请求成本最低的组合；候选不足或差异不明显时不给建议。 */
function buildCostInsight(
  stats: AggregatedStats[],
  period: StatsPeriod,
): Insight | null {
  const candidates = stats
    .filter(
      (row) => row.requestCount >= MIN_EFFICIENCY_SAMPLES && row.costPerRequest != null,
    )
    .sort((a, b) => (a.costPerRequest ?? 0) - (b.costPerRequest ?? 0));
  const best = candidates[0];
  const next = candidates[1];
  if (best === undefined || next === undefined) {
    return null;
  }
  const bestCost = best.costPerRequest ?? 0;
  const nextCost = next.costPerRequest ?? 0;
  if (nextCost <= 0 || (nextCost - bestCost) / nextCost < COST_MIN_DELTA) {
    return null;
  }
  const sampleSize = sum(candidates, (row) => row.requestCount);
  const target = formatTarget(best);
  return {
    confidence: confidenceOf(sampleSize),
    dimension: "cost",
    evidence: `单请求成本 ${formatCost(bestCost)} vs ${formatCost(nextCost)}`,
    period,
    sampleSize,
    statement: `${target} 的单请求成本最低（${formatCost(bestCost)}/请求）`,
    target,
  };
}

/** p50 总响应时间最短且达到样本门槛的组合。 */
function buildEfficiencyInsight(
  efficiency: EfficiencyRow[],
  period: StatsPeriod,
): Insight | null {
  const candidates = efficiency
    .filter((row) => row.sufficient && row.p50TotalMs != null)
    .sort((a, b) => (a.p50TotalMs ?? 0) - (b.p50TotalMs ?? 0));
  const best = candidates[0];
  const next = candidates[1];
  if (best === undefined || next === undefined) {
    return null;
  }
  const bestMs = best.p50TotalMs ?? 0;
  const nextMs = next.p50TotalMs ?? 0;
  if (nextMs <= 0 || (nextMs - bestMs) / nextMs < EFFICIENCY_MIN_DELTA) {
    return null;
  }
  const sampleSize = sum(candidates, (row) => row.sampleSize);
  const target = formatTarget(best);
  return {
    confidence: confidenceOf(sampleSize),
    dimension: "efficiency",
    evidence: `p50 总耗时 ${formatMs(bestMs)} vs ${formatMs(nextMs)}`,
    period,
    sampleSize,
    statement: `${target} 的 p50 总响应时间最短（${formatMs(bestMs)}）`,
    target,
  };
}

/** 缓存命中率最高与最低的对比；差值不够大时不给建议。 */
function buildCacheInsight(
  stats: AggregatedStats[],
  period: StatsPeriod,
): Insight | null {
  const candidates = stats
    .filter(
      (row) => row.requestCount >= MIN_EFFICIENCY_SAMPLES && row.cacheHitRate != null,
    )
    .sort((a, b) => (a.cacheHitRate ?? 0) - (b.cacheHitRate ?? 0));
  const lowest = candidates[0];
  const highest = candidates.at(-1);
  if (lowest === undefined || highest === undefined || lowest === highest) {
    return null;
  }
  const lowestRate = lowest.cacheHitRate ?? 0;
  const highestRate = highest.cacheHitRate ?? 0;
  if (highestRate - lowestRate < CACHE_MIN_DELTA) {
    return null;
  }
  const sampleSize = sum(candidates, (row) => row.requestCount);
  const target = formatTarget(highest);
  return {
    confidence: confidenceOf(sampleSize),
    dimension: "cache",
    evidence: `缓存命中率 ${formatPercent(highestRate)} vs ${formatPercent(lowestRate)}`,
    period,
    sampleSize,
    statement: `${target} 的缓存命中率最高（${formatPercent(highestRate)}）`,
    target,
  };
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function confidenceOf(sampleSize: number): InsightConfidence {
  if (sampleSize >= CONFIDENCE_HIGH_SAMPLES) {
    return "high";
  }
  if (sampleSize >= CONFIDENCE_MEDIUM_SAMPLES) {
    return "medium";
  }
  return "low";
}

/** 费用展示：去掉多余尾零，避免 ¥0.1260 这类噪声。 */
const TRAILING_ZEROS = /0+$/;
const TRAILING_DOT = /\.$/;
function formatCost(value: number): string {
  return `¥${value.toFixed(4).replace(TRAILING_ZEROS, "").replace(TRAILING_DOT, "")}`;
}

function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatTarget(row: { model: string; provider: string }): string {
  return `${row.provider} · ${row.model}`;
}
