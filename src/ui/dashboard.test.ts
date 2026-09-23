import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AccountService } from "../accounts/service.ts";
import { UsageCollector } from "../collectors/usage-collector.ts";
import { loadConfig, resolveConfigPath } from "../config.ts";
import { FileLogger } from "../lib/log.ts";
import { VendorMonitor } from "../monitors/vendor-monitor.ts";
import { Database } from "../storage/database.ts";
import type { KumaConfig } from "../types.ts";
import { type DashboardServer, startDashboardServer } from "./dashboard.ts";

const CONFIG: KumaConfig = {
  dashboard: {
    port: 5180,
  },
  retention: {
    rawRecords: 7,
  },
  vendors: [
    {
      endpoint: "http://127.0.0.1:1/v1",
      name: "[OI]",
      // 手动手值：让同步与账户接口有可断言的成功行
      balance: {
        manual: 10,
      },
      models: [
        "gpt-4o-mini",
      ],
      probe: {
        enabled: true,
        interval: "5m",
        timeout: 1000,
      },
    },
    {
      endpoint: "http://127.0.0.1:1/v1",
      name: "Anthropic",
      models: [
        "claude-3",
      ],
      probe: {
        enabled: true,
        interval: "5m",
        timeout: 1000,
      },
    },
  ],
};

const cleanups: (() => void | Promise<void>)[] = [];
let servers: DashboardServer[] = [];

interface Res {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}

/** 用原始 HTTP 请求，才能伪造 Host / Origin 头。 */
function call(
  port: number,
  path: string,
  options: {
    /** 请求体；写操作要靠它传 JSON */
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<Res> {
  return new Promise<Res>((resolve, reject) => {
    const req = request(
      {
        headers: options.headers,
        host: "127.0.0.1",
        method: options.method ?? "GET",
        path,
        port,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
            status: res.statusCode ?? 0,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** 建一个含最小配置文件的临时项目根：手动填写要真的改这份配置。 */
function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-project-"));
  // 配置只从全局目录读：临时项目目录同时充当 agent 目录
  process.env.PI_CODING_AGENT_DIR = dir;
  const path = resolveConfigPath();
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(
    path,
    [
      "vendors:",
      '  - name: "[OI]"',
      '    endpoint: "http://127.0.0.1:1/v1"',
      '    models: ["gpt-4o-mini"]',
      '  - name: "Anthropic"',
      '    endpoint: "http://127.0.0.1:1/v1"',
      '    models: ["claude-3"]',
    ].join("\n"),
  );
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  return dir;
}
async function start(options: { port?: number } = {}): Promise<{
  accountService: AccountService;
  collector: UsageCollector;
  monitor: VendorMonitor;
  projectDir: string;
  server: DashboardServer;
}> {
  const database = new Database({
    dbPath: ":memory:",
  });
  const collector = new UsageCollector(database);
  const monitor = new VendorMonitor(database, CONFIG);
  const projectDir = tempProject();
  const accountService = new AccountService({
    config: CONFIG,
    database,
    logger: new FileLogger(join(projectDir, "xpi-kuma-test.log")),
  });
  cleanups.push(() => database.close());
  // 依赖按请求读取：reloadConfig() 就地换掉字段后，接口立刻反映新配置
  const deps = {
    accounts: accountService,
    cwd: projectDir,
    usageCollector: collector,
    vendorMonitor: monitor,
    reloadConfig: () => {},
  };
  const server = await startDashboardServer(() => deps, {
    port: options.port,
  });
  servers.push(server);
  return {
    accountService,
    collector,
    monitor,
    projectDir,
    server,
  };
}

/** 借系统分配一个当前空闲的端口，用于「固定端口」用例。 */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return port;
}

beforeAll(() => {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "xpi-kuma-dash-"));
});

afterAll(() => {
  delete process.env.PI_CODING_AGENT_DIR;
});

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  vi.restoreAllMocks();
});

describe("服务启动与路由", () => {
  it("绑定 127.0.0.1 的随机端口，且每次启动端口不同", async () => {
    const first = await start();
    const second = await start();

    expect(first.server.port).toBeGreaterThan(0);
    expect(second.server.port).toBeGreaterThan(0);
    expect(first.server.port).not.toBe(second.server.port);
    expect(first.server.url).toBe(
      `http://127.0.0.1:${first.server.port}/#${first.server.token}`,
    );
  });

  it("指定端口时固定监听该端口", async () => {
    const port = await freePort();
    const { server } = await start({
      port,
    });

    expect(server.port).toBe(port);
    expect(server.portFallback).toBe(false);
  });

  it("目标端口被占用时回退随机端口并标记，不抛错", async () => {
    const first = await start();
    const { server } = await start({
      port: first.server.port,
    });

    expect(server.portFallback).toBe(true);
    expect(server.port).not.toBe(first.server.port);
    expect(server.port).toBeGreaterThan(0);
  });

  it("根页面返回不含监控数据与凭据的 shell", async () => {
    const { server } = await start();
    const res = await call(server.port, "/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('id="kuma-vendors"');
    expect(res.body).toContain('id="kuma-chart"');
    expect(res.body).not.toContain("__kumaInitialState");
    expect(res.body).not.toContain(server.token);
  });

  it("四个页面路径都返回不含凭据的静态外壳", async () => {
    const { server } = await start();
    for (const path of [
      "/",
      "/empty",
      "/accounts",
      "/settings",
    ]) {
      const res = await call(server.port, path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-type"], path).toContain("text/html");
      expect(res.body, path).not.toContain(server.token);
    }
  });

  it("子页面各有自己的容器，不混入主面板的数据区块", async () => {
    const { server } = await start();
    const accounts = await call(server.port, "/accounts");
    expect(accounts.body).toContain('id="kuma-accounts"');
    expect(accounts.body).not.toContain('id="kuma-vendors"');

    const settings = await call(server.port, "/settings");
    expect(settings.body).toContain('id="kuma-diagnostics"');
    expect(settings.body).not.toContain('id="kuma-vendors"');

    const empty = await call(server.port, "/empty");
    expect(empty.body).toContain('id="kuma-guide-data-title"');
    expect(empty.body).toContain('id="section-guide-vendors"');
    expect(empty.body).not.toContain('id="kuma-vendors"');
  });

  it("页面外壳开放不影响数据接口的凭据校验", async () => {
    const { server } = await start();
    const dashboard = await call(server.port, "/api/dashboard");
    expect(dashboard.status).toBe(401);

    const probes = await call(server.port, "/api/probes", {
      method: "POST",
    });
    expect(probes.status).toBe(401);
  });

  it("原型链路径不会命中页面路由", async () => {
    const { server } = await start();
    for (const path of [
      "/__proto__",
      "/constructor",
    ]) {
      const res = await call(server.port, path);
      expect(res.status, path).toBe(401);
      expect(res.body, path).not.toContain("function");
    }
  });

  it("数据接口按请求的时间范围返回有界 JSON", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/dashboard?period=7d", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.period).toBe("7d");
    expect(data.stats).toEqual([]);
    expect(data.trend).toEqual([]);
    expect(data.vendors).toHaveLength(2);
    // 新增字段在空数据下也给明确空态：命中率未知（null）而不是 0%
    expect(data.cache).toEqual({
      cacheReadTokens: 0,
      hitRate: null,
      inputTokens: 0,
    });
    expect(data.efficiency).toEqual([]);
    expect(data.insights).toEqual([]);
  });

  it("概览四项与统计一致，归因随 dimension 参数分组", async () => {
    const { collector, server } = await start();
    for (const sample of [
      {
        costTotal: 1,
        cwd: "/work/a",
      },
      {
        costTotal: 2,
        cwd: "/work/b",
      },
    ]) {
      collector.record({
        costCacheRead: 0,
        costCacheWrite: 0,
        costInput: sample.costTotal,
        costOutput: 0,
        costTotal: sample.costTotal,
        cwd: sample.cwd,
        model: "gpt-4o-mini",
        provider: "openai",
        sessionId: "s1",
        source: "real_usage",
        timestamp: Date.now(),
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensInput: 10,
        tokensOutput: 5,
        toolCalls: 0,
      });
    }

    const auth = {
      authorization: `Bearer ${server.token}`,
    };
    const res = await call(server.port, "/api/dashboard?period=24h&dimension=project", {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    const sum = (key: string) =>
      data.stats.reduce(
        (total: number, row: Record<string, number>) => total + row[key],
        0,
      );
    // 归因各分组花费之和等于概览本期花费，四项目径与统计一致
    expect(data.overview.costTotal).toBeCloseTo(sum("costTotal"), 10);
    expect(data.overview.totalTokens).toBe(sum("totalTokens"));
    expect(data.overview.requestCount).toBe(sum("requestCount"));
    // 缓存结构与统计同源；样本不足（各 1 次请求）时不产生洞察
    expect(data.cache).toEqual({
      cacheReadTokens: 0,
      hitRate: 0,
      inputTokens: 20,
    });
    expect(data.insights).toEqual([]);
    expect(data.overview.projectCount).toBe(2);
    expect(data.dimension).toBe("project");
    expect(data.attribution).toHaveLength(2);
    expect(data.attribution[0].costTotal).toBeGreaterThan(
      data.attribution[1].costTotal,
    );

    const bySession = await call(
      server.port,
      "/api/dashboard?period=24h&dimension=session",
      {
        headers: auth,
      },
    );
    expect(JSON.parse(bySession.body).attribution).toHaveLength(1);

    const bad = await call(server.port, "/api/dashboard?dimension=team", {
      headers: auth,
    });
    expect(bad.status).toBe(400);
  });

  it("效率聚合失败时保留基础统计，洞察标记不可用", async () => {
    const { collector, server } = await start();
    collector.record({
      costCacheRead: 0,
      costCacheWrite: 0,
      costInput: 0.03,
      costOutput: 0,
      costTotal: 0.03,
      cwd: "/work/app",
      model: "gpt-4o-mini",
      provider: "openai",
      sessionId: "s1",
      source: "real_usage",
      timestamp: Date.now(),
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      tokensInput: 10,
      tokensOutput: 5,
      toolCalls: 0,
    });
    vi.spyOn(collector, "getEfficiency").mockImplementation(() => {
      throw new Error("效率聚合失败");
    });

    const res = await call(server.port, "/api/dashboard?period=24h", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    // 基础统计不受影响
    expect(data.stats).toHaveLength(1);
    expect(data.overview.costTotal).toBeCloseTo(0.03, 10);
    expect(data.attribution).toHaveLength(1);
    // 受影响的部分明确标记不可用 / 暂无数据
    expect(data.efficiency).toEqual([]);
    expect(data.insights).toBeNull();
  });

  it("洞察生成失败时效率排行保留，基础统计不受影响", async () => {
    const { collector, server } = await start();
    const now = Date.now();
    for (let index = 0; index < 10; index += 1) {
      collector.record({
        completedAt: now + index + 500,
        costCacheRead: 0,
        costCacheWrite: 0,
        costInput: 0.01,
        costOutput: 0,
        costTotal: 0.01,
        cwd: "/work/app",
        firstTokenAt: now + index + 100,
        model: "gpt-4o-mini",
        provider: "openai",
        resultStatus: "stop",
        sessionId: "s1",
        source: "real_usage",
        startedAt: now + index,
        timestamp: now,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensInput: 10,
        tokensOutput: 5,
        toolCalls: 0,
      });
    }
    vi.spyOn(collector, "getInsights").mockImplementation(() => {
      throw new Error("洞察生成失败");
    });

    const res = await call(server.port, "/api/dashboard?period=24h", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.stats).toHaveLength(1);
    expect(data.efficiency).toHaveLength(1);
    expect(data.efficiency[0]).toMatchObject({
      provider: "openai",
      sampleSize: 10,
      sufficient: true,
    });
    expect(data.insights).toBeNull();
  });

  it("达标时返回效率排行、缓存结构与有界洞察", async () => {
    const { collector, server } = await start();
    const now = Date.now();
    const seed = (
      provider: string,
      costPerRequest: number,
      totalMs: number,
      cacheReadTokens: number,
    ): void => {
      for (let index = 0; index < 10; index += 1) {
        collector.record({
          completedAt: now + index + totalMs,
          costCacheRead: 0,
          costCacheWrite: 0,
          costInput: costPerRequest,
          costOutput: 0,
          costTotal: costPerRequest,
          cwd: "/work/app",
          firstTokenAt: now + index + 100,
          model: "gpt-4o-mini",
          provider,
          resultStatus: "stop",
          sessionId: "s1",
          source: "real_usage",
          startedAt: now + index,
          timestamp: now,
          tokensCacheRead: cacheReadTokens,
          tokensCacheWrite: 0,
          tokensInput: 10,
          tokensOutput: 5,
          toolCalls: 0,
        });
      }
    };
    seed("openai", 0.01, 500, 0);
    seed("anthropic", 0.05, 2000, 30);

    const res = await call(server.port, "/api/dashboard?period=24h", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.efficiency).toHaveLength(2);
    expect(data.efficiency[0]).toMatchObject({
      provider: "openai",
      sampleSize: 10,
      sufficient: true,
    });
    expect(data.cache).toEqual({
      cacheReadTokens: 300,
      hitRate: 0.6,
      inputTokens: 200,
    });
    // 洞察有界（成本 / 效率 / 缓存各至多一条），且都带依据、样本数与时间范围
    expect(data.insights).toHaveLength(3);
    for (const insight of data.insights) {
      expect(insight.evidence.length).toBeGreaterThan(0);
      expect(insight.sampleSize).toBeGreaterThan(0);
      expect(insight.period).toBe("24h");
    }
  });

  it("非法时间范围返回 400", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/dashboard?period=42y", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(400);
  });

  it("受控 fixture 下总览、排行、归因与效率口径一致", async () => {
    const { collector, server } = await start();
    const now = Date.now();
    // 受控 fixture：两个 provider/model 组合、两个项目，各 12 条带真实时间点的成功记录
    const combos = [
      {
        costPerRequest: 0.01,
        cwd: "/work/a",
        model: "gpt-4",
        provider: "openai",
        tokensCacheRead: 0,
        tokensInput: 100,
        tokensOutput: 50,
        totalMs: 500,
      },
      {
        costPerRequest: 0.05,
        cwd: "/work/b",
        model: "claude-3",
        provider: "anthropic",
        tokensCacheRead: 30,
        tokensInput: 70,
        tokensOutput: 20,
        totalMs: 2000,
      },
    ];
    for (const combo of combos) {
      for (let index = 0; index < 12; index += 1) {
        collector.record({
          completedAt: now + index + combo.totalMs,
          costCacheRead: 0,
          costCacheWrite: 0,
          costInput: combo.costPerRequest,
          costOutput: 0,
          costTotal: combo.costPerRequest,
          cwd: combo.cwd,
          firstTokenAt: now + index + 50,
          model: combo.model,
          provider: combo.provider,
          resultStatus: "stop",
          sessionId: "s1",
          source: "real_usage",
          startedAt: now + index,
          timestamp: now,
          tokensCacheRead: combo.tokensCacheRead,
          tokensCacheWrite: 0,
          tokensInput: combo.tokensInput,
          tokensOutput: combo.tokensOutput,
          toolCalls: 0,
        });
      }
    }

    const res = await call(server.port, "/api/dashboard?period=24h&dimension=project", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    const sum = (rows: Record<string, number>[], key: string): number =>
      rows.reduce((total, row) => total + row[key], 0);

    // 同一时间范围内：总览 = 排行（stats） = 项目归因，三个口径互相一致
    expect(data.overview.costTotal).toBeCloseTo(sum(data.stats, "costTotal"), 10);
    expect(data.overview.costTotal).toBeCloseTo(sum(data.attribution, "costTotal"), 10);
    expect(data.overview.totalTokens).toBe(sum(data.stats, "totalTokens"));
    expect(data.overview.totalTokens).toBe(sum(data.attribution, "tokens"));
    expect(data.overview.requestCount).toBe(sum(data.stats, "requestCount"));
    expect(data.overview.requestCount).toBe(sum(data.attribution, "requestCount"));
    expect(data.overview.projectCount).toBe(2);

    // 排行内的占比与单请求成本也按同一份合计算
    expect(sum(data.stats, "costShare")).toBeCloseTo(1, 10);
    const openai = data.stats.find(
      (row: Record<string, unknown>) => row.provider === "openai",
    );
    expect(openai.costPerRequest).toBeCloseTo(0.01, 10);

    // 缓存结构与统计同源：命中率 = cacheRead / (input + cacheRead)
    const cacheRead = sum(data.stats, "tokensCacheRead");
    const input = sum(data.stats, "tokensInput");
    expect(data.cache.cacheReadTokens).toBe(cacheRead);
    expect(data.cache.inputTokens).toBe(input);
    expect(data.cache.hitRate).toBeCloseTo(cacheRead / (input + cacheRead), 10);

    // 效率排行只统计带真实时间点的成功样本：两个组合各 12 条
    expect(data.efficiency).toHaveLength(2);
    expect(sum(data.efficiency, "sampleSize")).toBe(24);
    expect(
      data.efficiency.every(
        (row: Record<string, unknown>) =>
          row.sufficient === true && row.successRate === 1,
      ),
    ).toBe(true);

    // 洞察的样本数不超过本期请求数，时间范围与总览一致
    for (const insight of data.insights) {
      expect(insight.sampleSize).toBeLessThanOrEqual(data.overview.requestCount);
      expect(insight.period).toBe("24h");
    }
  });

  it("未知路由返回 404", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/unknown", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(404);
  });

  it("归因接口按维度返回聚合结果", async () => {
    const { collector, server } = await start();
    collector.record({
      costCacheRead: 0,
      costCacheWrite: 0,
      costInput: 0.01,
      costOutput: 0.02,
      costTotal: 0.03,
      cwd: "/work/app",
      model: "gpt-4o-mini",
      provider: "openai",
      sessionId: "s1",
      source: "real_usage",
      timestamp: Date.now(),
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      tokensInput: 10,
      tokensOutput: 5,
      toolCalls: 0,
    });

    const res = await call(
      server.port,
      "/api/attribution?period=24h&dimension=project",
      {
        headers: {
          authorization: `Bearer ${server.token}`,
        },
      },
    );

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.dimension).toBe("project");
    expect(data.rows).toEqual([
      {
        cacheHitRate: 0,
        costPerRequest: 0.03,
        costShare: 1,
        costTotal: 0.03,
        key: "/work/app",
        requestCount: 1,
        tokens: 15,
      },
    ]);
  });

  it("归因维度默认按项目，非法参数返回 400", async () => {
    const { server } = await start();
    const headers = {
      authorization: `Bearer ${server.token}`,
    };

    const byDefault = await call(server.port, "/api/attribution", {
      headers,
    });
    expect(byDefault.status).toBe(200);
    expect(JSON.parse(byDefault.body).dimension).toBe("project");

    const badPeriod = await call(server.port, "/api/attribution?period=99y", {
      headers,
    });
    expect(badPeriod.status).toBe(400);

    const badDimension = await call(server.port, "/api/attribution?dimension=nope", {
      headers,
    });
    expect(badDimension.status).toBe(400);
  });

  it("归因接口无凭据时返回 401", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/attribution");

    expect(res.status).toBe(401);
  });

  it("单供应商探测路由只探测该家", async () => {
    const { monitor, server } = await start();
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue([]);
    const all = vi.spyOn(monitor, "triggerAllProbes").mockResolvedValue([]);

    const res = await call(server.port, `/api/probes/${encodeURIComponent("[OI]")}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(200);
    // 无 ?model= 时传 undefined，triggerProbe 探测该供应商全部模型
    expect(single).toHaveBeenCalledWith("[OI]", undefined);
    expect(all).not.toHaveBeenCalled();
  });

  it("全部探测路由探测所有供应商", async () => {
    const { monitor, server } = await start();
    const all = vi.spyOn(monitor, "triggerAllProbes").mockResolvedValue([]);

    const res = await call(server.port, "/api/probes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledTimes(1);
  });
});

describe("供应商写接口", () => {
  /** 写请求必须来自本服务自身页面，凭据与 Origin 都带齐。 */
  function writeHeaders(server: DashboardServer): Record<string, string> {
    return {
      authorization: `Bearer ${server.token}`,
      "content-type": "application/json",
      origin: `http://127.0.0.1:${server.port}`,
    };
  }

  const VALID_BODY = {
    endpoint: "https://api.example.test/v1",
    name: "NewVendor",
    probeInterval: "10m",
    probeTimeout: 5000,
    models: [
      "m1",
      "m1",
      "m2",
    ],
  };

  it("合法保存写回配置：去重后的 models 可被解析，注释保留且有备份", async () => {
    const { server } = await start();
    const configPath = resolveConfigPath();
    writeFileSync(configPath, `# 用户注释\n${readFileSync(configPath, "utf8")}`);

    const res = await call(server.port, "/api/vendors/save", {
      body: JSON.stringify(VALID_BODY),
      headers: writeHeaders(server),
      method: "POST",
    });

    expect(res.status).toBe(200);
    const saved = JSON.parse(res.body) as {
      backupPath: string;
      ok: boolean;
    };
    expect(saved.ok).toBe(true);
    // 备份是写前快照：不该含新供应商
    expect(readFileSync(saved.backupPath, "utf8")).not.toContain("NewVendor");
    const written = readFileSync(configPath, "utf8");
    expect(written).toContain("# 用户注释");
    expect(loadConfig().vendors.find((v) => v.name === "NewVendor")?.models).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("缺少或伪造 Origin 的写请求被拒且零写盘", async () => {
    const { server } = await start();
    const configPath = resolveConfigPath();
    const before = readFileSync(configPath, "utf8");
    const withoutOrigin = {
      authorization: `Bearer ${server.token}`,
      "content-type": "application/json",
    };

    const missing = await call(server.port, "/api/vendors/save", {
      body: JSON.stringify(VALID_BODY),
      headers: withoutOrigin,
      method: "POST",
    });
    const forged = await call(server.port, "/api/vendors/save", {
      body: JSON.stringify(VALID_BODY),
      method: "POST",
      headers: {
        ...writeHeaders(server),
        origin: "https://evil.example",
      },
    });

    expect(missing.status).toBe(403);
    expect(forged.status).toBe(403);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("非法字段回 400 且零写盘（含明文密钥）", async () => {
    const { server } = await start();
    const configPath = resolveConfigPath();
    const before = readFileSync(configPath, "utf8");

    const noModels = await call(server.port, "/api/vendors/save", {
      body: JSON.stringify({
        ...VALID_BODY,
        models: [],
      }),
      headers: writeHeaders(server),
      method: "POST",
    });
    const plainKey = await call(server.port, "/api/vendors/save", {
      body: JSON.stringify({
        ...VALID_BODY,
        apiKey: "sk-plaintext",
      }),
      headers: writeHeaders(server),
      method: "POST",
    });

    expect(noModels.status).toBe(400);
    expect(plainKey.status).toBe(400);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("删除供应商写回配置，未知名字回 400", async () => {
    const { server } = await start();

    const gone = await call(server.port, "/api/vendors/delete", {
      body: JSON.stringify({
        name: "Anthropic",
      }),
      headers: writeHeaders(server),
      method: "POST",
    });
    const unknown = await call(server.port, "/api/vendors/delete", {
      body: JSON.stringify({
        name: "Nope",
      }),
      headers: writeHeaders(server),
      method: "POST",
    });

    expect(gone.status).toBe(200);
    expect(loadConfig().vendors.map((v) => v.name)).toEqual([
      "[OI]",
    ]);
    expect(unknown.status).toBe(400);
  });
});

describe("访问控制", () => {
  it("无凭据的数据请求被拒绝且不返回监控数据", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/dashboard");

    expect(res.status).toBe(401);
    expect(res.body).not.toContain("vendors");
  });

  it("错误凭据被拒绝", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/dashboard", {
      headers: {
        authorization: "Bearer wrong-token",
      },
    });

    expect(res.status).toBe(401);
  });

  it("Host 不匹配时拒绝请求", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/dashboard", {
      headers: {
        authorization: `Bearer ${server.token}`,
        host: "evil.example",
      },
    });

    expect(res.status).toBe(403);
    expect(res.body).not.toContain("vendors");
  });

  it("Origin 不匹配的探测请求被拒绝且不触发探测", async () => {
    const { monitor, server } = await start();
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue([]);
    const all = vi.spyOn(monitor, "triggerAllProbes").mockResolvedValue([]);

    const origin = await call(server.port, "/api/probes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        origin: "https://evil.example",
      },
    });
    const missing = await call(server.port, "/api/probes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(origin.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(all).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
  });

  it("未配置的供应商名不触发探测", async () => {
    const { monitor, server } = await start();
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue([]);

    const res = await call(server.port, "/api/probes/unknown-vendor", {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(404);
    expect(single).not.toHaveBeenCalled();
  });

  it("所有响应带安全头，凭据只放在 fragment", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/dashboard", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(String(res.headers["content-security-policy"])).toContain(
      "default-src 'none'",
    );
    expect(server.url).not.toContain("?");
  });
});

describe("服务生命周期", () => {
  it("重复关闭无副作用，端口被释放", async () => {
    const { server } = await start();
    const port = server.port;

    await server.close();
    await expect(server.close()).resolves.toBeUndefined();

    await expect(call(port, "/")).rejects.toThrow();
  });

  it("关闭后不再访问数据库", async () => {
    const { collector, server } = await start();
    const port = server.port;
    const stats = vi.spyOn(collector, "getStats");

    await server.close();
    await expect(
      call(port, "/api/dashboard", {
        headers: {
          authorization: `Bearer ${server.token}`,
        },
      }),
    ).rejects.toThrow();

    expect(stats).not.toHaveBeenCalled();
  });

  it("close() 在有限时间内完成，即使浏览器仍保持连接", async () => {
    const { server } = await start();
    // 建立一个 keep-alive 连接，模拟仍开着的页面
    const held = await call(server.port, "/");
    expect(held.status).toBe(200);

    const startedAt = Date.now();
    await server.close();
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });
});

describe("体检接口", () => {
  it("未授权返回 401", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/diagnostics");

    expect(res.status).toBe(401);
  });

  it("返回只读快照：配置路径、逐供应商检查与全局项", async () => {
    const { projectDir, server } = await start();
    const before = readFileSync(resolveConfigPath(), "utf8");
    const res = await call(server.port, "/api/diagnostics", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.configPath).toBe(resolveConfigPath());
    expect(data.configExists).toBe(true);
    expect(data.vendors).toHaveLength(2);
    expect(data.vendors[0].checks).toHaveLength(5);
    expect(data.global.cwd).toBe(projectDir);
    // 只读：查询不改动配置文件
    expect(readFileSync(resolveConfigPath(), "utf8")).toBe(before);
  });
});

describe("账户接口", () => {
  const AUTH = (token: string) => ({
    authorization: `Bearer ${token}`,
  });

  it("未授权时四个账户接口一律 401", async () => {
    const { server } = await start();
    const cases: [
      string,
      string,
    ][] = [
      [
        "GET",
        "/api/accounts",
      ],
      [
        "POST",
        "/api/accounts/sync",
      ],
      [
        "POST",
        "/api/accounts/manual",
      ],
      [
        "POST",
        "/api/accounts/authorize",
      ],
    ];

    for (const [method, path] of cases) {
      const res = await call(server.port, path, {
        method,
      });
      expect(res.status, path).toBe(401);
    }
  });

  it("写操作校验 Origin，跨源请求被拒", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/accounts/sync", {
      method: "POST",
      headers: {
        ...AUTH(server.token),
        origin: "http://evil.example",
      },
    });

    expect(res.status).toBe(403);
  });

  it("概览以配置为准，未同步时显示未知而不是 0", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/accounts", {
      headers: AUTH(server.token),
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.rows).toHaveLength(2);
    expect(data.overview.vendorCount).toBe(2);
    expect(data.overview.knownCount).toBe(0);
    expect(data.overview.balanceTotal).toBeNull();
    expect(data.overview.topupTotal).toBeNull();
    expect(data.rows[0].balance).toBeNull();
    expect(data.rows[0].syncedAt).toBeNull();
  });

  it("同步后单个供应商失败不影响其他行", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/accounts/sync", {
      method: "POST",
      headers: {
        ...AUTH(server.token),
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    const manualRow = data.rows.find(
      (row: { vendor: string }) => row.vendor === "[OI]",
    );
    const unknownRow = data.rows.find(
      (row: { vendor: string }) => row.vendor === "Anthropic",
    );
    expect(manualRow.source).toBe("manual");
    expect(manualRow.balance).toBe(10);
    expect(unknownRow.balance).toBeNull();
    expect(unknownRow.error).toContain("未配置任何余额来源");
    // 合计只算已知数字：手动手值计入，未知行不参与
    expect(data.overview.balanceTotal).toBe(10);
    expect(data.overview.manualCount).toBe(1);
    expect(data.overview.unknownCount).toBe(1);
  });

  it("手动填写写回配置文件并在响应里回显", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/accounts/manual", {
      body: JSON.stringify({
        balance: 5.5,
        vendor: "Anthropic",
      }),
      method: "POST",
      headers: {
        ...AUTH(server.token),
        "content-type": "application/json",
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(
      data.rows.find((row: { vendor: string }) => row.vendor === "Anthropic").balance,
    ).toBe(5.5);
    expect(readFileSync(resolveConfigPath(), "utf8")).toContain("manual: 5.5");
  });

  it("手动填写缺少字段时返回 400", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/accounts/manual", {
      body: JSON.stringify({
        vendor: "Anthropic",
      }),
      method: "POST",
      headers: {
        ...AUTH(server.token),
        "content-type": "application/json",
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(400);
  });

  it("未配置 OAuth 的供应商发起授权返回 400", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/accounts/authorize", {
      body: JSON.stringify({
        vendor: "[OI]",
      }),
      method: "POST",
      headers: {
        ...AUTH(server.token),
        "content-type": "application/json",
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body).toContain("未配置 OAuth 授权");
  });

  it("OAuth 回调豁免 Bearer，但 state 不匹配一律拒绝", async () => {
    const { server } = await start();
    const res = await call(server.port, "/oauth/callback?state=forged&code=abc");

    expect(res.status).toBe(400);
    expect(res.body).toContain("授权校验失败");
  });

  it("OAuth 回调缺少 code 时直接拒绝", async () => {
    const { server } = await start();
    const res = await call(server.port, "/oauth/callback?state=whatever");

    expect(res.status).toBe(400);
    expect(res.body).toContain("缺少 state 或 code");
  });
});
