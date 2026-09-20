import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dashboardClientScript,
  NO_VENDOR_NOTICE,
  POLL_INTERVAL_MS,
  preferenceBootstrapScript,
} from "./dashboard-client.ts";

/**
 * 极简假 DOM：只实现页内脚本真正用到的那部分接口。
 *
 * 脚本是注入到页面里的字符串，只有把它放进一个 DOM 里执行，测到的才是真正
 * 会跑在浏览器中的那份代码。这里不引入 jsdom，避免为一个测试新增依赖。
 */

type Listener = (event: unknown) => void;

/** 类名与选择器都按空白切分。 */
const WHITESPACE = /\s+/;

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  className = "";
  colSpan = 0;
  clientWidth = 0;
  disabled = false;
  hidden = false;
  id = "";
  readonly tagName: string;
  type = "";
  private own = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    if (this.children.length === 0) {
      return this.own;
    }
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.own = value;
    this.children.length = 0;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") {
      this.id = value;
    }
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, handler: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  click(): void {
    for (const handler of this.listeners.get("click") ?? []) {
      handler({});
    }
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [
      child,
      ...child.descendants(),
    ]);
  }
}

function matches(node: FakeElement, simple: string): boolean {
  if (simple.startsWith(".")) {
    return node.className.split(WHITESPACE).includes(simple.slice(1));
  }
  if (simple.startsWith("[")) {
    const [name, quoted] = simple.slice(1, -1).split("=");
    if (!node.attributes.has(name)) {
      return false;
    }
    // 只支持 `[attr]` 与 `[attr="value"]` 两种写法，够用即可
    return quoted === undefined || node.attributes.get(name) === quoted.slice(1, -1);
  }
  return node.tagName === simple.toUpperCase();
}

function queryAll(root: FakeElement, selector: string): FakeElement[] {
  let current = [
    root,
  ];
  for (const part of selector.trim().split(WHITESPACE)) {
    current = current.flatMap((node) =>
      node.descendants().filter((child) => matches(child, part)),
    );
  }
  return current;
}

class FakeDocument {
  readonly body = new FakeElement("body");
  readonly root = new FakeElement("html");
  hidden = false;
  private readonly byId = new Map<string, FakeElement>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor() {
    this.root.appendChild(this.body);
  }

  get documentElement(): FakeElement {
    return this.root;
  }

  add(tagName: string, id = ""): FakeElement {
    const node = new FakeElement(tagName);
    if (id) {
      node.id = id;
      node.setAttribute("id", id);
      this.byId.set(id, node);
    }
    this.body.appendChild(node);
    return node;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  getElementById(id: string): FakeElement | null {
    return this.byId.get(id) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return queryAll(this.body, selector);
  }

  addEventListener(type: string, handler: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  /** 切换标签页可见性并派发 visibilitychange。 */
  setHidden(value: boolean): void {
    this.hidden = value;
    for (const handler of this.listeners.get("visibilitychange") ?? []) {
      handler({});
    }
  }
}

/** 与 `generateDashboardHTML()` 产出的 shell 结构一致的最小 DOM。 */
function shell(): FakeDocument {
  const doc = new FakeDocument();
  doc.root.setAttribute("data-theme", "dark");
  doc.add("div", "kuma-updated");
  doc.add("div", "kuma-vendors");
  doc.add("div", "kuma-notice");
  doc.add("div", "kuma-stats");
  doc.add("div", "kuma-chart");
  doc.add("button", "kuma-refresh-all");
  doc.add("button", "kuma-theme");
  doc.add("button", "kuma-family");
  for (const period of [
    "1h",
    "24h",
    "7d",
    "30d",
  ]) {
    doc.add("button").setAttribute("data-range", period);
  }
  return doc;
}

function vendor(overrides: Record<string, unknown> = {}) {
  return {
    lastProbeTime: null,
    model: "gpt-4o-mini",
    name: "[OI]",
    price: null,
    status: "up",
    totalTime: 120,
    ttft: 40,
    ...overrides,
  };
}

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: 1_700_000_000_000,
    period: "24h",
    stats: [],
    trend: [],
    vendors: [
      vendor(),
    ],
    ...overrides,
  };
}

function respond(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    json: () => Promise.resolve(body),
    status,
  });
}

interface Harness {
  doc: FakeDocument;
  fetchMock: ReturnType<typeof vi.fn>;
  hash: () => string;
  replaceState: ReturnType<typeof vi.fn>;
  start: (script?: string) => void;
  storage: Map<string, string>;
}

function harness(hash = "#token-abc"): Harness {
  const doc = shell();
  const fetchMock = vi.fn();
  const location = {
    hash,
    pathname: "/",
  };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    location.hash = "";
    location.pathname = url;
  });
  /** 假 localStorage：偏好读写的唯一去处，测试据此断言持久化。 */
  const storage = new Map<string, string>();
  const localStorageStub = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  const windowObject = {
    clearInterval,
    history: {
      replaceState,
    },
    location,
    setInterval,
  };
  return {
    doc,
    fetchMock,
    hash: () => location.hash,
    replaceState,
    storage,
    start(script = dashboardClientScript()) {
      // 用真实脚本源码构造函数，测的就是浏览器里跑的那份代码
      const factory = new Function(
        "window",
        "document",
        "fetch",
        "getComputedStyle",
        "localStorage",
        script,
      );
      factory(
        windowObject,
        doc,
        fetchMock,
        () => ({
          getPropertyValue: () => "#000000",
        }),
        localStorageStub,
      );
    },
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("凭据引导", () => {
  it("从 fragment 读取凭据后立即清除地址栏", () => {
    const h = harness("#secret-token");
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();

    expect(h.replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(h.hash()).toBe("");
  });

  it("数据请求带 Authorization 头，默认时间范围 24h", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();

    const [path, init] = h.fetchMock.mock.calls[0];
    expect(path).toBe("/api/dashboard?period=24h");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
  });

  it("缺少凭据时不发请求，只提示重新执行命令", () => {
    const h = harness("");

    h.start();

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("缺少访问凭据");
  });
});

describe("时间范围与探测", () => {
  it("点击时间范围按钮后按新范围重新查询", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    h.fetchMock.mockClear();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          period: "7d",
        }),
      ),
    );

    h.doc.querySelectorAll('[data-range="7d"]')[0].click();
    await flush();

    expect(h.fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/dashboard?period=7d");
    expect(
      h.doc.querySelectorAll('[data-range="7d"]')[0].getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      h.doc.querySelectorAll('[data-range="24h"]')[0].getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("全部刷新按钮探测所有供应商后再取数据", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    h.fetchMock.mockClear();

    h.doc.getElementById("kuma-refresh-all")?.click();
    await flush();

    const [path, init] = h.fetchMock.mock.calls[0];
    expect(path).toBe("/api/probes");
    expect(init.method).toBe("POST");
    expect(h.fetchMock.mock.calls[1][0]).toBe("/api/dashboard?period=24h");
  });

  it("卡片刷新按钮只探测该供应商", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    h.fetchMock.mockClear();

    const buttons = h.doc.querySelectorAll(".kuma-card-foot button");
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    await flush();

    expect(h.fetchMock.mock.calls[0][0]).toBe(
      `/api/probes/${encodeURIComponent("[OI]")}`,
    );
    expect(h.fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("探测完成后按钮恢复可用", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    const all = h.doc.getElementById("kuma-refresh-all");
    all?.click();
    expect(all?.disabled).toBe(true);

    await flush();
    expect(all?.disabled).toBe(false);
    expect(all?.textContent).toBe("全部刷新");
  });
});

describe("错误状态", () => {
  it("请求失败时保留已渲染数据，只更新状态文案", async () => {
    const h = harness();
    h.fetchMock.mockReturnValueOnce(respond(dashboard()));

    h.start();
    await flush();
    const rendered = h.doc.getElementById("kuma-vendors")?.textContent;
    expect(rendered).toContain("[OI]");

    h.fetchMock.mockReturnValueOnce(respond({}, 500));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("连接失败");
    expect(h.doc.getElementById("kuma-vendors")?.textContent).toBe(rendered);
    expect(h.doc.getElementById("kuma-refresh-all")?.disabled).toBe(false);
  });

  it("无供应商时显示可操作提示", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          vendors: [],
        }),
      ),
    );

    h.start();
    await flush();

    const notice = h.doc.getElementById("kuma-notice");
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toBe(NO_VENDOR_NOTICE);
  });

  it("有供应商时提示保持隐藏", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();

    expect(h.doc.getElementById("kuma-notice")?.hidden).toBe(true);
  });
});

describe("自动轮询", () => {
  it("新数据在一个轮询周期内反映到面板", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(1);

    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          vendors: [
            vendor(),
            vendor({
              name: "Anthropic",
            }),
          ],
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.doc.getElementById("kuma-vendors")?.textContent).toContain("Anthropic");
  });

  it("页面不可见时暂停轮询", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    h.doc.setHidden(true);
    h.fetchMock.mockClear();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);

    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("恢复可见时立即刷新再恢复轮询", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    h.doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    h.fetchMock.mockClear();

    h.doc.setHidden(false);
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("请求未返回时不叠加并发请求，也不重试", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(new Promise(() => {}));

    h.start();
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * 用最小假 DOM 执行首帧偏好脚本。
 *
 * 这段脚本只碰 `document.documentElement` 与 `localStorage`，所以不必搭整套 shell；
 * 直接给它一个根元素与一个存储即可，测到的仍是浏览器里跑的那份源码。
 */
function runBootstrap(
  script: string,
  root: FakeElement,
  storage:
    | Map<string, string>
    | {
        getItem: (key: string) => string | null;
      },
): void {
  const localStorageStub =
    storage instanceof Map
      ? {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storage.set(key, value);
          },
        }
      : storage;
  const factory = new Function("document", "localStorage", script);
  factory(
    {
      documentElement: root,
    },
    localStorageStub,
  );
}

describe("主题与家族偏好", () => {
  it("切换家族写入偏好，重开页面时被首帧脚本应用", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const btn = h.doc.getElementById("kuma-family");
    expect(btn).not.toBeNull();
    btn?.click();
    expect(h.doc.documentElement.getAttribute("data-family")).toBe("atlas");
    expect(h.storage.get("kuma.family")).toBe("atlas");

    // 模拟刷新后重新打开：拿持久化的偏好跑一次首帧脚本
    const reopened = new FakeElement("html");
    reopened.setAttribute("data-theme", "dark");
    runBootstrap(preferenceBootstrapScript(), reopened, h.storage);
    expect(reopened.getAttribute("data-family")).toBe("atlas");
  });

  it("再次点击切回默认家族并移除属性", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const btn = h.doc.getElementById("kuma-family");
    btn?.click();
    btn?.click();
    expect(h.doc.documentElement.getAttribute("data-family")).toBeNull();
    expect(h.storage.get("kuma.family")).toBe("default");
  });

  it("切换明暗写入偏好，按钮文案跟随", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const btn = h.doc.getElementById("kuma-theme");
    expect(btn?.textContent).toBe("亮色");
    btn?.click();
    expect(h.doc.documentElement.getAttribute("data-theme")).toBe("light");
    expect(h.storage.get("kuma.theme")).toBe("light");
    expect(btn?.textContent).toBe("暗色");
  });

  it("家族按钮的 aria-pressed 反映当前家族", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const btn = h.doc.getElementById("kuma-family");
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
    btn?.click();
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    expect(btn?.textContent).toBe("默认风");
  });
});

describe("趋势图内联 SVG", () => {
  it("有数据时渲染出 SVG 折线与悬停详情", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          trend: [
            {
              bucketStart: 1_700_000_000_000,
              cost: 0.1,
              tokens: 10,
              byProvider: {
                "[OI]": 0.1,
              },
            },
            {
              bucketStart: 1_700_000_060_000,
              cost: 0.2,
              tokens: 20,
              byProvider: {
                "[OI]": 0.2,
              },
            },
          ],
        }),
      ),
    );
    h.start();
    await flush();

    const host = h.doc.getElementById("kuma-chart");
    const tags = host?.descendants().map((node) => node.tagName);
    expect(tags).toContain("SVG");
    expect(tags).toContain("POLYLINE");
    expect(tags).toContain("TITLE");
  });

  it("空数据时不渲染图表也不抛错", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          trend: [],
        }),
      ),
    );
    h.start();
    await flush();

    const host = h.doc.getElementById("kuma-chart");
    expect(host?.textContent).toBe("");
  });
});
