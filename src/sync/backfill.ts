import type { Database } from "../storage/database.ts";
import type { CallResultStatus, UsageRecord } from "../types.ts";
import {
  type ScanDiagnostic,
  type SessionLogUsage,
  scanSessionLogs,
} from "./session-log-scanner.ts";

/**
 * 幂等补录 / 实时对账（ADR 0001 角色 2）。
 *
 * 输入来自共享扫描器（Pi `session_start` 与独立服务 `on` 两个入口共用）。
 * 每条日志在一个独立事务里走同一条判定链：
 *
 * 1. `(session_id, source_entry_id)` 已存在 → 已入账，跳过；
 * 2. 指纹命中且候选唯一（实时行）→ 认领既有行，计数同一次调用；
 * 3. 指纹冲突、并发已认领 → 跳过，不双计；
 * 4. 旧行无指纹：会话/模型/token/费用全等且完成时间在消息时间的有界窗口内，
 *    候选唯一 → 保守认领；否则不自动判定，记为「未核实」；
 * 5. 都没有 → 插入新行；并发入口同时插入时由唯一约束兜底，计为跳过。
 *
 * 绝不因冲突删除或改写既有统计行；无法核实的条目只报告，不宣称已补齐
 * （design：显式准确性边界）。
 */

/** 旧行对账窗口：完成时间与日志消息时间的最大可信偏差。 */
// ponytail: 固定 5 分钟窗口按经验取值；若实测误配率明显，再改配置或放宽为按 provider 分窗
export const LEGACY_MATCH_WINDOW_MS = 5 * 60 * 1000;

export interface UnverifiedEntry {
  entryId: string;
  reason: "fingerprint-collision" | "legacy-ambiguous" | "missing-fields";
  sessionFile: string;
}

export interface BackfillReport {
  diagnostics: UnverifiedEntry[];
  /** 新插入的行数 */
  inserted: number;
  /** 认领既有行（实时行 / 旧行）的条数：同一次调用，不新增统计 */
  reconciled: number;
  /** 已入账（重复扫描或并发抢先）而跳过的条数 */
  skipped: number;
}

const KNOWN_STOP_REASONS: ReadonlySet<string> = new Set([
  "aborted",
  "deferred",
  "error",
  "length",
  "pending",
  "stop",
  "toolUse",
]);

function resultStatusOf(value: string | undefined): CallResultStatus | undefined {
  if (value === undefined || !KNOWN_STOP_REASONS.has(value)) {
    return undefined;
  }
  return value as CallResultStatus;
}

function recordFromLog(entry: SessionLogUsage): UsageRecord {
  return {
    completedAt: undefined,
    costCacheRead: entry.costCacheRead,
    costCacheWrite: entry.costCacheWrite,
    costInput: entry.costInput,
    costOutput: entry.costOutput,
    costTotal: entry.costTotal,
    cwd: entry.cwd,
    // 补录行不推断延迟：开始 / 首字 / 完成三个时间点保持未知
    firstTokenAt: undefined,
    messageAt: entry.messageAt,
    model: entry.model,
    provider: entry.provider,
    reconcileFingerprint: entry.reconcileFingerprint,
    resultStatus: resultStatusOf(entry.resultStatus),
    sessionId: entry.sessionId,
    source: "real_usage",
    sourceEntryId: entry.entryId,
    // 行时间 = 消息时间：日志里唯一可信的时间点
    startedAt: undefined,
    timestamp: entry.messageAt,
    tokensCacheRead: entry.tokensCacheRead,
    tokensCacheWrite: entry.tokensCacheWrite,
    tokensInput: entry.tokensInput,
    tokensOutput: entry.tokensOutput,
    toolCalls: entry.toolCalls,
  };
}

function unverified(
  entry: SessionLogUsage,
  reason: UnverifiedEntry["reason"],
): UnverifiedEntry {
  return {
    entryId: entry.entryId,
    reason,
    sessionFile: entry.sessionFile,
  };
}

/** 对单条日志做判定；由调用方包进事务。 */
function reconcileOne(
  database: Database,
  entry: SessionLogUsage,
): {
  outcome: "inserted" | "reconciled" | "skipped";
  unverified?: UnverifiedEntry;
} {
  if (
    entry.sessionId === "" ||
    entry.entryId === "" ||
    entry.model === "" ||
    entry.provider === ""
  ) {
    return {
      outcome: "skipped",
      unverified: unverified(entry, "missing-fields"),
    };
  }

  // 1) 幂等键直接命中：重复扫描或实时/日志已对上
  if (database.findUsageBySourceEntry(entry.sessionId, entry.entryId)) {
    return {
      outcome: "skipped",
    };
  }

  // 2) 指纹对账
  if (entry.reconcileFingerprint !== undefined) {
    const matches = database.findUsageByFingerprint(entry.reconcileFingerprint);
    const realtime = matches.filter((row) => row.source_entry_id === null);
    // 同一指纹已被另一条日志入账：碰撞场景不自动改写、不自动判定
    if (
      matches.some(
        (row) => row.source_entry_id !== null && row.source_entry_id !== entry.entryId,
      )
    ) {
      return {
        outcome: "skipped",
        unverified: unverified(entry, "fingerprint-collision"),
      };
    }
    // 本条已入账（重复扫描）
    if (matches.some((row) => row.source_entry_id === entry.entryId)) {
      return {
        outcome: "skipped",
      };
    }
    if (realtime.length === 1) {
      database.claimUsageRowSource(realtime[0].id, entry.entryId);
      return {
        outcome: "reconciled",
      };
    }
    if (realtime.length > 1) {
      return {
        outcome: "skipped",
        unverified: unverified(entry, "fingerprint-collision"),
      };
    }
  }

  // 3) 旧行保守认领：无指纹、无消息时间，只能靠字段全等 + 有界窗口
  const legacy = database.findLegacyUsageMatches({
    costCacheRead: entry.costCacheRead,
    costCacheWrite: entry.costCacheWrite,
    costInput: entry.costInput,
    costOutput: entry.costOutput,
    costTotal: entry.costTotal,
    messageAt: entry.messageAt,
    model: entry.model,
    provider: entry.provider,
    sessionId: entry.sessionId,
    tokensCacheRead: entry.tokensCacheRead,
    tokensCacheWrite: entry.tokensCacheWrite,
    tokensInput: entry.tokensInput,
    tokensOutput: entry.tokensOutput,
    windowMs: LEGACY_MATCH_WINDOW_MS,
  });
  if (legacy.length === 1) {
    database.claimUsageRowSource(legacy[0].id, entry.entryId);
    return {
      outcome: "reconciled",
    };
  }
  if (legacy.length > 1) {
    return {
      outcome: "skipped",
      unverified: unverified(entry, "legacy-ambiguous"),
    };
  }

  // 4) 新条目：插入；并发入口同时插入时唯一约束兜底
  try {
    database.insertUsageRecord(recordFromLog(entry));
  } catch {
    return {
      outcome: "skipped",
    };
  }
  return {
    outcome: "inserted",
  };
}

/** 把一批扫描结果幂等补入数据库；永不抛出（插入冲突按跳过计）。 */
export function backfillUsage(
  database: Database,
  records: SessionLogUsage[],
): BackfillReport {
  const report: BackfillReport = {
    diagnostics: [],
    inserted: 0,
    reconciled: 0,
    skipped: 0,
  };

  for (const entry of records) {
    let result: ReturnType<typeof reconcileOne>;
    try {
      // 每条一个事务：单条冲突只回滚自身，不影响批次其余条目
      result = database.runInTransaction(() => reconcileOne(database, entry));
    } catch {
      report.skipped += 1;
      continue;
    }
    if (result.unverified) {
      report.diagnostics.push(result.unverified);
    }
    report[result.outcome] += 1;
  }

  return report;
}

/** 把「扫描会话日志 + 幂等补录」合成一步：Pi session_start 与独立服务共用这一入口。 */
export function backfillFromSessionLogs(
  database: Database,
  options: {
    cutoff: number;
    sessionsDir?: string;
  },
): BackfillReport & {
  scanDiagnostics: ScanDiagnostic[];
} {
  const scan = scanSessionLogs({
    cutoff: options.cutoff,
    sessionsDir: options.sessionsDir,
  });
  const report = backfillUsage(database, scan.records);
  return {
    ...report,
    scanDiagnostics: scan.diagnostics,
  };
}
