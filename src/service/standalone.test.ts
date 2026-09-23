import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLogger } from "../lib/log.ts";
import { Database, defaultDatabasePath } from "../storage/database.ts";
import { backfillFromSessionLogs } from "../sync/backfill.ts";
import { type StandaloneService, startStandaloneService } from "./standalone.ts";

const DAY = 24 * 60 * 60 * 1000;

const cleanups: (() => void)[] = [];
const started: StandaloneService[] = [];

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()?.close();
  }
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  delete process.env.PI_CODING_AGENT_DIR;
});

/** 会话日志里的一条 assistant usage 条目。 */
function assistantEntry(entryId: string, messageAt: number): string {
  return JSON.stringify({
    id: entryId,
    parentId: null,
    timestamp: new Date(messageAt).toISOString(),
    type: "message",
    message: {
      content: [],
      model: "gpt-4",
      provider: "openai",
      role: "assistant",
      stopReason: "stop",
      timestamp: messageAt,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 30,
        output: 20,
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
}

const sessionHeader = JSON.stringify({
  cwd: "/proj",
  id: "sess-standalone",
  timestamp: "2026-09-01T00:00:00.000Z",
  type: "session",
});

/** 准备隔离 agent 目录（配置 + 可选的会话日志行），返回目录与 logger。 */
function setupAgentDir(sessionLines: string[] | null): {
  dir: string;
  logger: FileLogger;
} {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-standalone-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  mkdirSync(join(dir, "data", "xpi-kuma"), {
    recursive: true,
  });
  writeFileSync(
    join(dir, "data", "xpi-kuma", "config.yaml"),
    "dashboard:\n  port: 47417\nvendors: []\nretention:\n  raw_records: 7\n",
  );
  if (sessionLines !== null) {
    const projectDir = join(dir, "sessions", "--proj--");
    mkdirSync(projectDir, {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, "sess-standalone.jsonl"),
      `${sessionLines.join("\n")}\n`,
    );
  }
  return {
    dir,
    logger: new FileLogger(join(dir, "standalone.log")),
  };
}

describe("startStandaloneService", () => {
  it("Pi 未运行：服务启动即补录，网页就绪前数据已在库", async () => {
    const messageAt = Date.now() - 3_600_000;
    const { logger } = setupAgentDir([
      sessionHeader,
      assistantEntry("stnd0001", messageAt),
    ]);

    const service = await startStandaloneService({
      logger,
    });
    started.push(service);

    expect(service.report.inserted).toBe(1);
    // 首屏数据接口按补录后的统计返回：Pi 没跑过，唯一的一行只能来自日志
    const db = new Database({
      dbPath: defaultDatabasePath(),
    });
    const overview = db.getUsageStats("24h");
    expect(overview.reduce((sum, row) => sum + row.requestCount, 0)).toBe(1);
    db.close();
  });

  it("补录部分失败：坏日志条目记为未核实，服务照常启动", async () => {
    const messageAt = Date.now() - 3_600_000;
    const { logger } = setupAgentDir([
      sessionHeader,
      "not-a-json-line",
      assistantEntry("good0001", messageAt),
    ]);

    const service = await startStandaloneService({
      logger,
    });
    started.push(service);

    // 好条目照常补入；坏行进了未核实诊断，服务监听成功
    expect(service.report.inserted).toBe(1);
    expect(service.report.unverified.length).toBeGreaterThanOrEqual(1);
    expect(service.server.port).toBeGreaterThan(0);
  });

  it("两入口重复补录只入账一次：重启服务不重复插入", async () => {
    const messageAt = Date.now() - 3_600_000;
    const { logger } = setupAgentDir([
      sessionHeader,
      assistantEntry("once0001", messageAt),
    ]);

    const first = await startStandaloneService({
      logger,
    });
    expect(first.report.inserted).toBe(1);
    await first.close();

    // 重启（相当于另一个入口再次触发补录）：唯一约束保证不双计
    const second = await startStandaloneService({
      logger,
    });
    started.push(second);
    expect(second.report.inserted).toBe(0);
    expect(second.report.reconciled).toBe(0);

    const db = new Database({
      dbPath: defaultDatabasePath(),
    });
    expect(
      db.getUsageStats("24h").reduce((sum, row) => sum + row.requestCount, 0),
    ).toBe(1);
    db.close();
  });

  it("补录扫描与保留期共享同一截止：超期条目不补", async () => {
    const { dir, logger } = setupAgentDir([
      sessionHeader,
      assistantEntry("oldd0001", Date.now() - 30 * DAY),
    ]);

    const service = await startStandaloneService({
      logger,
    });
    started.push(service);

    expect(service.report.inserted).toBe(0);
    expect(
      service.database
        .getUsageStats("30d")
        .reduce((sum, row) => sum + row.requestCount, 0),
    ).toBe(0);
    void dir;
  });

  it("backfillFromSessionLogs 与服务共用：手动再跑一遍幂等", async () => {
    const messageAt = Date.now() - 3_600_000;
    const { logger } = setupAgentDir([
      sessionHeader,
      assistantEntry("shrd0001", messageAt),
    ]);
    const service = await startStandaloneService({
      logger,
    });
    started.push(service);

    const again = backfillFromSessionLogs(service.database, {
      cutoff: Date.now() - 7 * DAY,
    });
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(1);
  });
});
