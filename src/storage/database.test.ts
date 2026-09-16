import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProbeResult, UsageRecord } from "../types.ts";
import { Database } from "./database.ts";

const DAY = 24 * 60 * 60 * 1000;

function usageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    costCacheRead: 0,
    costCacheWrite: 0,
    costInput: 0.001,
    costOutput: 0.002,
    costTotal: 0.003,
    model: "gpt-4",
    provider: "openai",
    source: "real_usage",
    timestamp: Date.now(),
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensInput: 100,
    tokensOutput: 50,
    ...overrides,
  };
}

function probeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    error: null,
    model: "gpt-4o-mini",
    status: "up",
    timestamp: Date.now(),
    tokensInput: 1,
    tokensOutput: 1,
    totalTime: 450,
    ttft: 230,
    vendor: "OpenAI",
    ...overrides,
  };
}

/** 跨时间范围统计全部记录，用于断言清理前后的行数。 */
function totalRequests(db: Database): number {
  return db.getUsageStats("30d").reduce((sum, stats) => sum + stats.requestCount, 0);
}

const cleanups: (() => void)[] = [];

function openTempDatabase(): Database {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-test-"));
  const db = new Database({
    dbPath: join(dir, "usage.db"),
  });
  cleanups.push(() => {
    db.close();
    rmSync(dir, {
      force: true,
      recursive: true,
    });
  });
  return db;
}

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("Database 初始化", () => {
  it("创建 usage_records 与 probe_records 两张表且查询为空", () => {
    const db = openTempDatabase();
    // 两条查询分别命中两张表；表缺失时 prepare 会抛错
    expect(db.getUsageStats("24h")).toEqual([]);
    expect(db.getProbeHistory("OpenAI", 10)).toEqual([]);
  });

  it("重复打开同一文件不破坏已有数据", () => {
    const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-reopen-"));
    const dbPath = join(dir, "usage.db");
    const first = new Database({
      dbPath,
    });
    first.insertUsageRecord(usageRecord());
    first.close();

    const second = new Database({
      dbPath,
    });
    cleanups.push(() => {
      second.close();
      rmSync(dir, {
        force: true,
        recursive: true,
      });
    });
    expect(totalRequests(second)).toBe(1);
  });
});

describe("insertUsageRecord", () => {
  it("插入后可查询到该记录", () => {
    const db = openTempDatabase();
    const timestamp = Date.now();
    const id = db.insertUsageRecord(
      usageRecord({
        timestamp,
        costTotal: 0.005,
        tokensInput: 100,
        tokensOutput: 50,
      }),
    );

    expect(id).toBeGreaterThan(0);
    const stats = db.getUsageStats("24h", timestamp);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      costTotal: 0.005,
      model: "gpt-4",
      provider: "openai",
      requestCount: 1,
      tokensInput: 100,
      tokensOutput: 50,
    });
  });
});

describe("insertProbeRecord", () => {
  it("插入成功并保留 null 指标", () => {
    const db = openTempDatabase();
    db.insertProbeRecord(probeResult());
    db.insertProbeRecord(
      probeResult({
        error: "timeout",
        status: "down",
        totalTime: null,
        ttft: null,
      }),
    );

    const history = db.getProbeHistory("OpenAI", 10);
    expect(history).toHaveLength(2);
    expect(history.some((r) => r.status === "up" && r.ttft === 230)).toBe(true);
    expect(history.some((r) => r.status === "down" && r.ttft === null)).toBe(true);
  });
});

describe("getUsageStats", () => {
  it("聚合 3 条记录得到正确的 totalTokens 与 requestCount", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.001,
        timestamp: now - 1000,
        tokensInput: 100,
        tokensOutput: 50,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.002,
        timestamp: now - 2000,
        tokensInput: 200,
        tokensOutput: 100,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.003,
        timestamp: now - 3000,
        tokensInput: 150,
        tokensOutput: 75,
      }),
    );

    const stats = db.getUsageStats("24h", now);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      model: "gpt-4",
      period: "24h",
      provider: "openai",
      requestCount: 3,
      totalTokens: 675,
    });
    expect(stats[0].costTotal).toBeCloseTo(0.006, 10);
  });

  it("按 provider × model 分组，并排除范围外记录", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertUsageRecord(
      usageRecord({
        timestamp: now - 1000,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        model: "claude-3",
        provider: "anthropic",
        timestamp: now - 2000,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        timestamp: now - 3 * DAY,
      }),
    );

    const stats = db.getUsageStats("24h", now);
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.provider).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("无数据时返回空数组", () => {
    const db = openTempDatabase();
    expect(db.getUsageStats("1h")).toEqual([]);
  });
});

describe("getProbeHistory", () => {
  it("按时间倒序返回并遵循 limit", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertProbeRecord(
      probeResult({
        timestamp: now - 3000,
        ttft: 300,
      }),
    );
    db.insertProbeRecord(
      probeResult({
        timestamp: now - 1000,
        ttft: 100,
      }),
    );
    db.insertProbeRecord(
      probeResult({
        timestamp: now - 2000,
        ttft: 200,
      }),
    );
    db.insertProbeRecord(
      probeResult({
        timestamp: now,
        vendor: "Anthropic",
      }),
    );

    const history = db.getProbeHistory("OpenAI", 2);
    expect(history.map((r) => r.ttft)).toEqual([
      100,
      200,
    ]);
  });
});

describe("cleanOldRecords", () => {
  it("删除超过保留期的记录，保留范围内的记录", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertUsageRecord(
      usageRecord({
        timestamp: now - 8 * DAY,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        timestamp: now - 6 * DAY,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        timestamp: now,
      }),
    );

    const deleted = db.cleanOldRecords(7, now);

    expect(deleted).toBe(1);
    expect(totalRequests(db)).toBe(2);
  });

  it("保留期可配置为 30 天", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertUsageRecord(
      usageRecord({
        timestamp: now - 10 * DAY,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        timestamp: now - 40 * DAY,
      }),
    );

    expect(db.cleanOldRecords(30, now)).toBe(1);
    expect(totalRequests(db)).toBe(1);
  });
});
