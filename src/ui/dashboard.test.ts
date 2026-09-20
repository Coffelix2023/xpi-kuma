import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UsageCollector } from "../collectors/usage-collector.ts";
import { VendorMonitor } from "../monitors/vendor-monitor.ts";
import { Database } from "../storage/database.ts";
import type { KumaConfig } from "../types.ts";
import { type DashboardServer, startDashboardServer } from "./dashboard.ts";

const CONFIG: KumaConfig = {
  retention: {
    rawRecords: 7,
  },
  vendors: [
    {
      endpoint: "http://127.0.0.1:1/v1",
      model: "gpt-4o-mini",
      name: "[OI]",
      probe: {
        enabled: true,
        interval: "5m",
        timeout: 1000,
      },
    },
    {
      endpoint: "http://127.0.0.1:1/v1",
      model: "claude-3",
      name: "Anthropic",
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
    req.end();
  });
}

async function start(): Promise<{
  collector: UsageCollector;
  monitor: VendorMonitor;
  server: DashboardServer;
}> {
  const database = new Database({
    dbPath: ":memory:",
  });
  const collector = new UsageCollector(database);
  const monitor = new VendorMonitor(database, CONFIG);
  cleanups.push(() => database.close());
  const server = await startDashboardServer(collector, monitor, {
    chartCdn: null,
  });
  servers.push(server);
  return {
    collector,
    monitor,
    server,
  };
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

  it("未知路由返回 404", async () => {
    const { server } = await start();
    const res = await call(server.port, "/api/unknown", {
      headers: {
        authorization: `Bearer ${server.token}`,
      },
    });

    expect(res.status).toBe(404);
  });

  it("单供应商探测路由只探测该家", async () => {
    const { monitor, server } = await start();
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue(null);
    const all = vi.spyOn(monitor, "triggerAllProbes").mockResolvedValue([]);

    const res = await call(server.port, `/api/probes/${encodeURIComponent("[OI]")}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.token}`,
        origin: `http://127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(200);
    expect(single).toHaveBeenCalledWith("[OI]");
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
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue(null);
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
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue(null);

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
