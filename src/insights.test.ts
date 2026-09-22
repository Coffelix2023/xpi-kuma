import { describe, expect, it } from "vitest";
import { buildInsights, type InsightInput } from "./insights.ts";
import type { AggregatedStats, EfficiencyRow, StatsPeriod } from "./types.ts";

function statsRow(overrides: Partial<AggregatedStats> = {}): AggregatedStats {
  return {
    cacheHitRate: null,
    costCacheRead: 0,
    costCacheWrite: 0,
    costInput: 0,
    costOutput: 0,
    costPerRequest: 0.1,
    costShare: 0.5,
    costTotal: 1,
    model: "gpt-4",
    period: "24h",
    provider: "openai",
    requestCount: 10,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensInput: 0,
    tokensOutput: 0,
    toolCalls: 0,
    totalTokens: 0,
    ...overrides,
  };
}

function efficiencyRow(overrides: Partial<EfficiencyRow> = {}): EfficiencyRow {
  return {
    model: "gpt-4",
    p50TotalMs: 1000,
    p50TtftMs: 100,
    p95TotalMs: 2000,
    p95TtftMs: 200,
    provider: "openai",
    sampleSize: 10,
    successRate: 1,
    sufficient: true,
    ...overrides,
  };
}

/** 统一构造输入：调用处不再写对象字面量，键顺序与嵌套深度都固定。 */
function insightInput(
  stats: AggregatedStats[],
  efficiency: EfficiencyRow[] = [],
  period: StatsPeriod = "24h",
): InsightInput {
  return {
    efficiency,
    period,
    stats,
  };
}

describe("buildInsights", () => {
  it("成本差异达到幅度时给出最低成本建议", () => {
    const cheap = statsRow({
      costPerRequest: 0.1,
    });
    const pricey = statsRow({
      costPerRequest: 0.2,
      model: "claude",
      provider: "anthropic",
    });
    const input = insightInput([
      cheap,
      pricey,
    ]);
    const insights = buildInsights(input);

    const cost = insights.find((row) => row.dimension === "cost");
    expect(cost).toMatchObject({
      confidence: "low",
      period: "24h",
      sampleSize: 20,
      target: "openai · gpt-4",
    });
    expect(cost?.evidence).toBe("单请求成本 ¥0.1 vs ¥0.2");
    expect(cost?.statement).toContain("openai · gpt-4");
  });

  it("样本不足或差异不明显时不作成本建议", () => {
    const small = statsRow({
      costPerRequest: 0.1,
      requestCount: 9,
    });
    const other = statsRow({
      costPerRequest: 0.2,
      model: "claude",
      provider: "anthropic",
    });
    const thinInput = insightInput([
      small,
      other,
    ]);
    const insufficient = buildInsights(thinInput);
    expect(insufficient.some((row) => row.dimension === "cost")).toBe(false);

    const closeCheap = statsRow({
      costPerRequest: 0.1,
    });
    const closeOther = statsRow({
      costPerRequest: 0.105,
      model: "claude",
      provider: "anthropic",
    });
    const closeInput = insightInput([
      closeCheap,
      closeOther,
    ]);
    const close = buildInsights(closeInput);
    expect(close.some((row) => row.dimension === "cost")).toBe(false);
  });

  it("效率建议只用达到样本门槛的组合", () => {
    const thin = efficiencyRow({
      p50TotalMs: 500,
      sampleSize: 9,
      sufficient: false,
    });
    const thick = efficiencyRow({
      model: "claude",
      p50TotalMs: 5000,
      provider: "anthropic",
    });
    const thinInput = insightInput(
      [],
      [
        thin,
        thick,
      ],
    );
    const withInsufficient = buildInsights(thinInput);
    expect(withInsufficient.some((row) => row.dimension === "efficiency")).toBe(false);

    const fast = efficiencyRow({
      p50TotalMs: 1000,
    });
    const slow = efficiencyRow({
      model: "claude",
      p50TotalMs: 5000,
      provider: "anthropic",
    });
    const input = insightInput(
      [],
      [
        fast,
        slow,
      ],
      "7d",
    );
    const insights = buildInsights(input);
    const efficiency = insights.find((row) => row.dimension === "efficiency");
    expect(efficiency).toMatchObject({
      period: "7d",
      sampleSize: 20,
      target: "openai · gpt-4",
    });
    expect(efficiency?.evidence).toBe("p50 总耗时 1.0s vs 5.0s");
  });

  it("缓存建议指向命中率最高的组合，差值不足时不给", () => {
    const cold = statsRow({
      cacheHitRate: 0.2,
    });
    const warm = statsRow({
      cacheHitRate: 0.8,
      model: "claude",
      provider: "anthropic",
    });
    const input = insightInput([
      cold,
      warm,
    ]);
    const insights = buildInsights(input);
    const cache = insights.find((row) => row.dimension === "cache");
    expect(cache?.target).toBe("anthropic · claude");
    expect(cache?.evidence).toBe("缓存命中率 80.0% vs 20.0%");

    const nearCold = statsRow({
      cacheHitRate: 0.5,
    });
    const nearWarm = statsRow({
      cacheHitRate: 0.55,
      model: "claude",
      provider: "anthropic",
    });
    const closeInput = insightInput([
      nearCold,
      nearWarm,
    ]);
    const close = buildInsights(closeInput);
    expect(close.some((row) => row.dimension === "cache")).toBe(false);
  });

  it("置信度随样本数分档，且建议总数有界", () => {
    const cheap = statsRow({
      cacheHitRate: 0.1,
      costPerRequest: 0.1,
      requestCount: 60,
    });
    const pricey = statsRow({
      cacheHitRate: 0.9,
      costPerRequest: 0.3,
      model: "claude",
      provider: "anthropic",
      requestCount: 60,
    });
    const fast = efficiencyRow({
      p50TotalMs: 1000,
    });
    const slow = efficiencyRow({
      model: "claude",
      p50TotalMs: 5000,
      provider: "anthropic",
      sampleSize: 100,
    });
    const input = insightInput(
      [
        cheap,
        pricey,
      ],
      [
        fast,
        slow,
      ],
      "30d",
    );
    const many = buildInsights(input);
    expect(many).toHaveLength(3);
    expect(many.every((row) => row.confidence === "high")).toBe(true);

    const lowCost = statsRow({
      costPerRequest: 0.1,
      requestCount: 20,
    });
    const highCost = statsRow({
      costPerRequest: 0.3,
      model: "claude",
      provider: "anthropic",
      requestCount: 20,
    });
    const mediumInput = insightInput([
      lowCost,
      highCost,
    ]);
    const medium = buildInsights(mediumInput);
    expect(medium[0]?.confidence).toBe("medium");
  });

  it("空输入返回空数组", () => {
    const input = insightInput([]);
    expect(buildInsights(input)).toEqual([]);
  });
});
