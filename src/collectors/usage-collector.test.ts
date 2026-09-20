import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../storage/database.ts";
import type { UsageRecord } from "../types.ts";
import { UsageCollector } from "./usage-collector.ts";

function usageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    costCacheRead: 0,
    costCacheWrite: 0,
    costInput: 0.001,
    costOutput: 0.002,
    costTotal: 0.003,
    cwd: "",
    model: "gpt-4",
    provider: "openai",
    sessionId: "",
    source: "real_usage",
    timestamp: Date.now(),
    tokensCacheRead: 10,
    tokensCacheWrite: 5,
    tokensInput: 100,
    tokensOutput: 50,
    ...overrides,
  };
}

const open: Database[] = [];

function setup() {
  const database = new Database({
    dbPath: ":memory:",
  });
  open.push(database);
  return {
    database,
    collector: new UsageCollector(database),
  };
}

afterEach(() => {
  while (open.length > 0) {
    open.pop()?.close();
  }
});

describe("UsageCollector", () => {
  it("构造函数接受 Database 实例", () => {
    const { collector } = setup();
    expect(collector).toBeInstanceOf(UsageCollector);
  });

  it("record() 写入数据库并可被聚合查询读到", () => {
    const { database, collector } = setup();
    const record = usageRecord();
    const id = collector.record(record);

    expect(id).toBeGreaterThan(0);
    const stats = database.getUsageStats("1h");
    expect(stats).toHaveLength(1);
    expect(stats[0].requestCount).toBe(1);
  });

  it("getStats() 返回按 provider × model 聚合的结果", () => {
    const { collector } = setup();
    collector.record(
      usageRecord({
        timestamp: Date.now(),
        tokensInput: 100,
        tokensOutput: 50,
      }),
    );
    collector.record(
      usageRecord({
        timestamp: Date.now(),
        tokensInput: 200,
        tokensOutput: 100,
      }),
    );

    const stats = collector.getStats("24h");
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      model: "gpt-4",
      provider: "openai",
      requestCount: 2,
      totalTokens: 480,
    });
  });

  it("getCurrentSessionStats() 初始值为 0", () => {
    const { collector } = setup();
    expect(collector.getCurrentSessionStats()).toEqual({
      totalCost: 0,
      totalTokens: 0,
    });
  });

  it("getCurrentSessionStats() 随 record() 累加四类 token 与费用", () => {
    const { collector } = setup();
    collector.record(
      usageRecord({
        costTotal: 0.005,
      }),
    );
    collector.record(
      usageRecord({
        costTotal: 0.01,
      }),
    );

    const totals = collector.getCurrentSessionStats();
    expect(totals.totalTokens).toBe(2 * (100 + 50 + 10 + 5));
    expect(totals.totalCost).toBeCloseTo(0.015, 10);
  });

  it("resetSession() 清零累加器但保留数据库记录", () => {
    const { database, collector } = setup();
    collector.record(usageRecord());
    collector.resetSession();

    expect(collector.getCurrentSessionStats()).toEqual({
      totalCost: 0,
      totalTokens: 0,
    });
    expect(database.getUsageStats("1h")[0].requestCount).toBe(1);
  });
});
