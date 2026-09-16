import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import Sqlite from "better-sqlite3";
import type {
  AggregatedStats,
  ProbeResult,
  StatsPeriod,
  UsageRecord,
} from "../types.ts";

/** 数据库文件默认位置：`~/.pi/agent/data/xpi-kuma/usage.db` */
export function defaultDatabasePath(): string {
  return join(getAgentDir(), "data", "xpi-kuma", "usage.db");
}

/** 时间范围到毫秒的换算表。 */
const PERIOD_MS: Record<StatsPeriod, number> = {
  "1h": 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** 图表最多渲染的数据点，超出则合并时间桶。 */
const MAX_TREND_POINTS = 100;

/** 各时间范围的默认时间桶粒度。 */
const PERIOD_BUCKET_MS: Record<StatsPeriod, number> = {
  "1h": 60 * 1000,
  "7d": 2 * 60 * 60 * 1000,
  "24h": 30 * 60 * 1000,
  "30d": 8 * 60 * 60 * 1000,
};

function defaultBucketMs(period: StatsPeriod): number {
  return PERIOD_BUCKET_MS[period];
}

/** 聚合查询返回的原始行（SQLite 列名为 snake_case）。 */
interface StatsRow {
  cost_cache_read: number;
  cost_cache_write: number;
  cost_input: number;
  cost_output: number;
  cost_total: number;
  model: string;
  provider: string;
  request_count: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  tokens_input: number;
  tokens_output: number;
}

/** SQLite 中存储的探测记录行。 */
export interface ProbeHistoryRow {
  error: string | null;
  id: number;
  model: string;
  status: string;
  timestamp: number;
  tokens_input: number;
  tokens_output: number;
  total_time: number | null;
  ttft: number | null;
  vendor: string;
}
/** 趋势查询的原始行。 */
interface TrendRow {
  bucket_index: number;
  cost_total: number;
  provider: string;
  tokens: number;
}

/** 趋势图上的一个时间点。 */
export interface TrendSeries {
  /** 桶起始时间（毫秒时间戳） */
  bucketStart: number;
  /** 各供应商在该桶内的费用，供多条折线使用 */
  byProvider: Record<string, number>;
  cost: number;
  tokens: number;
}

export interface DatabaseOptions {
  /** 数据库文件路径；传 `:memory:` 用于测试 */
  dbPath?: string;
}

/**
 * SQLite 封装：负责建表、写入与聚合查询。
 *
 * 连接为同步 API，实例在扩展生命周期内长期持有，`close()` 在 shutdown 时调用。
 */
export class Database {
  private readonly db: Sqlite.Database;
  private closed = false;

  constructor(options: DatabaseOptions = {}) {
    const dbPath = options.dbPath ?? defaultDatabasePath();
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), {
        recursive: true,
      });
    }
    this.db = new Sqlite(dbPath);
    // 写入冲突时等待而非立刻抛 SQLITE_BUSY
    this.db.pragma("busy_timeout = 5000");
    if (dbPath !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
    }
    this.initSchema();
  }

  /** 创建两张表及其索引；幂等，可重复调用。 */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
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

      CREATE INDEX IF NOT EXISTS idx_provider_model ON usage_records (provider, model);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_records (timestamp);

      CREATE TABLE IF NOT EXISTS probe_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        vendor TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        ttft INTEGER,
        total_time INTEGER,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_vendor ON probe_records (vendor);
      CREATE INDEX IF NOT EXISTS idx_probe_timestamp ON probe_records (timestamp);
    `);
  }

  /** 写入一条真实使用量记录，返回自增主键。 */
  insertUsageRecord(record: UsageRecord): number {
    const result = this.db
      .prepare(
        `INSERT INTO usage_records (
          timestamp, provider, model,
          tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
          cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.timestamp,
        record.provider,
        record.model,
        record.tokensInput,
        record.tokensOutput,
        record.tokensCacheRead,
        record.tokensCacheWrite,
        record.costInput,
        record.costOutput,
        record.costCacheRead,
        record.costCacheWrite,
        record.costTotal,
        record.source,
      );
    return Number(result.lastInsertRowid);
  }

  /** 写入一条探测记录，返回自增主键。 */
  insertProbeRecord(record: ProbeResult): number {
    const result = this.db
      .prepare(
        `INSERT INTO probe_records (
          timestamp, vendor, model, status, ttft, total_time,
          tokens_input, tokens_output, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.timestamp,
        record.vendor,
        record.model,
        record.status,
        record.ttft,
        record.totalTime,
        record.tokensInput,
        record.tokensOutput,
        record.error,
      );
    return Number(result.lastInsertRowid);
  }

  /**
   * 按 `provider × model` 聚合指定时间范围内的使用量。
   *
   * 无数据时返回空数组。
   */
  getUsageStats(period: StatsPeriod, now: number = Date.now()): AggregatedStats[] {
    const since = now - PERIOD_MS[period];
    const rows = this.db
      .prepare(
        `SELECT
          provider,
          model,
          SUM(tokens_input) AS tokens_input,
          SUM(tokens_output) AS tokens_output,
          SUM(tokens_cache_read) AS tokens_cache_read,
          SUM(tokens_cache_write) AS tokens_cache_write,
          SUM(cost_input) AS cost_input,
          SUM(cost_output) AS cost_output,
          SUM(cost_cache_read) AS cost_cache_read,
          SUM(cost_cache_write) AS cost_cache_write,
          SUM(cost_total) AS cost_total,
          COUNT(*) AS request_count
        FROM usage_records
        WHERE timestamp >= ?
        GROUP BY provider, model
        ORDER BY cost_total DESC`,
      )
      .all(since) as StatsRow[];

    return rows.map((row) => ({
      period,
      costCacheRead: row.cost_cache_read,
      costCacheWrite: row.cost_cache_write,
      costInput: row.cost_input,
      costOutput: row.cost_output,
      costTotal: row.cost_total,
      model: row.model,
      provider: row.provider,
      requestCount: row.request_count,
      tokensCacheRead: row.tokens_cache_read,
      tokensCacheWrite: row.tokens_cache_write,
      tokensInput: row.tokens_input,
      tokensOutput: row.tokens_output,
      totalTokens:
        row.tokens_input +
        row.tokens_output +
        row.tokens_cache_read +
        row.tokens_cache_write,
    }));
  }

  /** 查询指定供应商最近 N 条探测记录，按时间倒序；可按状态过滤。 */
  getProbeHistory(vendor: string, limit: number, status?: string): ProbeHistoryRow[] {
    const statusClause = status === undefined ? "" : "AND status = ?";
    const params: (string | number)[] =
      status === undefined
        ? [
            vendor,
            limit,
          ]
        : [
            vendor,
            status,
            limit,
          ];
    return this.db
      .prepare(
        `SELECT id, timestamp, vendor, model, status, ttft, total_time,
                tokens_input, tokens_output, error
         FROM probe_records
         WHERE vendor = ? ${statusClause}
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(...params) as ProbeHistoryRow[];
  }

  /**
   * 按时间桶查询费用与 token 趋势，供面板折线图使用。
   *
   * 桶数上限默认 100（design.md Risk 3），超出则按整数倍合并，
   * 保证图表数据点有界。
   */
  getTrend(
    period: StatsPeriod,
    options: {
      bucketMs?: number;
      maxPoints?: number;
      now?: number;
    } = {},
  ): TrendSeries[] {
    const now = options.now ?? Date.now();
    const maxPoints = options.maxPoints ?? MAX_TREND_POINTS;
    const since = now - PERIOD_MS[period];
    const rawBucket = options.bucketMs ?? defaultBucketMs(period);
    // 先按原始桶聚合，再判断是否需要合并，避免桶对齐被破坏
    const rawPoints = Math.ceil((now - since) / rawBucket);
    const factor = Math.max(1, Math.ceil(rawPoints / maxPoints));
    const bucketMs = rawBucket * factor;

    const rows = this.db
      .prepare(
        `SELECT
          CAST((? - timestamp) / ? AS INTEGER) AS bucket_index,
          provider,
          SUM(cost_total) AS cost_total,
          SUM(tokens_input + tokens_output + tokens_cache_read + tokens_cache_write) AS tokens
         FROM usage_records
         WHERE timestamp >= ?
         GROUP BY bucket_index, provider
         ORDER BY bucket_index DESC`,
      )
      .all(now, bucketMs, since) as TrendRow[];

    const byBucket = new Map<number, TrendSeries>();
    for (const row of rows) {
      const key = row.bucket_index;
      let series = byBucket.get(key);
      if (!series) {
        series = {
          bucketStart: now - key * bucketMs - bucketMs,
          byProvider: {},
          cost: 0,
          tokens: 0,
        };
        byBucket.set(key, series);
      }
      series.cost += row.cost_total;
      series.tokens += row.tokens;
      series.byProvider[row.provider] =
        (series.byProvider[row.provider] ?? 0) + row.cost_total;
    }

    return [
      ...byBucket.values(),
    ].sort((a, b) => a.bucketStart - b.bucketStart);
  }

  /** 删除超过保留期的使用量记录，返回删除行数。 */
  cleanOldRecords(retentionDays: number, now: number = Date.now()): number {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare("DELETE FROM usage_records WHERE timestamp < ?")
      .run(cutoff);
    return result.changes;
  }

  /** 关闭连接；重复调用无副作用。 */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }
}
