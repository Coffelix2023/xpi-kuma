import { AccountService } from "../accounts/service.ts";
import { UsageCollector } from "../collectors/usage-collector.ts";
import { loadConfig } from "../config.ts";
import type { FileLogger } from "../lib/log.ts";
import { VendorMonitor } from "../monitors/vendor-monitor.ts";
import { Database, defaultDatabasePath } from "../storage/database.ts";
import { backfillFromSessionLogs } from "../sync/backfill.ts";
import { type DashboardServer, startDashboardServer } from "../ui/dashboard.ts";

/**
 * 独立服务启动例程（ADR 0001 角色 3 的进程内部分）。
 *
 * 终端 CLI（任务 3.3）只做参数解析与后台进程托管；这里负责服务本体：
 * 配置 → 数据库 → **首次网页就绪前**跑共享补录 → 网页监听 + 探测定时器。
 * 补录与 Pi `session_start` 用同一入口（spec：standalone-service），
 * 并发双入口靠数据库唯一约束保证只入账一次。
 *
 * 准确性边界（design）：补录部分失败不阻止网页与探测启动；未核实条目
 * 记入日志并随返回值交给 CLI 展示。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StandaloneService {
  close(): Promise<void>;
  readonly database: Database;
  readonly report: BackfillSummary;
  readonly server: DashboardServer;
}

/** 补录结果摘要；未核实数量与定位交给 CLI 展示。 */
export interface BackfillSummary {
  inserted: number;
  reconciled: number;
  /** 未核实条目（含原因与日志文件定位） */
  unverified: {
    detail: string;
  }[];
}

export interface StartStandaloneOptions {
  /** 服务日志；CLI 侧已把子进程 stderr 重定向到同一目录 */
  logger: FileLogger;
  port?: number;
}

/**
 * 启动独立服务：补录先行，网页与探测随后。
 *
 * 补录抛错时服务照常启动（spec：不得阻止网页与探测），错误进日志。
 */
export async function startStandaloneService(
  options: StartStandaloneOptions,
): Promise<StandaloneService> {
  const { logger } = options;
  const config = loadConfig();
  const database = new Database({
    dbPath: defaultDatabasePath(),
  });
  const collector = new UsageCollector(database);
  const vendorMonitor = new VendorMonitor(database, config);

  // —— 共享补录：在网页开始服务之前完成 —— //
  const now = Date.now();
  const retentionDays = config.retention.rawRecords;
  const report: BackfillSummary = {
    inserted: 0,
    reconciled: 0,
    unverified: [],
  };
  try {
    const result = backfillFromSessionLogs(database, {
      cutoff: now - retentionDays * DAY_MS,
    });
    report.inserted = result.inserted;
    report.reconciled = result.reconciled;
    for (const diagnostic of result.scanDiagnostics) {
      report.unverified.push({
        detail: `会话日志不可读：${diagnostic.sessionFile}（${diagnostic.detail}）`,
      });
    }
    for (const item of result.diagnostics) {
      report.unverified.push({
        detail: `条目未核实：${item.entryId}（${item.reason}）${item.sessionFile}`,
      });
    }
    for (const item of report.unverified) {
      logger.warn(item.detail);
    }
    logger.info(
      `独立服务补录：新增 ${report.inserted}，对账 ${report.reconciled}，未核实 ${report.unverified.length}`,
    );
  } catch (error) {
    // 补录失败只记录：网页与探测照常启动
    logger.error("独立服务补录失败（服务照常启动）", error);
  }

  // 配置热重载：重建探测定时器与账户服务（数据库与网页复用，写接口据此回 400/200）
  const deps = {
    accountService: new AccountService({
      config,
      database,
      logger,
    }),
    vendorMonitor,
  };
  vendorMonitor.start();
  const reloadConfig = (): void => {
    const next = loadConfig();
    const nextMonitor = new VendorMonitor(database, next);
    nextMonitor.start();
    void deps.vendorMonitor.stop();
    const nextAccounts = new AccountService({
      config: next,
      database,
      logger,
    });
    nextAccounts.setRedirectUri(server.redirectUri);
    deps.vendorMonitor = nextMonitor;
    deps.accountService = nextAccounts;
    logger.info(`配置热重载：${next.vendors.length} 个供应商`);
  };
  const server = await startDashboardServer(
    () => ({
      accounts: deps.accountService,
      cwd: process.cwd(),
      reloadConfig,
      usageCollector: collector,
      vendorMonitor: deps.vendorMonitor,
    }),
    {
      port: options.port ?? config.dashboard.port,
    },
  );

  return {
    close: async () => {
      await server.close();
      await deps.vendorMonitor.stop();
      database.close();
    },
    database,
    report,
    server,
  };
}
