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
