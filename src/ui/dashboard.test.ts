import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UsageCollector } from "../collectors/usage-collector.ts";
import { VendorMonitor } from "../monitors/vendor-monitor.ts";
import { Database } from "../storage/database.ts";
import type { KumaConfig } from "../types.ts";
import { openDashboard } from "./dashboard.ts";

/** 记录 Node 侧回灌给页面的 JS 调用。 */
class FakeWindow extends EventEmitter {
  readonly scripts: string[] = [];
  closed = false;

  send(js: string): void {
    this.scripts.push(js);
  }

  setHTML(): void {}
  show(): void {}
  loadFile(): void {}
  close(): void {
    this.closed = true;
    this.emit("closed");
  }

  /** 最后一条 __kuma.render(...) 携带的数据。 */
  lastRender(): Record<string, unknown> | undefined {
    const call = [
      ...this.scripts,
    ]
      .reverse()
      .find((js) => js.startsWith("__kuma.render("));
    if (!call) {
      return undefined;
    }
    return JSON.parse(call.slice("__kuma.render(".length, -1));
  }
}

let lastWindow: FakeWindow;
let lastHtml = "";

vi.mock("glimpseui", () => ({
  getNativeHostInfo: () => ({
    buildHint: "",
    path: "/bin/echo",
    platform: "override",
  }),
  open: (html: string) => {
    lastHtml = html;
    lastWindow = new FakeWindow();
    return lastWindow;
  },
}));

const CONFIG: KumaConfig = {
  retention: {
    rawRecords: 7,
  },
  vendors: [
    {
      endpoint: "http://127.0.0.1:1/v1",
      model: "gpt-4o-mini",
      name: "OpenAI",
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

const cleanups: (() => void)[] = [];

function setup() {
  const database = new Database({
    dbPath: ":memory:",
  });
  const collector = new UsageCollector(database);
  const monitor = new VendorMonitor(database, CONFIG);
  cleanups.push(() => database.close());
  return {
    collector,
    monitor,
  };
}

beforeAll(() => {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "xpi-kuma-dash-"));
});

afterAll(() => {
  delete process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  vi.restoreAllMocks();
});

/** 打开面板，等 open() 被调用后返回句柄。 */
async function open(): Promise<{
  done: Promise<void>;
  monitor: VendorMonitor;
}> {
  const { collector, monitor } = setup();
  const done = openDashboard(collector, monitor, {
    period: "24h",
  });
  await vi.waitFor(() => {
    expect(lastWindow).toBeDefined();
  });
  return {
    done,
    monitor,
  };
}

describe("openDashboard 窗口参数", () => {
  it("用规范要求的尺寸与标题打开窗口", async () => {
    const { done } = await open();
    expect(lastHtml).toContain("xpi-kuma 监控面板");
    lastWindow.close();
    await done;
  });

  it("无供应商时仍会打开，并渲染提示文案", async () => {
    const database = new Database({
      dbPath: ":memory:",
    });
    cleanups.push(() => database.close());
    const collector = new UsageCollector(database);
    const monitor = new VendorMonitor(database, {
      vendors: [],
      retention: {
        rawRecords: 7,
      },
    });

    const done = openDashboard(collector, monitor);
    await vi.waitFor(() => {
      expect(lastWindow).toBeDefined();
    });
    expect(lastHtml).toContain("未配置任何供应商");
    lastWindow.close();
    await done;
  });
});

describe("时间范围切换", () => {
  it("收到 range 消息后回灌该范围的数据", async () => {
    const { done } = await open();

    lastWindow.emit("message", {
      period: "7d",
      type: "range",
    });

    await vi.waitFor(() => {
      expect(lastWindow.lastRender()).toBeDefined();
    });
    expect(lastWindow.lastRender()).toMatchObject({
      period: "7d",
    });
    lastWindow.close();
    await done;
  });

  it("忽略非法的时间范围，不改变当前状态", async () => {
    const { done } = await open();
    const before = lastWindow.scripts.length;

    lastWindow.emit("message", {
      period: "42y",
      type: "range",
    });
    lastWindow.emit("message", {
      period: 123,
      type: "range",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastWindow.scripts.length).toBe(before);
    lastWindow.close();
    await done;
  });
});

describe("刷新", () => {
  it("指定供应商时只探测该家", async () => {
    const { done, monitor } = await open();
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue(null);
    const all = vi.spyOn(monitor, "triggerAllProbes").mockResolvedValue([]);

    lastWindow.emit("message", {
      type: "refresh",
      vendor: "OpenAI",
    });

    await vi.waitFor(() => {
      expect(single).toHaveBeenCalledWith("OpenAI");
    });
    expect(all).not.toHaveBeenCalled();
    lastWindow.close();
    await done;
  });

  it("未指定供应商时探测全部", async () => {
    const { done, monitor } = await open();
    const single = vi.spyOn(monitor, "triggerProbe").mockResolvedValue(null);
    const all = vi.spyOn(monitor, "triggerAllProbes").mockResolvedValue([]);

    lastWindow.emit("message", {
      type: "refresh",
    });

    await vi.waitFor(() => {
      expect(all).toHaveBeenCalledTimes(1);
    });
    expect(single).not.toHaveBeenCalled();
    lastWindow.close();
    await done;
  });

  it("探测完成后回灌数据并解除按钮的忙碌态", async () => {
    const { done, monitor } = await open();
    vi.spyOn(monitor, "triggerProbe").mockResolvedValue(null);

    lastWindow.emit("message", {
      type: "refresh",
      vendor: "OpenAI",
    });

    await vi.waitFor(() => {
      expect(lastWindow.scripts.some((js) => js.startsWith("__kuma.clearBusy("))).toBe(
        true,
      );
    });
    expect(lastWindow.lastRender()).toBeDefined();
    lastWindow.close();
    await done;
  });

  it("探测抛错时把错误回灌给页面而不是崩溃", async () => {
    const { done, monitor } = await open();
    vi.spyOn(monitor, "triggerProbe").mockRejectedValue(new Error("boom"));

    lastWindow.emit("message", {
      type: "refresh",
      vendor: "OpenAI",
    });

    await vi.waitFor(() => {
      expect(lastWindow.scripts.some((js) => js.includes("__kuma.error("))).toBe(true);
    });
    lastWindow.close();
    await done;
  });
});

describe("窗口生命周期", () => {
  it("窗口关闭后 openDashboard 的 Promise 结束", async () => {
    const { done } = await open();
    lastWindow.close();
    await expect(done).resolves.toBeUndefined();
  });

  it("窗口报错只记日志，不影响后续消息处理", async () => {
    const { done, monitor } = await open();
    vi.spyOn(monitor, "triggerAllProbes").mockResolvedValue([]);

    lastWindow.emit("error", new Error("webview crashed"));
    lastWindow.emit("message", {
      type: "refresh",
    });

    await vi.waitFor(() => {
      expect(monitor.triggerAllProbes).toHaveBeenCalled();
    });
    lastWindow.close();
    await done;
  });
});
