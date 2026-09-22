import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Database } from "../storage/database.ts";
import type { KumaConfig, VendorConfig } from "../types.ts";
import { parseInterval, VendorMonitor } from "./vendor-monitor.ts";

const cleanups: (() => void)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

/**
 * 启动一个最小的 SSE 服务端。
 *
 * `mode` 控制行为：正常流式、非 200、或挂起到超时。
 */
async function startProbeServer(
  mode: "ok" | "error" | "hang" | "reasoning" | "empty",
  ttftDelayMs = 5,
): Promise<{
  endpoint: string;
  received: unknown[];
}> {
  const received: unknown[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push(JSON.parse(body));
      if (mode === "error") {
        res.writeHead(500).end("boom");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
      });
      if (mode === "hang") {
        return;
      }
      // DeepSeek 等供应商把首字放在 reasoning_content
      const first = {
        choices: [
          {
            delta:
              mode === "reasoning"
                ? {
                    reasoning_content: "think",
                  }
                : mode === "empty"
                  ? {
                      content: "",
                    }
                  : {
                      content: "h",
                    },
          },
        ],
      };
      setTimeout(() => {
        res.write(`data: ${JSON.stringify(first)}\n\n`);
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {},
              },
            ],
            usage: {
              completion_tokens: 1,
              prompt_tokens: 2,
            },
          })}\n\n`,
        );
        res.end("data: [DONE]\n\n");
      }, ttftDelayMs);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return {
    endpoint: `http://127.0.0.1:${port}/v1`,
    received,
  };
}

function vendor(overrides: Partial<VendorConfig> = {}): VendorConfig {
  return {
    endpoint: "http://127.0.0.1:1/v1",
    model: "gpt-4o-mini",
    name: "OpenAI",
    probe: {
      enabled: true,
      interval: "5m",
      timeout: 30_000,
    },
    ...overrides,
  };
}

function config(vendors: VendorConfig[]): KumaConfig {
  return {
    dashboard: {
      port: 5180,
    },
    retention: {
      rawRecords: 7,
    },
    vendors,
  };
}

function setup(vendors: VendorConfig[]) {
  const database = new Database({
    dbPath: ":memory:",
  });
  cleanups.push(() => database.close());
  return {
    database,
    monitor: new VendorMonitor(database, config(vendors)),
  };
}

describe("parseInterval", () => {
  it("解析分钟与小时", () => {
    expect(parseInterval("5m")).toBe(300_000);
    expect(parseInterval("1h")).toBe(3_600_000);
    expect(parseInterval("30s")).toBe(30_000);
  });

  it("非法格式抛错", () => {
    expect(() => parseInterval("5 minutes")).toThrow(/无法解析/);
  });
});

describe("VendorMonitor 定时任务", () => {
  it("只为启用探测的供应商创建定时器", () => {
    const { monitor } = setup([
      vendor({
        name: "OpenAI",
      }),
      vendor({
        name: "9router",
        probe: {
          enabled: false,
          interval: "5m",
          timeout: 1000,
        },
      }),
      vendor({
        name: "Anthropic",
      }),
    ]);

    monitor.start();
    expect(monitor.activeTimerCount).toBe(2);

    monitor.stop();
    expect(monitor.activeTimerCount).toBe(0);
  });

  it("stop() 后再次 stop() 无副作用", () => {
    const { monitor } = setup([
      vendor(),
    ]);
    monitor.start();
    monitor.stop();
    monitor.stop();
    expect(monitor.activeTimerCount).toBe(0);
  });

  it("start() 后到点会自动探测并落库", async () => {
    const { endpoint } = await startProbeServer("ok");
    const { database, monitor } = setup([
      vendor({
        endpoint,
        probe: {
          enabled: true,
          interval: "1s",
          timeout: 5000,
        },
      }),
    ]);

    monitor.start();
    try {
      await vi.waitFor(
        () => {
          expect(database.getProbeHistory("OpenAI", 1)).toHaveLength(1);
        },
        {
          timeout: 4000,
        },
      );
      expect(database.getProbeHistory("OpenAI", 1)[0].status).toBe("up");
    } finally {
      monitor.stop();
    }
  });
});

describe("probeVendor", () => {
  it("探测成功时记录 TTFT、总时间与 token 用量", async () => {
    const { endpoint, received } = await startProbeServer("ok", 20);
    const { database, monitor } = setup([
      vendor({
        endpoint,
      }),
    ]);

    const result = await monitor.probeVendor(
      vendor({
        endpoint,
      }),
    );

    expect(result.status).toBe("up");
    expect(result.ttft).toBeGreaterThanOrEqual(15);
    expect(result.totalTime).toBeGreaterThanOrEqual(result.ttft ?? 0);
    expect(result.tokensInput).toBe(2);
    expect(result.tokensOutput).toBe(1);
    expect(result.error).toBeNull();
    expect(received).toHaveLength(1);
    // 最小化探测成本：固定 prompt + max_tokens=1
    expect(received[0]).toMatchObject({
      max_tokens: 1,
      messages: [
        {
          content: "hi",
          role: "user",
        },
      ],
    });
    expect(database.getUsageStats("1h")).toEqual([]);
  });

  it("首字来自 reasoning_content 时仍判定为 up（DeepSeek 回归）", async () => {
    const { endpoint } = await startProbeServer("reasoning", 20);
    const { monitor } = setup([
      vendor({
        endpoint,
      }),
    ]);

    const result = await monitor.probeVendor(
      vendor({
        endpoint,
      }),
    );

    expect(result.status).toBe("up");
    expect(result.ttft).toBeGreaterThanOrEqual(15);
  });

  it("max_tokens=1 空内容流判定为 up、TTFT 为未知（Mimo 回归）", async () => {
    const { endpoint } = await startProbeServer("empty", 20);
    const { monitor } = setup([
      vendor({
        endpoint,
      }),
    ]);

    const result = await monitor.probeVendor(
      vendor({
        endpoint,
      }),
    );

    expect(result.status).toBe("up");
    expect(result.error).toBeNull();
    expect(result.ttft).toBeNull();
    expect(result.totalTime).toBeGreaterThanOrEqual(0);
  });

  it("HTTP 错误标记为 down 且指标为 null", async () => {
    const { endpoint } = await startProbeServer("error");
    const { monitor } = setup([
      vendor({
        endpoint,
      }),
    ]);

    const result = await monitor.probeVendor(
      vendor({
        endpoint,
      }),
    );

    expect(result).toMatchObject({
      error: "HTTP 500",
      status: "down",
      totalTime: null,
      ttft: null,
    });
  });

  it("超时标记为 down，并落库一条记录", async () => {
    const { endpoint } = await startProbeServer("hang");
    const { database, monitor } = setup([
      vendor({
        endpoint,
      }),
    ]);
    const hanging = vendor({
      endpoint,
      probe: {
        enabled: true,
        interval: "5m",
        timeout: 80,
      },
    });

    const result = await monitor.probeVendor(hanging);

    expect(result).toMatchObject({
      error: "timeout",
      status: "down",
      totalTime: null,
      ttft: null,
    });
    database.insertProbeRecord(result);
    expect(database.getProbeHistory("OpenAI", 1)[0].status).toBe("down");
  });

  it("无法连接的 endpoint 标记为 down 而不抛错", async () => {
    const { monitor } = setup([
      vendor({
        endpoint: "http://127.0.0.1:1/v1",
      }),
    ]);
    const result = await monitor.probeVendor(
      vendor({
        endpoint: "http://127.0.0.1:1/v1",
      }),
    );
    expect(result.status).toBe("down");
    expect(result.error).toBeTruthy();
  });
});

describe("triggerProbe", () => {
  it("立即探测指定供应商并落库", async () => {
    const { endpoint } = await startProbeServer("ok");
    const { database, monitor } = setup([
      vendor({
        endpoint,
      }),
    ]);

    const result = await monitor.triggerProbe("OpenAI");

    expect(result?.status).toBe("up");
    expect(database.getProbeHistory("OpenAI", 5)).toHaveLength(1);
  });

  it("未知供应商返回 null", async () => {
    const { monitor } = setup([
      vendor(),
    ]);
    expect(await monitor.triggerProbe("不存在")).toBeNull();
  });
});

describe("getVendorStatus", () => {
  it("返回 status、ttft、totalTime 等字段", async () => {
    const { endpoint } = await startProbeServer("ok");
    const { monitor } = setup([
      vendor({
        endpoint,
        name: "OpenAI",
        price: {
          input: 0.15,
          output: 0.6,
        },
      }),
      vendor({
        name: "9router",
      }),
    ]);

    await monitor.triggerProbe("OpenAI");
    const statuses = monitor.getVendorStatus();

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({
      model: "gpt-4o-mini",
      name: "OpenAI",
      status: "up",
      price: {
        input: 0.15,
        output: 0.6,
      },
    });
    expect(statuses[0].ttft).toBeGreaterThanOrEqual(0);
    expect(statuses[0].totalTime).toBeGreaterThanOrEqual(0);
    expect(statuses[0].lastProbeTime).toBeGreaterThan(0);
  });

  it("从未探测的供应商状态为 unknown", () => {
    const { monitor } = setup([
      vendor(),
    ]);
    const [status] = monitor.getVendorStatus();
    expect(status).toMatchObject({
      lastProbeTime: null,
      status: "unknown",
      totalTime: null,
      ttft: null,
    });
  });

  it("最近一次失败不清空最近一次成功的性能指标", async () => {
    const { endpoint } = await startProbeServer("ok");
    const { database, monitor } = setup([
      vendor({
        endpoint,
      }),
    ]);
    const healthy = vendor({
      endpoint,
    });
    const failing = vendor({
      endpoint: "http://127.0.0.1:1/v1",
    });

    const ok = await monitor.probeVendor(healthy);
    database.insertProbeRecord(ok);
    const down = await monitor.probeVendor(failing);
    database.insertProbeRecord(down);

    const [status] = monitor.getVendorStatus();
    expect(status.status).toBe("down");
    expect(status.ttft).toBe(ok.ttft);
  });
});
