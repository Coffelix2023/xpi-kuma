import { describe, expect, it } from "vitest";
import { Database } from "../storage/database.ts";
import type { UsageRecord } from "../types.ts";
import { backfillUsage } from "./backfill.ts";
import type { SessionLogUsage } from "./session-log-scanner.ts";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function logUsage(overrides: Partial<SessionLogUsage> = {}): SessionLogUsage {
  return {
    costCacheRead: 0,
    costCacheWrite: 0,
    costInput: 0.001,
    costOutput: 0.002,
    costTotal: 0.003,
    cwd: "/proj",
    entryId: "entr0001",
    messageAt: NOW - DAY,
    model: "gpt-4",
    provider: "openai",
    reconcileFingerprint: undefined,
    resultStatus: "stop",
    sessionFile: "/sessions/p/s.jsonl",
    sessionId: "sess-1",
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensInput: 100,
    tokensOutput: 50,
    toolCalls: 0,
    ...overrides,
  };
}

function realtimeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    completedAt: NOW - DAY + 1_000,
    costCacheRead: 0,
    costCacheWrite: 0,
    costInput: 0.001,
    costOutput: 0.002,
    costTotal: 0.003,
    cwd: "/proj",
    firstTokenAt: undefined,
    model: "gpt-4",
    provider: "openai",
    resultStatus: "stop",
    sessionId: "sess-1",
    source: "real_usage",
    startedAt: undefined,
    timestamp: NOW - DAY + 1_000,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensInput: 100,
    tokensOutput: 50,
    toolCalls: 0,
    ...overrides,
  };
}

function rowCount(db: Database): number {
  return db.getUsageStats("30d").reduce((sum, stats) => sum + stats.requestCount, 0);
}

describe("backfillUsage", () => {
  it("重复扫描只入账一次：第二轮全部跳过", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    const records = [
      logUsage({
        entryId: "dupa0001",
      }),
      logUsage({
        entryId: "dupa0002",
        messageAt: NOW - DAY - 5_000,
      }),
    ];

    const first = backfillUsage(db, records);
    expect(first.inserted).toBe(2);
    expect(rowCount(db)).toBe(2);

    const second = backfillUsage(db, records);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.diagnostics).toEqual([]);
    expect(rowCount(db)).toBe(2);
  });

  it("实时与日志重叠：认领既有实时行，不新增统计", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    const record = realtimeRecord({
      messageAt: NOW - DAY,
      reconcileFingerprint: "fp-overlap-1",
    });
    db.insertUsageRecord(record);
    const before = rowCount(db);

    const report = backfillUsage(db, [
      logUsage({
        entryId: "over0001",
        messageAt: NOW - DAY,
        reconcileFingerprint: "fp-overlap-1",
      }),
    ]);

    expect(report.reconciled).toBe(1);
    expect(report.inserted).toBe(0);
    expect(rowCount(db)).toBe(before);
  });

  it("旧库无指纹：字段全等且完成时间在窗口内 → 保守认领，不新增行", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    // 旧行：没有 messageAt / 指纹 / 来源条目 id（1.3 之前的实时行）
    db.insertUsageRecord(
      realtimeRecord({
        completedAt: NOW - DAY + 60_000,
        messageAt: undefined,
      }),
    );
    const before = rowCount(db);

    const report = backfillUsage(db, [
      logUsage({
        entryId: "lega0001",
        messageAt: NOW - DAY,
      }),
    ]);

    expect(report.reconciled).toBe(1);
    expect(rowCount(db)).toBe(before);
    // 认领后该条目具备幂等键：重扫不再判定
    expect(
      backfillUsage(db, [
        logUsage({
          entryId: "lega0001",
          messageAt: NOW - DAY,
        }),
      ]).skipped,
    ).toBe(1);
  });

  it("旧行窗口外：不认领旧行，也不误判为未核实 —— 日志条目作为新记录补入", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    db.insertUsageRecord(
      realtimeRecord({
        completedAt: NOW - DAY + 60 * 60 * 1000,
        messageAt: undefined,
      }),
    );
    const before = rowCount(db);

    const report = backfillUsage(db, [
      logUsage({
        entryId: "outw0001",
      }),
    ]);

    expect(report.inserted).toBe(1);
    expect(rowCount(db)).toBe(before + 1);
  });

  it("指纹碰撞：多条实时行同指纹 → 不判定、不插入、报未核实", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    db.insertUsageRecord(
      realtimeRecord({
        messageAt: NOW - DAY,
        reconcileFingerprint: "fp-collide",
      }),
    );
    db.insertUsageRecord(
      realtimeRecord({
        messageAt: NOW - DAY,
        reconcileFingerprint: "fp-collide",
        timestamp: NOW - DAY + 2_000,
      }),
    );
    const before = rowCount(db);

    const report = backfillUsage(db, [
      logUsage({
        entryId: "coll0001",
        reconcileFingerprint: "fp-collide",
      }),
    ]);

    expect(report.inserted).toBe(0);
    expect(report.reconciled).toBe(0);
    expect(report.diagnostics).toEqual([
      {
        entryId: "coll0001",
        reason: "fingerprint-collision",
        sessionFile: "/sessions/p/s.jsonl",
      },
    ]);
    expect(rowCount(db)).toBe(before);
  });

  it("同一指纹的另一条日志已入账：后来者跳过并报碰撞，不双计", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    const first = backfillUsage(db, [
      logUsage({
        entryId: "collA000",
        reconcileFingerprint: "fp-same",
      }),
    ]);
    expect(first.inserted).toBe(1);

    const second = backfillUsage(db, [
      logUsage({
        entryId: "collB000",
        reconcileFingerprint: "fp-same",
      }),
    ]);
    expect(second.inserted).toBe(0);
    expect(second.diagnostics.map((d) => d.reason)).toEqual([
      "fingerprint-collision",
    ]);
    expect(rowCount(db)).toBe(1);
  });

  it("两批并发的同一日志：先到者入账，后到者按幂等键跳过", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    const records = [
      logUsage({
        entryId: "conc0001",
      }),
    ];
    // 模拟另一入口抢先入账了同一条目
    db.insertUsageRecord(
      realtimeRecord({
        sessionId: "sess-1",
        sourceEntryId: "conc0001",
      }),
    );
    const before = rowCount(db);

    const report = backfillUsage(db, records);

    expect(report.inserted).toBe(0);
    expect(report.skipped).toBe(1);
    expect(rowCount(db)).toBe(before);
  });

  it("缺会话/条目 id 的条目不插入，报 missing-fields 未核实", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    const report = backfillUsage(db, [
      logUsage({
        sessionId: "",
      }),
    ]);

    expect(report.inserted).toBe(0);
    expect(report.diagnostics.map((d) => d.reason)).toEqual([
      "missing-fields",
    ]);
    expect(rowCount(db)).toBe(0);
  });

  it("补录行不推断延迟：started/first_token/completed 保持 NULL", () => {
    const db = new Database({
      dbPath: ":memory:",
    });
    backfillUsage(db, [
      logUsage({
        entryId: "latn0001",
      }),
    ]);

    const rows = db.getEfficiency("24h");
    // 没有时间点的行不进效率样本；也不存在把未知当 0 的统计
    expect(rows).toEqual([]);
    expect(rowCount(db)).toBe(1);
  });
});
