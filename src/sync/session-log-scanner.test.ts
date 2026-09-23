import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanSessionLogs } from "./session-log-scanner.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const cleanups: (() => void)[] = [];

function setupSessions(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-sessions-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** 写一个会话 JSONL 到指定项目子目录。 */
function writeSession(
  dir: string,
  project: string,
  fileName: string,
  lines: string[],
): void {
  const projectDir = join(dir, project);
  mkdirSync(projectDir, {
    recursive: true,
  });
  writeFileSync(join(projectDir, fileName), `${lines.join("\n")}\n`);
}

const header = (sessionId: string, cwd: string) =>
  JSON.stringify({
    cwd,
    id: sessionId,
    timestamp: "2026-09-01T00:00:00.000Z",
    type: "session",
    version: 3,
  });

const assistantEntry = (overrides: {
  entryId?: string;
  messageAt?: number;
  model?: string;
  outputTokens?: number;
  stopReason?: string;
}) =>
  JSON.stringify({
    id: overrides.entryId ?? "abcd1234",
    parentId: null,
    timestamp: new Date(overrides.messageAt ?? NOW - DAY).toISOString(),
    type: "message",
    message: {
      model: overrides.model ?? "gpt-4",
      provider: "openai",
      role: "assistant",
      stopReason: overrides.stopReason ?? "stop",
      timestamp: overrides.messageAt ?? NOW - DAY,
      content: [
        {
          text: "hi",
          type: "text",
        },
      ],
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 100,
        output: overrides.outputTokens ?? 50,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0.001,
          output: 0.002,
          total: 0.003,
        },
      },
    },
  });

describe("scanSessionLogs", () => {
  it("解析 header 身份与 assistant usage：会话/条目/项目归因齐全", () => {
    const dir = setupSessions();
    writeSession(dir, "--proj-a--", "s1.jsonl", [
      header("sess-a", "/Users/felix/proj-a"),
      assistantEntry({}),
    ]);

    const { diagnostics, records } = scanSessionLogs({
      cutoff: NOW - 2 * DAY,
      sessionsDir: dir,
    });

    expect(diagnostics).toEqual([]);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toMatchObject({
      cwd: "/Users/felix/proj-a",
      entryId: "abcd1234",
      messageAt: NOW - DAY,
      model: "gpt-4",
      provider: "openai",
      resultStatus: "stop",
      sessionId: "sess-a",
      tokensInput: 100,
      tokensOutput: 50,
      toolCalls: 0,
    });
    expect(record.reconcileFingerprint).toEqual(expect.any(String));
  });

  it("跨项目日志全部扫到，条目归属各自的会话与项目", () => {
    const dir = setupSessions();
    writeSession(dir, "--proj-a--", "s1.jsonl", [
      header("sess-a", "/a"),
      assistantEntry({
        entryId: "aaaa0001",
      }),
    ]);
    writeSession(dir, "--proj-b--", "s2.jsonl", [
      header("sess-b", "/b"),
      assistantEntry({
        entryId: "bbbb0001",
      }),
    ]);

    const { records } = scanSessionLogs({
      cutoff: NOW - 2 * DAY,
      sessionsDir: dir,
    });

    expect(records.map((row) => row.cwd).sort()).toEqual([
      "/a",
      "/b",
    ]);
    expect(records.map((row) => row.sessionId).sort()).toEqual([
      "sess-a",
      "sess-b",
    ]);
  });

  it("坏文件与坏行逐个隔离成诊断，不影响其他文件", () => {
    const dir = setupSessions();
    writeSession(dir, "--bad--", "broken.jsonl", [
      "not-json-at-all",
      header("sess-bad", "/bad"),
      assistantEntry({
        entryId: "baaa0001",
      }),
    ]);
    writeSession(dir, "--bad--", "truncated.jsonl", [
      '{"type":"session","id":"sess-t","cwd":"/t"',
    ]);
    writeSession(dir, "--good--", "s.jsonl", [
      header("sess-g", "/g"),
      assistantEntry({
        entryId: "gggg0001",
      }),
    ]);

    const { diagnostics, records } = scanSessionLogs({
      cutoff: NOW - 2 * DAY,
      sessionsDir: dir,
    });

    expect(records.map((row) => row.sessionId).sort()).toEqual([
      "sess-bad",
      "sess-g",
    ]);
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    // 诊断带文件定位，且不包含日志正文
    for (const diagnostic of diagnostics) {
      expect(diagnostic.sessionFile).toContain(dir);
      expect(typeof diagnostic.detail).toBe("string");
    }
  });

  it("整文件 mtime 早于下界：直接跳过，不返回条目", () => {
    const dir = setupSessions();
    writeSession(dir, "--old--", "expired.jsonl", [
      header("sess-old", "/old"),
      assistantEntry({
        entryId: "oooo0001",
        messageAt: NOW - 10 * DAY,
      }),
    ]);
    const expiredFile = join(dir, "--old--", "expired.jsonl");
    utimesSync(expiredFile, new Date(NOW - 10 * DAY), new Date(NOW - 10 * DAY));

    const { records } = scanSessionLogs({
      cutoff: NOW - 2 * DAY,
      sessionsDir: dir,
    });

    expect(records).toEqual([]);
  });

  it("同文件内新旧条目混排：只返回下界内的条目", () => {
    const dir = setupSessions();
    writeSession(dir, "--mixed--", "s.jsonl", [
      header("sess-m", "/m"),
      assistantEntry({
        entryId: "mixo0001",
        messageAt: NOW - 10 * DAY,
      }),
      assistantEntry({
        entryId: "mixi0002",
        messageAt: NOW - 1 * DAY,
      }),
    ]);

    const { records } = scanSessionLogs({
      cutoff: NOW - 2 * DAY,
      sessionsDir: dir,
    });

    expect(records.map((row) => row.entryId)).toEqual([
      "mixi0002",
    ]);
  });

  it("会话根目录不存在：不抛错，返回诊断", () => {
    const { diagnostics, records } = scanSessionLogs({
      cutoff: NOW - 2 * DAY,
      sessionsDir: join(tmpdir(), "xpi-kuma-no-such-dir-xyz"),
    });

    expect(records).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it("缺条目 id 或会话 id 的 assistant 行不补录，记诊断", () => {
    const dir = setupSessions();
    writeSession(dir, "--no-id--", "s.jsonl", [
      // header 没有 id：sessionId 无法建立
      JSON.stringify({
        cwd: "/no-id",
        timestamp: "2026-09-01T00:00:00.000Z",
        type: "session",
      }),
      assistantEntry({
        entryId: "noid0001",
      }),
    ]);

    const { diagnostics, records } = scanSessionLogs({
      cutoff: NOW - 2 * DAY,
      sessionsDir: dir,
    });

    expect(records).toEqual([]);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
  });
});
