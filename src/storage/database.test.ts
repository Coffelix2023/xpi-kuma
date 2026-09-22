import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
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
    cwd: "",
    model: "gpt-4",
    provider: "openai",
    sessionId: "",
    source: "real_usage",
    timestamp: Date.now(),
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensInput: 100,
    tokensOutput: 50,
    toolCalls: 0,
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

/** 读回 usage_records 的列名，用于断言建表与迁移后的 schema。 */
function usageColumns(dbPath: string): string[] {
  const probe = new Sqlite(dbPath, {
    readonly: true,
  });
  const rows = probe.prepare("PRAGMA table_info(usage_records)").all() as {
    name: string;
  }[];
  probe.close();
  return rows.map((row) => row.name);
}

/** 读回单条 usage 行的真实时间点与结果状态，用于 NULL 语义断言。 */
function timingOf(
  dbPath: string,
  id: number,
): {
  completed_at: number | null;
  first_token_at: number | null;
  result_status: string | null;
  started_at: number | null;
} {
  const probe = new Sqlite(dbPath, {
    readonly: true,
  });
  const row = probe
    .prepare(
      "SELECT started_at, first_token_at, completed_at, result_status FROM usage_records WHERE id = ?",
    )
    .get(id) as unknown;
  probe.close();
  return row as {
    completed_at: number | null;
    first_token_at: number | null;
    result_status: string | null;
    started_at: number | null;
  };
}

/** 对任意行集按取值函数求和，用于断言各维度的总量一致。 */
function sumOf<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + pick(row), 0);
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
        toolCalls: 1,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.002,
        timestamp: now - 2000,
        tokensInput: 200,
        tokensOutput: 100,
        toolCalls: 2,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.003,
        timestamp: now - 3000,
        tokensInput: 150,
        tokensOutput: 75,
        toolCalls: 3,
      }),
    );

    const stats = db.getUsageStats("24h", now);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      model: "gpt-4",
      period: "24h",
      provider: "openai",
      requestCount: 3,
      toolCalls: 6,
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

  it("费用占比之和为 1，单请求成本与缓存命中率按同一口径计算", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.1,
        timestamp: now - 1000,
        tokensCacheRead: 25,
        tokensInput: 75,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.3,
        model: "claude",
        provider: "anthropic",
        timestamp: now - 2000,
        tokensCacheRead: 50,
        tokensInput: 50,
      }),
    );

    const stats = db.getUsageStats("24h", now);
    expect(sumOf(stats, (row) => row.costShare ?? 0)).toBeCloseTo(1, 10);

    const openai = stats.find((row) => row.provider === "openai");
    expect(openai?.costShare).toBeCloseTo(0.25, 10);
    expect(openai?.costPerRequest).toBeCloseTo(0.1, 10);
    expect(openai?.cacheHitRate).toBeCloseTo(0.25, 10);

    const anthropic = stats.find((row) => row.provider === "anthropic");
    expect(anthropic?.cacheHitRate).toBeCloseTo(0.5, 10);
  });

  it("分母为零时费用占比与缓存命中率为 null，不用 0 顶替未知", () => {
    const db = openTempDatabase();
    const now = Date.now();
    for (const timestamp of [
      now - 1000,
      now - 2000,
    ]) {
      db.insertUsageRecord(
        usageRecord({
          costInput: 0,
          costOutput: 0,
          costTotal: 0,
          timestamp,
          tokensCacheRead: 0,
          tokensInput: 0,
        }),
      );
    }

    const stats = db.getUsageStats("24h", now);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.costShare).toBeNull();
    expect(stats[0]?.cacheHitRate).toBeNull();
    // 请求数非零，单请求成本仍是可计算的 0（真实值，不是未知）
    expect(stats[0]?.costPerRequest).toBe(0);
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

describe("schema 迁移", () => {
  it("旧库自动补齐 cwd / session_id 列，既有记录保留且幂等", () => {
    const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-migrate-"));
    const dbPath = join(dir, "usage.db");
    cleanups.push(() =>
      rmSync(dir, {
        force: true,
        recursive: true,
      }),
    );

    // 造一个「旧版本」数据库：usage_records 没有 cwd / session_id
    const legacy = new Sqlite(dbPath);
    legacy.exec(`
      CREATE TABLE usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        tokens_cache_read INTEGER NOT NULL DEFAULT 0,
        tokens_cache_write INTEGER NOT NULL DEFAULT 0,
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_cache_read REAL NOT NULL DEFAULT 0,
        cost_cache_write REAL NOT NULL DEFAULT 0,
        cost_total REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'real_usage'
      );
    `);
    legacy
      .prepare(
        `INSERT INTO usage_records (timestamp, provider, model, cost_total)
         VALUES (?, ?, ?, ?)`,
      )
      .run(Date.now(), "openai", "gpt-4", 0.5);
    legacy.close();

    const db = new Database({
      dbPath,
    });
    cleanups.push(() => db.close());

    // 后加的 tool_calls 列同样被补齐；既有记录取建列时的默认 0
    expect(usageColumns(dbPath)).toContain("tool_calls");
    // 既有记录保留
    expect(totalRequests(db)).toBe(1);
    expect(db.getUsageStats("30d")[0]?.costTotal).toBeCloseTo(0.5, 6);

    // 存量记录的新列为空：归因里是「未知」分组，而不是被丢弃
    expect(db.getAttribution("30d", "project").map((row) => row.key)).toEqual([
      "",
    ]);

    // 迁移后的新写入带上项目，与存量记录可区分
    db.insertUsageRecord(
      usageRecord({
        cwd: "/work/app",
      }),
    );
    // 排序按花费倒序，因此不假设两行的先后；只断言两个分组都在且「未知」没被吞掉
    expect(
      db
        .getAttribution("30d", "project")
        .map((row) => row.key)
        .sort(),
    ).toEqual([
      "",
      "/work/app",
    ]);
    db.close();

    // 幂等：再打开一次不报错，数据不变
    const again = new Database({
      dbPath,
    });
    cleanups.push(() => again.close());
    expect(totalRequests(again)).toBe(2);
  });

  it("新库直接建出 tool_calls 列", () => {
    const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-toolcalls-"));
    cleanups.push(() =>
      rmSync(dir, {
        force: true,
        recursive: true,
      }),
    );
    const dbPath = join(dir, "usage.db");
    const db = new Database({
      dbPath,
    });
    cleanups.push(() => db.close());

    expect(usageColumns(dbPath)).toContain("tool_calls");
  });
});

describe("真实时间点与结果状态", () => {
  it("新库建出四列：缺省写入存 NULL，提供时原样保存，统计不受影响", () => {
    const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-timing-"));
    cleanups.push(() =>
      rmSync(dir, {
        force: true,
        recursive: true,
      }),
    );
    const dbPath = join(dir, "usage.db");
    const db = new Database({
      dbPath,
    });
    cleanups.push(() => db.close());

    for (const column of [
      "started_at",
      "first_token_at",
      "completed_at",
      "result_status",
    ]) {
      expect(usageColumns(dbPath)).toContain(column);
    }

    const plain = db.insertUsageRecord(usageRecord());
    expect(timingOf(dbPath, plain)).toEqual({
      completed_at: null,
      first_token_at: null,
      result_status: null,
      started_at: null,
    });

    const timed = db.insertUsageRecord(
      usageRecord({
        completedAt: 1_727_000_003,
        firstTokenAt: 1_727_000_001,
        resultStatus: "stop",
        startedAt: 1_727_000_000,
      }),
    );
    expect(timingOf(dbPath, timed)).toEqual({
      completed_at: 1_727_000_003,
      first_token_at: 1_727_000_001,
      result_status: "stop",
      started_at: 1_727_000_000,
    });

    // 时间点与结果状态不影响费用与 token 统计口径
    expect(totalRequests(db)).toBe(2);
    expect(db.getUsageStats("30d")[0]?.costTotal).toBeCloseTo(0.006, 6);
  });

  it("旧库迁移补齐四列：存量记录为 NULL，重复打开幂等", () => {
    const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-migrate-timing-"));
    cleanups.push(() =>
      rmSync(dir, {
        force: true,
        recursive: true,
      }),
    );
    const dbPath = join(dir, "usage.db");

    // 旧版本：没有真实时间点四列，也没有 cwd / session_id / tool_calls
    const legacy = new Sqlite(dbPath);
    legacy.exec(`
      CREATE TABLE usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        tokens_cache_read INTEGER NOT NULL DEFAULT 0,
        tokens_cache_write INTEGER NOT NULL DEFAULT 0,
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_cache_read REAL NOT NULL DEFAULT 0,
        cost_cache_write REAL NOT NULL DEFAULT 0,
        cost_total REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'real_usage'
      );
    `);
    legacy
      .prepare(
        `INSERT INTO usage_records (timestamp, provider, model, cost_total)
         VALUES (?, ?, ?, ?)`,
      )
      .run(Date.now(), "openai", "gpt-4", 0.5);
    legacy.close();

    const db = new Database({
      dbPath,
    });
    cleanups.push(() => db.close());
    for (const column of [
      "started_at",
      "first_token_at",
      "completed_at",
      "result_status",
    ]) {
      expect(usageColumns(dbPath)).toContain(column);
    }

    // 存量记录的新列为 NULL，且费用统计照常
    const legacyId = 1;
    expect(timingOf(dbPath, legacyId)).toEqual({
      completed_at: null,
      first_token_at: null,
      result_status: null,
      started_at: null,
    });
    expect(totalRequests(db)).toBe(1);
    expect(db.getUsageStats("30d")[0]?.costTotal).toBeCloseTo(0.5, 6);

    // 重复迁移幂等：再开一次不报错，数据与列不变
    db.close();
    const again = new Database({
      dbPath,
    });
    cleanups.push(() => again.close());
    expect(totalRequests(again)).toBe(1);
    expect(timingOf(dbPath, legacyId)).toEqual({
      completed_at: null,
      first_token_at: null,
      result_status: null,
      started_at: null,
    });
  });
});

describe("getEfficiency", () => {
  const SUCCESS_CYCLE = [
    "stop",
    "toolUse",
    "length",
  ] as const;

  it("样本达到门槛时给出 p50/p95、样本数与成功率", () => {
    const db = openTempDatabase();
    const now = Date.now();
    const started = now - 10_000;
    for (let index = 1; index <= 10; index += 1) {
      db.insertUsageRecord(
        usageRecord({
          completedAt: started + index * 100,
          firstTokenAt: started + index * 10,
          resultStatus: SUCCESS_CYCLE[index % SUCCESS_CYCLE.length],
          startedAt: started,
          timestamp: now - 1000,
        }),
      );
    }

    const rows = db.getEfficiency("24h", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      model: "gpt-4",
      p50TotalMs: 500,
      p50TtftMs: 50,
      p95TotalMs: 1000,
      p95TtftMs: 100,
      provider: "openai",
      sampleSize: 10,
      successRate: 1,
      sufficient: true,
    });
  });

  it("离群值只抬高 p95，不改变 p50", () => {
    const db = openTempDatabase();
    const now = Date.now();
    const started = now - 1_000_000;
    for (let index = 0; index < 9; index += 1) {
      db.insertUsageRecord(
        usageRecord({
          completedAt: started + 1000,
          firstTokenAt: started + 100,
          resultStatus: "stop",
          startedAt: started,
          timestamp: now - 1000,
        }),
      );
    }
    db.insertUsageRecord(
      usageRecord({
        completedAt: started + 100_000,
        firstTokenAt: started + 1000,
        resultStatus: "stop",
        startedAt: started,
        timestamp: now - 1000,
      }),
    );

    const rows = db.getEfficiency("24h", now);
    expect(rows[0]?.p50TotalMs).toBe(1000);
    expect(rows[0]?.p95TotalMs).toBe(100_000);
    expect(rows[0]?.p50TtftMs).toBe(100);
  });

  it("缺少时间点不进样本，结果状态未知不进成功率分母", () => {
    const db = openTempDatabase();
    const now = Date.now();
    for (let index = 0; index < 5; index += 1) {
      db.insertUsageRecord(
        usageRecord({
          completedAt: now - 100,
          firstTokenAt: now - 200,
          resultStatus: "stop",
          startedAt: now - 300,
          timestamp: now - 500,
        }),
      );
    }
    for (let index = 0; index < 7; index += 1) {
      db.insertUsageRecord(
        usageRecord({
          timestamp: now - 500,
        }),
      );
    }
    // 有时间点但没有结果状态：样本为 0，整组不进排行
    db.insertUsageRecord(
      usageRecord({
        completedAt: now - 100,
        firstTokenAt: now - 200,
        model: "no-status",
        startedAt: now - 300,
        timestamp: now - 500,
      }),
    );

    const rows = db.getEfficiency("24h", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe("gpt-4");
    expect(rows[0]?.sampleSize).toBe(5);
    expect(rows[0]?.sufficient).toBe(false);
    // 7 条无状态的存量记录不计入分母，成功率只看 5 条已知状态
    expect(rows[0]?.successRate).toBe(1);
  });

  it("失败请求降低成功率，其耗时也不进延迟样本", () => {
    const db = openTempDatabase();
    const now = Date.now();
    const started = now - 10_000;
    for (let index = 0; index < 8; index += 1) {
      db.insertUsageRecord(
        usageRecord({
          completedAt: started + 500,
          firstTokenAt: started + 50,
          resultStatus: "stop",
          startedAt: started,
          timestamp: now - 1000,
        }),
      );
    }
    for (const resultStatus of [
      "aborted",
      "error",
    ] as const) {
      db.insertUsageRecord(
        usageRecord({
          completedAt: started + 90_000,
          firstTokenAt: started + 80_000,
          resultStatus,
          startedAt: started,
          timestamp: now - 1000,
        }),
      );
    }

    const rows = db.getEfficiency("24h", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sampleSize).toBe(8);
    expect(rows[0]?.successRate).toBeCloseTo(0.8, 10);
    expect(rows[0]?.p95TotalMs).toBe(500);
  });

  it("排行把达标组排在前面，再按 p50 总耗时升序", () => {
    const db = openTempDatabase();
    const now = Date.now();
    const started = now - 100_000;
    const insertSamples = (provider: string, count: number, totalMs: number): void => {
      for (let index = 0; index < count; index += 1) {
        db.insertUsageRecord(
          usageRecord({
            completedAt: started + totalMs,
            firstTokenAt: started + 10,
            provider,
            resultStatus: "stop",
            startedAt: started,
            timestamp: now - 1000,
          }),
        );
      }
    };
    insertSamples("slow", 10, 2000);
    insertSamples("fast", 9, 100);

    const rows = db.getEfficiency("24h", now);
    expect(rows.map((row) => row.provider)).toEqual([
      "slow",
      "fast",
    ]);
    expect(rows[1]?.sufficient).toBe(false);
  });

  it("没有真实时间点或超出时间范围时不产生排行", () => {
    const db = openTempDatabase();
    db.insertUsageRecord(usageRecord());
    expect(db.getEfficiency("24h")).toEqual([]);

    const old = Date.now() - 2 * DAY;
    db.insertUsageRecord(
      usageRecord({
        completedAt: old + 100,
        firstTokenAt: old + 10,
        resultStatus: "stop",
        startedAt: old,
        timestamp: old,
      }),
    );
    expect(db.getEfficiency("24h")).toEqual([]);
    expect(db.getEfficiency("7d")).toHaveLength(1);
  });
});

describe("getAttribution", () => {
  it("三个维度的花费、token、请求数总和彼此相等且等于统计总量", () => {
    const db = openTempDatabase();
    const now = Date.now();
    const parts = [
      {
        cwd: "/a",
        model: "gpt-4",
        provider: "openai",
        sessionId: "s1",
      },
      {
        cwd: "/a",
        model: "gpt-4",
        provider: "openai",
        sessionId: "s2",
      },
      {
        cwd: "/b",
        model: "claude",
        provider: "anthropic",
        sessionId: "s1",
      },
      {
        cwd: "",
        model: "gpt-4",
        provider: "openai",
        sessionId: "",
      },
    ];
    for (const part of parts) {
      db.insertUsageRecord(
        usageRecord({
          ...part,
          costTotal: 0.1,
          timestamp: now,
          tokensInput: 10,
        }),
      );
    }

    const stats = db.getUsageStats("24h");
    const expectedCost = sumOf(stats, (row) => row.costTotal);
    const expectedTokens = sumOf(stats, (row) => row.totalTokens);
    const expectedRequests = sumOf(stats, (row) => row.requestCount);

    for (const dimension of [
      "project",
      "session",
      "vendorModel",
    ] as const) {
      const rows = db.getAttribution("24h", dimension);
      expect(
        sumOf(rows, (row) => row.costTotal),
        dimension,
      ).toBeCloseTo(expectedCost, 6);
      expect(
        sumOf(rows, (row) => row.tokens),
        dimension,
      ).toBe(expectedTokens);
      expect(
        sumOf(rows, (row) => row.requestCount),
        dimension,
      ).toBe(expectedRequests);
      // 同一维度内各行占比之和为 1（总花费非零）
      expect(
        sumOf(rows, (row) => row.costShare ?? 0),
        dimension,
      ).toBeCloseTo(1, 6);
    }
  });

  it("按花费倒序排列", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.1,
        cwd: "/small",
        timestamp: now,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.9,
        cwd: "/big",
        timestamp: now,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        costTotal: 0.5,
        cwd: "/mid",
        timestamp: now,
      }),
    );

    expect(db.getAttribution("24h", "project").map((row) => row.key)).toEqual([
      "/big",
      "/mid",
      "/small",
    ]);
  });

  it("缺少项目与会话信息的记录归入未知分组而不是被丢弃", () => {
    const db = openTempDatabase();
    const now = Date.now();
    db.insertUsageRecord(
      usageRecord({
        cwd: "",
        sessionId: "",
        timestamp: now,
      }),
    );
    db.insertUsageRecord(
      usageRecord({
        cwd: "",
        sessionId: "",
        timestamp: now,
      }),
    );

    const project = db.getAttribution("24h", "project");
    expect(project).toHaveLength(1);
    expect(project[0]?.key).toBe("");
    expect(project[0]?.requestCount).toBe(2);
    // 未知分组的占比与单请求成本照常计算：缺的是归因信息，不是度量
    expect(project[0]?.costShare).toBeCloseTo(1, 10);
    expect(project[0]?.costPerRequest).toBeCloseTo(0.003, 10);
    expect(project[0]?.cacheHitRate).toBe(0);
  });
  it("总花费为零时占比为 null，缓存命中率分母为零时同样为 null", () => {
    const db = openTempDatabase();
    db.insertUsageRecord(
      usageRecord({
        costInput: 0,
        costOutput: 0,
        costTotal: 0,
        cwd: "/zero",
        timestamp: Date.now(),
        tokensCacheRead: 0,
        tokensInput: 0,
      }),
    );

    const rows = db.getAttribution("24h", "project");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costShare).toBeNull();
    expect(rows[0]?.cacheHitRate).toBeNull();
    expect(rows[0]?.costPerRequest).toBe(0);
  });

  it("供应商·模型维度的键是 provider · model", () => {
    const db = openTempDatabase();
    db.insertUsageRecord(
      usageRecord({
        model: "gpt-4o-mini",
        provider: "openai",
      }),
    );

    expect(db.getAttribution("24h", "vendorModel").map((row) => row.key)).toEqual([
      "openai · gpt-4o-mini",
    ]);
  });

  it("范围外记录不计入", () => {
    const db = openTempDatabase();
    db.insertUsageRecord(
      usageRecord({
        cwd: "/old",
        timestamp: Date.now() - 2 * DAY,
      }),
    );

    expect(db.getAttribution("24h", "project")).toEqual([]);
  });
});

describe("余额快照", () => {
  it("写入后可读，覆盖更新只保留一行，重开数据库仍在", () => {
    const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-balance-"));
    const dbPath = join(dir, "usage.db");
    cleanups.push(() =>
      rmSync(dir, {
        force: true,
        recursive: true,
      }),
    );

    const first = new Database({
      dbPath,
    });
    first.upsertAccountBalance({
      balance: 10.5,
      currency: "CNY",
      error: null,
      source: "api",
      stale: false,
      syncedAt: 1_700_000_000_000,
      topup: 100,
      vendor: "A",
    });
    first.upsertAccountBalance({
      balance: 8.25,
      currency: "CNY",
      error: null,
      source: "manual",
      stale: false,
      syncedAt: 1_700_000_100_000,
      topup: null,
      vendor: "A",
    });
    expect(first.getAccountBalances()).toHaveLength(1);
    first.close();

    const second = new Database({
      dbPath,
    });
    cleanups.push(() => second.close());

    expect(second.getAccountBalance("A")).toEqual({
      balance: 8.25,
      currency: "CNY",
      error: null,
      source: "manual",
      stale: false,
      syncedAt: 1_700_000_100_000,
      topup: null,
      vendor: "A",
    });
  });

  it("从未同步过的供应商返回 null，且未知值存为 null 而不是 0", () => {
    const db = openTempDatabase();
    db.upsertAccountBalance({
      balance: null,
      currency: "CNY",
      error: "授权已过期",
      source: "oauth",
      stale: true,
      syncedAt: 1_700_000_000_000,
      topup: null,
      vendor: "B",
    });

    expect(db.getAccountBalance("missing")).toBeNull();
    expect(db.getAccountBalance("B")).toEqual({
      balance: null,
      currency: "CNY",
      error: "授权已过期",
      source: "oauth",
      stale: true,
      syncedAt: 1_700_000_000_000,
      topup: null,
      vendor: "B",
    });
  });
});
