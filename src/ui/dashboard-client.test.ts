import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "./client/messages.ts";
import {
  accountsClientScript,
  dashboardClientScript,
  emptyClientScript,
  POLL_INTERVAL_MS,
  preferenceBootstrapScript,
  settingsClientScript,
  sharedClientScript,
} from "./dashboard-client.ts";

/** 中文全角标点：英文界面里出现它们就说明标点没走字典。 */
const CJK_PUNCTUATION = /[（）。，；：]/;

/** 汉字：英文界面里出现它们就说明那段文案没走字典。 */
const CJK_IDEOGRAPHS = /[\u4e00-\u9fff]/;

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

  /** 分区索引轨点击后调用；只记录是否被滚动，不做真实布局。 */
  scrolled = false;

  scrollIntoView(): void {
    this.scrolled = true;
  }

  click(): void {
    for (const handler of this.listeners.get("click") ?? []) {
      // 页面脚本会对 rail 链接调用 event.preventDefault()
      handler({
        preventDefault: () => {},
      });
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
  title = "";
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
/** 与 `generateSettingsHTML()` 产出的 shell 结构一致的最小 DOM（体检页用）。 */
function settingsShell(): FakeDocument {
  const doc = new FakeDocument();
  doc.root.setAttribute("data-theme", "dark");
  doc.add("div", "kuma-updated");
  const errorSection = doc.add("section", "section-diagnostics-error");
  errorSection.hidden = true;
  doc.add("div", "kuma-diagnostics-error");
  doc.add("section", "section-diagnostics");
  doc.add("div", "kuma-diagnostics");
  doc.add("section", "section-diagnostics-vendors");
  doc.add("div", "kuma-diagnostics-vendors");
  doc.add("span", "kuma-issues");
  doc.add("section", "section-diagnostics-global");
  doc.add("div", "kuma-diagnostics-global");
  doc.add("button", "kuma-reload");
  const navLink = doc.add("a");
  navLink.setAttribute("data-kuma-nav", "/");
  navLink.setAttribute("href", "/");
  return doc;
}

/** 与 `generateEmptyHTML()` 产出的 shell 结构一致的最小 DOM（引导页用）。 */
function emptyShell(): FakeDocument {
  const doc = new FakeDocument();
  doc.root.setAttribute("data-theme", "dark");
  doc.add("div", "kuma-updated");
  const vendorsSection = doc.add("section", "section-guide-vendors");
  vendorsSection.hidden = true;
  doc.add("section", "section-guide-data");
  doc.add("div", "kuma-guide-status");
  const navLink = doc.add("a");
  navLink.setAttribute("data-kuma-nav", "/");
  navLink.setAttribute("href", "/");
  return doc;
}

/** 与 `generateAccountsHTML()` 产出的 shell 结构一致的最小 DOM（账户页用）。 */
function accountsShell(): FakeDocument {
  const doc = new FakeDocument();
  doc.root.setAttribute("data-theme", "dark");
  doc.add("div", "kuma-updated");
  doc.add("div", "kuma-accounts");
  doc.add("div", "kuma-accounts-notice");
  doc.add("div", "kuma-account-rows");
  doc.add("button", "kuma-sync");
  const navLink = doc.add("a");
  navLink.setAttribute("data-kuma-nav", "/");
  navLink.setAttribute("href", "/");
  return doc;
}

function shell(): FakeDocument {
  const doc = new FakeDocument();
  doc.root.setAttribute("data-theme", "dark");
  doc.add("div", "kuma-updated");
  doc.add("div", "kuma-overview");
  doc.add("div", "kuma-overview-notice");
  doc.add("div", "kuma-attribution");
  doc.add("div", "kuma-vendors");
  doc.add("div", "kuma-notice");
  doc.add("div", "kuma-stats");
  doc.add("div", "kuma-chart");
  doc.add("button", "kuma-refresh-all");
  doc.add("button", "kuma-theme");
  doc.add("button", "kuma-family");
  const navLink = doc.add("a");
  navLink.setAttribute("data-kuma-nav", "/accounts");
  navLink.setAttribute("href", "/accounts");
  for (const dimension of [
    "project",
    "session",
    "vendorModel",
  ]) {
    doc.add("button").setAttribute("data-dimension", dimension);
  }
  // 分区索引轨：区块与轨链接成对，覆盖滚动定位与 aria-current 更新
  for (const sectionId of [
    "section-overview",
    "section-vendors",
  ]) {
    doc.add("div", sectionId);
    const railLink = doc.add("a");
    railLink.setAttribute("data-rail-target", sectionId);
  }
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
    attribution: [],
    dimension: "project",
    generatedAt: 1_700_000_000_000,
    period: "24h",
    stats: [],
    trend: [],
    overview: {
      costTotal: 0,
      projectCount: 0,
      requestCount: 0,
      totalTokens: 0,
    },
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

function harness(hash = "#token-abc", makeShell = shell): Harness {
  const doc = makeShell();
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
    expect(path).toBe("/api/dashboard?period=24h&dimension=project");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
  });

  it("缺少凭据时不发请求，只提示重新执行命令", () => {
    const h = harness("");

    h.start();

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("缺少访问凭据");
  });
});

describe("花费概览与用量归因", () => {
  it("概览渲染本期花费、token、请求数与覆盖项目数", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          overview: {
            costTotal: 12.5,
            projectCount: 3,
            requestCount: 7,
            totalTokens: 1234,
          },
        }),
      ),
    );

    h.start();
    await flush();

    const host = h.doc.getElementById("kuma-overview");
    expect(host?.textContent).toContain("本期花费");
    expect(host?.textContent).toContain("¥12.50");
    expect(host?.textContent).toContain("1234");
    expect(host?.textContent).toContain("覆盖项目数");
    expect(h.doc.getElementById("kuma-overview-notice")?.hidden).toBe(true);
  });

  it("本期没有记录时提示并给出去引导页的入口", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();

    const notice = h.doc.getElementById("kuma-overview-notice");
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain("还没有使用量记录");
    const guide = h.doc
      .querySelectorAll("[data-kuma-nav]")
      .find((link) => link.getAttribute("data-kuma-nav") === "/empty");
    // 站内链接同样带上本次凭据 fragment
    expect(guide?.getAttribute("href")).toBe("/empty#token-abc");
  });

  it("归因表按花费算占比，空键显示未知", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          attribution: [
            {
              costTotal: 3,
              key: "/tmp/a",
              requestCount: 2,
              tokens: 30,
            },
            {
              costTotal: 1,
              key: "",
              requestCount: 1,
              tokens: 10,
            },
          ],
          overview: {
            costTotal: 4,
            projectCount: 1,
            requestCount: 3,
            totalTokens: 40,
          },
        }),
      ),
    );

    h.start();
    await flush();

    const host = h.doc.getElementById("kuma-attribution");
    expect(host?.textContent).toContain("75.0%");
    expect(host?.textContent).toContain("25.0%");
    expect(host?.textContent).toContain("未知");
  });

  it("切换归因维度后按新维度重查", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();
    h.fetchMock.mockClear();

    const buttons = h.doc.querySelectorAll("[data-dimension]");
    const session = buttons.find(
      (btn) => btn.getAttribute("data-dimension") === "session",
    );
    session?.click();
    await flush();

    expect(h.fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "/api/dashboard?period=24h&dimension=session",
    );
    expect(session?.getAttribute("aria-pressed")).toBe("true");
    expect(
      h.doc
        .querySelectorAll('[data-dimension="project"]')[0]
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("归因无数据时显示暂无数据，不渲染空表", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();

    const host = h.doc.getElementById("kuma-attribution");
    expect(host?.children).toHaveLength(1);
    // 假 DOM 的 textContent 只聚合子节点，这里断言引导入口本身
    // 空表换成引导入口：主面板无记录时要把用户送去引导页
    const guide = h.doc
      .querySelectorAll("[data-kuma-nav]")
      .find((link) => link.getAttribute("data-kuma-nav") === "/empty");
    expect(guide?.getAttribute("href")).toBe("/empty#token-abc");
  });
});

describe("分区索引轨", () => {
  it("点击滚动到对应区块并更新 aria-current", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const links = h.doc.querySelectorAll("[data-rail-target]");
    expect(links).toHaveLength(2);
    links[1].click();

    expect(h.doc.getElementById("section-vendors")?.scrolled).toBe(true);
    expect(links[1].getAttribute("aria-current")).toBe("location");
    expect(links[0].getAttribute("aria-current")).toBeNull();
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

    expect(h.fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "/api/dashboard?period=7d&dimension=project",
    );
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
    expect(h.fetchMock.mock.calls[1][0]).toBe(
      "/api/dashboard?period=24h&dimension=project",
    );
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
    expect(notice?.textContent).toBe(MESSAGES["vendor.noVendor"]?.zh);
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

describe("站内导航与缺凭据提示", () => {
  it("有凭据时给站内链接补上 fragment", async () => {
    const h = harness("#secret-token");
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const link = h.doc
      .querySelectorAll("[data-kuma-nav]")
      .find((node) => node.getAttribute("data-kuma-nav") === "/accounts");
    expect(link?.getAttribute("href")).toBe("/accounts#secret-token");
  });

  it("主面板无凭据时提示重新执行命令，且不改链接", () => {
    const h = harness("");
    h.start();

    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("缺少访问凭据");
    const link = h.doc
      .querySelectorAll("[data-kuma-nav]")
      .find((node) => node.getAttribute("data-kuma-nav") === "/accounts");
    expect(link?.getAttribute("href")).toBe("/accounts");
  });

  it("子页脚本无凭据时给出可操作提示", () => {
    const stamp = {
      textContent: "",
    };
    const factory = new Function("window", "document", sharedClientScript());
    factory(
      {
        history: {
          replaceState: vi.fn(),
        },
        location: {
          hash: "",
          pathname: "/accounts",
        },
      },
      {
        getElementById: (id: string) => (id === "kuma-updated" ? stamp : null),
        querySelectorAll: () => [],
      },
    );
    expect(stamp.textContent).toContain("缺少访问凭据");
  });

  it("子页脚本有凭据时补全站内链接", () => {
    const attrs = new Map<string, string>([
      [
        "data-kuma-nav",
        "/",
      ],
    ]);
    const link = {
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attrs.set(name, value);
      },
    };
    const factory = new Function("window", "document", sharedClientScript());
    factory(
      {
        history: {
          replaceState: vi.fn(),
        },
        location: {
          hash: "#tok",
          pathname: "/accounts",
        },
      },
      {
        getElementById: () => null,
        querySelectorAll: () => [
          link,
        ],
      },
    );
    expect(attrs.get("href")).toBe("/#tok");
  });
});

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    balance: 10,
    currency: "CNY",
    error: null,
    model: "gpt-4o-mini",
    source: "api",
    stale: false,
    syncedAt: 1_700_000_000_000,
    topup: 100,
    vendor: "[OI]",
    ...overrides,
  };
}

function accountsPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: 1_700_000_000_000,
    overview: {
      balanceTotal: 10,
      knownCount: 1,
      manualCount: 0,
      staleCount: 0,
      topupTotal: 100,
      unknownCount: 0,
      vendorCount: 1,
    },
    rows: [
      accountRow(),
    ],
    ...overrides,
  };
}

describe("账户页脚本", () => {
  it("明细表标注数据来源，未知不渲染成 ¥0.00", async () => {
    const h = harness("#token-abc", accountsShell);
    h.fetchMock.mockReturnValue(
      respond(
        accountsPayload({
          overview: {
            balanceTotal: 15,
            knownCount: 2,
            manualCount: 1,
            staleCount: 1,
            topupTotal: 100,
            unknownCount: 1,
            vendorCount: 3,
          },
          rows: [
            accountRow(),
            accountRow({
              balance: 5,
              source: "manual",
              topup: null,
              vendor: "手填供应商",
            }),
            accountRow({
              balance: null,
              error: "授权已过期",
              source: "oauth",
              stale: true,
              vendor: "授权供应商",
            }),
          ],
        }),
      ),
    );

    h.start(accountsClientScript());
    await flush();

    const rows = h.doc.getElementById("kuma-account-rows");
    expect(rows?.textContent).toContain("接口查询");
    expect(rows?.textContent).toContain("手动填写");
    expect(rows?.textContent).toContain("OAuth 授权（旧值）");
    expect(rows?.textContent).toContain("重新授权");
    expect(rows?.textContent).toContain("未知");
    expect(rows?.textContent).not.toContain("¥0.00");
    // 来源表头齐全，别把「未知」当成 0 顶替
    expect(rows?.textContent).toContain("数据来源");
  });

  it("概览说明有多少是手工值、多少是过期旧值", async () => {
    const h = harness("#token-abc", accountsShell);
    h.fetchMock.mockReturnValue(
      respond(
        accountsPayload({
          overview: {
            balanceTotal: 15,
            knownCount: 2,
            manualCount: 1,
            staleCount: 1,
            topupTotal: 100,
            unknownCount: 0,
            vendorCount: 2,
          },
        }),
      ),
    );

    h.start(accountsClientScript());
    await flush();

    const host = h.doc.getElementById("kuma-accounts");
    expect(host?.textContent).toContain("当前余额");
    expect(host?.textContent).toContain("¥15.00");
    expect(host?.textContent).toContain("1 项为手动填写");
    expect(host?.textContent).toContain("1 项为授权过期后保留的旧值");
  });

  it("两个数字都未知时概览显示未知而不是 ¥0.00", async () => {
    const h = harness("#token-abc", accountsShell);
    h.fetchMock.mockReturnValue(
      respond(
        accountsPayload({
          overview: {
            balanceTotal: null,
            knownCount: 0,
            manualCount: 0,
            staleCount: 0,
            topupTotal: null,
            unknownCount: 1,
            vendorCount: 1,
          },
          rows: [
            accountRow({
              balance: null,
              error: "未配置任何余额来源",
              source: null,
              syncedAt: null,
              topup: null,
            }),
          ],
        }),
      ),
    );

    h.start(accountsClientScript());
    await flush();

    const host = h.doc.getElementById("kuma-accounts");
    expect(host?.textContent).toContain("未知");
    expect(host?.textContent).not.toContain("¥0.00");
    expect(host?.textContent).toContain("还没有取到任何余额数字");
  });

  it("没有供应商时不渲染明细表，改为提示编辑配置", async () => {
    const h = harness("#token-abc", accountsShell);
    h.fetchMock.mockReturnValue(
      respond(
        accountsPayload({
          rows: [],
          overview: {
            balanceTotal: null,
            knownCount: 0,
            manualCount: 0,
            staleCount: 0,
            topupTotal: null,
            unknownCount: 0,
            vendorCount: 0,
          },
        }),
      ),
    );

    h.start(accountsClientScript());
    await flush();

    expect(h.doc.getElementById("kuma-account-rows")?.children).toHaveLength(0);
    const notice = h.doc.getElementById("kuma-accounts-notice");
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain("未配置任何供应商");
  });

  it("缺少凭据时不发请求，只提示重新执行命令", () => {
    const h = harness("", accountsShell);
    h.start(accountsClientScript());

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("缺少访问凭据");
  });
});

function diagnosticsPayload(overrides: Record<string, unknown> = {}) {
  return {
    configExists: true,
    configModifiedAt: 1_700_000_000_000,
    configPath: "/proj/.pi/xpi-kuma/config.yaml",
    error: null,
    errorLine: null,
    generatedAt: 1_700_000_000_000,
    issueCount: 1,
    global: {
      cwd: "/proj",
      databaseBytes: null,
      databaseExists: false,
      databasePath: "/agent/data/xpi-kuma/usage.db",
      probeInterval: "5m",
      probeTimeoutMs: 30_000,
      retentionDays: 7,
      retentionIsDefault: true,
    },
    vendors: [
      {
        endpoint: "https://api.example/v1",
        issueCount: 1,
        model: "m",
        name: "A",
        checks: [
          {
            action: null,
            detail: "name / endpoint / model 均已配置",
            key: "required",
            ok: true,
          },
          {
            action: "export OPENAI_API_KEY=...",
            detail: "${OPENAI_API_KEY} 当前未设置",
            key: "apiKey",
            ok: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("配置体检页脚本", () => {
  it("解析通过时摊开配置明细、供应商检查与全局项", async () => {
    const h = harness("#token-abc", settingsShell);
    h.fetchMock.mockReturnValue(respond(diagnosticsPayload()));

    h.start(settingsClientScript());
    await flush();

    expect(h.doc.getElementById("kuma-diagnostics")?.textContent).toContain(
      "/proj/.pi/xpi-kuma/config.yaml",
    );
    const vendors = h.doc.getElementById("kuma-diagnostics-vendors");
    expect(vendors?.textContent).toContain("API Key");
    expect(vendors?.textContent).toContain("未通过");
    // 密钥只显示变量名与下一步，不回显值
    expect(vendors?.textContent).toContain("export OPENAI_API_KEY");
    expect(h.doc.getElementById("kuma-issues")?.textContent).toBe("待处理 1 项");
    expect(h.doc.getElementById("kuma-diagnostics-global")?.textContent).toContain(
      "不存在",
    );
    expect(h.doc.getElementById("section-diagnostics-error")?.hidden).toBe(true);
  });

  it("解析失败时隐藏供应商表与全局项，只留替代卡", async () => {
    const h = harness("#token-abc", settingsShell);
    h.fetchMock.mockReturnValue(
      respond(
        diagnosticsPayload({
          error: "配置文件 YAML 语法错误：bad indentation",
          errorLine: 3,
          global: null,
          issueCount: 0,
          vendors: null,
        }),
      ),
    );

    h.start(settingsClientScript());
    await flush();

    expect(h.doc.getElementById("section-diagnostics-vendors")?.hidden).toBe(true);
    expect(h.doc.getElementById("section-diagnostics-global")?.hidden).toBe(true);
    const card = h.doc.getElementById("kuma-diagnostics-error");
    expect(card?.hidden).toBe(false);
    expect(card?.textContent).toContain("出错位置：第 3 行");
    expect(card?.textContent).toContain("不会自动修复");
    // fail-closed：不展示半截供应商表
    expect(h.doc.getElementById("kuma-diagnostics-vendors")?.textContent).toBe("");
  });

  it("缺少凭据时不发请求，只提示重新执行命令", () => {
    const h = harness("", settingsShell);
    h.start(settingsClientScript());

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("缺少访问凭据");
  });
});

describe("零数据引导页脚本", () => {
  it("配置里没有供应商时只讲怎么加第一个供应商", async () => {
    const h = harness("#token-abc", emptyShell);
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          vendors: [],
        }),
      ),
    );

    h.start(emptyClientScript());
    await flush();

    expect(h.doc.getElementById("section-guide-vendors")?.hidden).toBe(false);
    expect(h.doc.getElementById("section-guide-data")?.hidden).toBe(true);
  });

  it("有供应商但没记录时列出三条路径", async () => {
    const h = harness("#token-abc", emptyShell);
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start(emptyClientScript());
    await flush();

    expect(h.doc.getElementById("section-guide-vendors")?.hidden).toBe(true);
    expect(h.doc.getElementById("section-guide-data")?.hidden).toBe(false);
    expect(h.doc.getElementById("kuma-guide-status")?.textContent).toContain(
      "还没有任何使用量记录",
    );
  });

  it("已有记录时提示可以回主面板", async () => {
    const h = harness("#token-abc", emptyShell);
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          overview: {
            costTotal: 1,
            projectCount: 1,
            requestCount: 5,
            totalTokens: 10,
          },
        }),
      ),
    );

    h.start(emptyClientScript());
    await flush();

    expect(h.doc.getElementById("kuma-guide-status")?.textContent).toContain(
      "已经记录 5 次调用",
    );
  });

  it("缺少凭据时不发请求", () => {
    const h = harness("", emptyShell);
    h.start(emptyClientScript());

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("缺少访问凭据");
  });
});

/** 带语言按钮与 data-i18n 元素的最小 DOM（双语切换用）。 */
function langShell(): FakeDocument {
  const doc = new FakeDocument();
  doc.root.setAttribute("data-theme", "dark");
  doc.root.setAttribute("data-title-key", "page.dashboard.title");
  doc.add("div", "kuma-updated");
  doc.add("div", "kuma-vendors");
  doc.add("div", "kuma-notice");
  doc.add("div", "kuma-overview");
  doc.add("div", "kuma-overview-notice");
  doc.add("div", "kuma-stats");
  doc.add("div", "kuma-chart");
  doc.add("button", "kuma-refresh-all");
  doc.add("button", "kuma-theme");
  doc.add("button", "kuma-family");
  doc.add("button", "kuma-lang");
  const title = doc.add("h1", "kuma-title");
  title.setAttribute("data-i18n", "page.dashboard.title");
  title.textContent = "xpi-kuma 监控面板";
  const group = doc.add("div", "kuma-range");
  group.setAttribute("data-i18n-aria", "aria.timeRange");
  group.setAttribute("aria-label", "时间范围");
  for (const period of [
    "1h",
    "24h",
    "7d",
    "30d",
  ]) {
    doc.add("button").setAttribute("data-range", period);
  }
  const navLink = doc.add("a");
  navLink.setAttribute("data-kuma-nav", "/accounts");
  navLink.setAttribute("href", "/accounts");
  return doc;
}

describe("中英双语", () => {
  it("切换语言同步更新文案、aria-label 与 <html lang>，并持久化", async () => {
    const h = harness("#token-abc", langShell);
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start(dashboardClientScript());
    await flush();

    const title = h.doc.getElementById("kuma-title");
    const group = h.doc.getElementById("kuma-range");
    const button = h.doc.getElementById("kuma-lang");

    expect(h.doc.root.getAttribute("lang")).toBe("zh-CN");
    expect(title?.textContent).toBe("xpi-kuma 监控面板");
    expect(h.doc.title).toBe("xpi-kuma 监控面板");
    expect(button?.textContent).toBe("English");

    button?.click();
    await flush();

    expect(h.doc.root.getAttribute("lang")).toBe("en");
    expect(title?.textContent).toBe("xpi-kuma Dashboard");
    expect(h.doc.title).toBe("xpi-kuma Dashboard");
    expect(group?.getAttribute("aria-label")).toBe("Time range");
    expect(button?.textContent).toBe("中文");
    expect(h.storage.get("kuma.lang")).toBe("en");
  });

  it("已保存英文偏好时首帧即为英文（刷新后保持）", async () => {
    const h = harness("#token-abc", langShell);
    h.storage.set("kuma.lang", "en");
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start(dashboardClientScript());
    await flush();

    expect(h.doc.root.getAttribute("lang")).toBe("en");
    expect(h.doc.getElementById("kuma-title")?.textContent).toBe("xpi-kuma Dashboard");
    expect(h.doc.getElementById("kuma-lang")?.textContent).toBe("中文");
  });

  it("英文界面下脚本生成的文案也是英文", async () => {
    const h = harness("#token-abc", langShell);
    h.storage.set("kuma.lang", "en");
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start(dashboardClientScript());
    await flush();

    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("Updated at");
    // 空态文案的括注与句末标点随语言切换，英文界面不出现全角标点
    const notice = h.doc.getElementById("kuma-overview-notice")?.textContent ?? "";
    expect(notice).toContain("No usage recorded this period (24h).");
    expect(notice).not.toMatch(CJK_PUNCTUATION);
  });

  it("首帧偏好脚本按已存语言写 <html lang>", () => {
    expect(preferenceBootstrapScript()).toContain("kuma.lang");
  });

  it("图表时间刻度跟随界面语言，不跟随系统 locale", async () => {
    const h = harness("#token-abc", langShell);
    h.storage.set("kuma.lang", "en");
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
          ],
        }),
      ),
    );
    h.start(dashboardClientScript());
    await flush();
    const labels = (h.doc.getElementById("kuma-chart")?.descendants() ?? [])
      .filter((node) => node.tagName === "TEXT")
      .map((node) => node.textContent)
      .join(" | ");
    expect(labels).not.toMatch(CJK_IDEOGRAPHS);
  });
});
