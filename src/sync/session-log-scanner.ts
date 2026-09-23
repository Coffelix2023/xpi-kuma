import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type FingerprintInput, usageFingerprint } from "./fingerprint.ts";

/**
 * Pi 会话日志扫描器（ADR 0001 角色 2：共享补录的取数侧）。
 *
 * 遍历 `<agentDir>/sessions/<项目>/*.jsonl`，抽取 assistant 条目的 usage 与
 * 条目身份。所有错误（坏目录、坏文件、坏行）逐个隔离成诊断项，绝不抛出：
 * 补录永远不阻断 Pi 会话启动与实时采集（spec：usage-collection）。
 */

/** 一条可补录的 assistant usage（来自会话日志）。 */
export interface SessionLogUsage extends FingerprintInput {
  costCacheRead: number;
  costCacheWrite: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  cwd: string;
  /** 日志条目 id：补录幂等键的一半（另一半是 sessionId） */
  entryId: string;
  messageAt: number;
  model: string;
  provider: string;
  /** 实时/日志对账指纹；缺消息时间时缺省 */
  reconcileFingerprint?: string;
  resultStatus?: string;
  /** 来源 JSONL 文件路径，诊断与定位用 */
  sessionFile: string;
  sessionId: string;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensInput: number;
  tokensOutput: number;
  toolCalls: number;
}

/** 单个文件/行的解析诊断；`detail` 不含日志正文，避免敏感内容进日志。 */
export interface ScanDiagnostic {
  detail: string;
  sessionFile: string;
}

export interface ScanSessionLogsOptions {
  /** 扫描下界（毫秒）：消息时间早于它的条目跳过（与保留期清理截止一致） */
  cutoff: number;
  /** 会话根目录；缺省 `<agentDir>/sessions` */
  sessionsDir?: string;
}

export interface SessionLogScan {
  diagnostics: ScanDiagnostic[];
  records: SessionLogUsage[];
}

/** 会话日志 JSONL 的单行形状（只声明本模块关心的字段）。 */
interface RawEntry {
  cwd?: unknown;
  id?: unknown;
  message?: {
    content?: unknown;
    model?: unknown;
    provider?: unknown;
    role?: unknown;
    stopReason?: unknown;
    timestamp?: unknown;
    usage?: {
      cacheRead?: unknown;
      cacheWrite?: unknown;
      cost?: {
        cacheRead?: unknown;
        cacheWrite?: unknown;
        input?: unknown;
        output?: unknown;
        total?: unknown;
      } | null;
      input?: unknown;
      output?: unknown;
    } | null;
  };
  timestamp?: unknown;
  type?: unknown;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 解析单个 JSONL 行；失败返回 null。 */
function parseEntry(line: string): RawEntry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as RawEntry) : null;
  } catch {
    return null;
  }
}

/** 列出全部项目目录；坏目录返回空并带诊断。 */
function listProjectDirs(sessionsDir: string): {
  diagnostics: ScanDiagnostic[];
  dirs: string[];
} {
  try {
    return {
      diagnostics: [],
      dirs: readdirSync(sessionsDir, {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(sessionsDir, entry.name)),
    };
  } catch (error) {
    return {
      dirs: [],
      diagnostics: [
        {
          detail: `会话根目录不可读：${error instanceof Error ? error.message : String(error)}`,
          sessionFile: sessionsDir,
        },
      ],
    };
  }
}

/** 扫描单个 JSONL 文件；错误隔离在文件内，不影响其他文件。 */
function scanSessionFile(
  sessionFile: string,
  cutoff: number,
): {
  diagnostics: ScanDiagnostic[];
  records: SessionLogUsage[];
} {
  const diagnostics: ScanDiagnostic[] = [];
  const records: SessionLogUsage[] = [];
  let lines: string[];

  // 便宜的上界：整文件的最后修改早于扫描下界时，所有条目都已超期
  try {
    if (statSync(sessionFile).mtimeMs < cutoff) {
      return {
        diagnostics,
        records,
      };
    }
    lines = readFileSync(sessionFile, "utf8").split("\n");
  } catch (error) {
    diagnostics.push({
      detail: `会话文件不可读：${error instanceof Error ? error.message : String(error)}`,
      sessionFile,
    });
    return {
      diagnostics,
      records,
    };
  }

  let sessionId = "";
  let sessionCwd = "";
  for (const [index, line] of lines.entries()) {
    const entry = parseEntry(line);
    if (!entry) {
      if (line.trim() !== "") {
        diagnostics.push({
          detail: `第 ${index + 1} 行不是合法 JSON`,
          sessionFile,
        });
      }
      continue;
    }

    // header 行：补录归因的 cwd / sessionId 都来自这里
    if (entry.type === "session") {
      sessionId = asString(entry.id);
      sessionCwd = asString(entry.cwd);
      continue;
    }
    if (entry.type !== "message") {
      continue;
    }
    const message = entry.message;
    if (message?.role !== "assistant" || !message.usage) {
      continue;
    }
    if (asString(entry.id) === "" || sessionId === "") {
      diagnostics.push({
        detail: `第 ${index + 1} 行缺少条目 id 或会话 id，无法建立补录身份`,
        sessionFile,
      });
      continue;
    }

    const usage = message.usage;
    const cost = usage.cost ?? {};
    const messageAt =
      asNumber(message.timestamp) ?? (Date.parse(asString(entry.timestamp)) || 0);
    if (messageAt < cutoff) {
      continue;
    }

    const tokensInput = asNumber(usage.input) ?? 0;
    const tokensOutput = asNumber(usage.output) ?? 0;
    const tokensCacheRead = asNumber(usage.cacheRead) ?? 0;
    const tokensCacheWrite = asNumber(usage.cacheWrite) ?? 0;
    const costInput = asNumber(cost.input) ?? 0;
    const costOutput = asNumber(cost.output) ?? 0;
    const costCacheRead = asNumber(cost.cacheRead) ?? 0;
    const costCacheWrite = asNumber(cost.cacheWrite) ?? 0;
    const costTotal = asNumber(cost.total) ?? 0;
    const model = asString(message.model);
    const provider = asString(message.provider);
    const resultStatus = asString(message.stopReason);
    const toolCalls = Array.isArray(message.content)
      ? message.content.filter(
          (block) =>
            typeof block === "object" &&
            block !== null &&
            (
              block as {
                type?: unknown;
              }
            ).type === "toolCall",
        ).length
      : 0;

    records.push({
      costCacheRead,
      costCacheWrite,
      costInput,
      costOutput,
      costTotal,
      cwd: sessionCwd,
      entryId: asString(entry.id),
      messageAt,
      model,
      provider,
      // 补录行不推断延迟：startedAt / firstTokenAt / completedAt 保持未知
      resultStatus: resultStatus === "" ? undefined : resultStatus,
      sessionId,
      sessionFile,
      tokensCacheRead,
      tokensCacheWrite,
      tokensInput,
      tokensOutput,
      toolCalls,
      ...((): {
        reconcileFingerprint?: string;
      } => {
        const fingerprint = usageFingerprint({
          costCacheRead,
          costCacheWrite,
          costInput,
          costOutput,
          costTotal,
          messageAt,
          model,
          provider,
          sessionId,
          tokensCacheRead,
          tokensCacheWrite,
          tokensInput,
          tokensOutput,
        });
        return fingerprint === undefined
          ? {}
          : {
              reconcileFingerprint: fingerprint,
            };
      })(),
    });
  }

  return {
    diagnostics,
    records,
  };
}

/**
 * 扫描保留期内的 Pi 会话日志，返回可补录条目与诊断。
 *
 * 目录名不反推 cwd：归因路径取 header 里的 `cwd`（design 决策）。
 */
export function scanSessionLogs(options: ScanSessionLogsOptions): SessionLogScan {
  const { cutoff } = options;
  const sessionsDir = options.sessionsDir ?? join(getAgentDir(), "sessions", "");
  const diagnostics: ScanDiagnostic[] = [];
  const records: SessionLogUsage[] = [];

  const { dirs, diagnostics: dirDiagnostics } = listProjectDirs(sessionsDir);
  diagnostics.push(...dirDiagnostics);
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir, {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => join(dir, entry.name));
    } catch (error) {
      diagnostics.push({
        detail: `项目会话目录不可读：${error instanceof Error ? error.message : String(error)}`,
        sessionFile: dir,
      });
      continue;
    }
    for (const file of files) {
      const result = scanSessionFile(file, cutoff);
      diagnostics.push(...result.diagnostics);
      records.push(...result.records);
    }
  }

  return {
    diagnostics,
    records,
  };
}
