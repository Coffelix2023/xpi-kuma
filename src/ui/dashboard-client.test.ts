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
      // 页面脚本会调用 event.preventDefault()
      handler({
        preventDefault: () => {},
      });
    }
  }

  /** 标签页键盘导航只记录焦点落在谁身上，不做真实焦点管理。 */
  focused = false;

  focus(): void {
    this.focused = true;
  }

  /** 派发一次 keydown；事件对象只带页面脚本读到的字段。 */
  keydown(key: string): void {
    for (const handler of this.listeners.get("keydown") ?? []) {
      handler({
        key,
        preventDefault: () => {},
      });
    }
  }

  /** 下拉的选中值：页面脚本直接读写这个属性。 */
  value = "";

  /** 派发一次 submit；表单提交的入口（真实 DOM 里 requestSubmit 的语义）。 */
  submit(): void {
    for (const handler of this.listeners.get("submit") ?? []) {
      handler({
        preventDefault: () => {},
      });
    }
  }

  /** 派发一次 change；下拉的交互入口。 */
  change(): void {
    for (const handler of this.listeners.get("change") ?? []) {
      handler({});
    }
  }

  /** 与真实 DOM 同语义：在自身子树里查。 */
  querySelectorAll(selector: string): FakeElement[] {
    return queryAll(this, selector);
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
  // 与 pageShell 的首帧默认一致：图鉴家族 · 亮色
  doc.root.setAttribute("data-family", "atlas");
  doc.root.setAttribute("data-theme", "light");
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
  doc.root.setAttribute("data-family", "atlas");
  doc.root.setAttribute("data-theme", "light");
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
  doc.root.setAttribute("data-family", "atlas");
  doc.root.setAttribute("data-theme", "light");
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
  doc.root.setAttribute("data-family", "atlas");
  doc.root.setAttribute("data-theme", "light");
  doc.add("div", "kuma-updated");
  doc.add("div", "kuma-overview");
  doc.add("div", "kuma-overview-notice");
  doc.add("div", "kuma-vendors");
  doc.add("div", "kuma-vendor-form");
  doc.add("button", "kuma-vendor-add");
  doc.add("div", "kuma-notice");
  doc.add("div", "kuma-stats");
  doc.add("div", "kuma-insights");
  doc.add("div", "kuma-rank-model");
  doc.add("div", "kuma-rank-project");
  doc.add("div", "kuma-rank-efficiency");
  doc.add("div", "kuma-chart");
  doc.add("button", "kuma-refresh-all");
  for (const id of [
    "kuma-theme",
    "kuma-font-dec",
    "kuma-font-inc",
    "kuma-font-reset",
  ]) {
    doc.add("button", id).setAttribute("data-preference", "");
  }
  // 家族是下拉：选中值就是目标家族
  const family = doc.add("select", "kuma-family");
  family.setAttribute("data-preference", "");
  const navLink = doc.add("a");
  navLink.setAttribute("data-kuma-nav", "/accounts");
  navLink.setAttribute("href", "/accounts");
  // 标签页：每个标签配一个面板，初始状态与页面 HTML 一致（第一个选中并可见）
  const tabIds = [
    "overview",
    "stats",
    "chart",
    "vendors",
  ];
  tabIds.forEach((id, index) => {
    const tab = doc.add("button");
    tab.setAttribute("data-tab", id);
    tab.setAttribute("aria-selected", String(index === 0));
    tab.setAttribute("tabindex", index === 0 ? "0" : "-1");
    const panel = doc.add("section");
    panel.setAttribute("data-tab-panel", id);
    panel.hidden = index !== 0;
  });
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
    endpoint: "http://127.0.0.1:1/v1",
    lastProbeTime: null,
    model: "gpt-4o-mini",
    name: "[OI]",
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
  confirm: ReturnType<typeof vi.fn>;
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
  const confirmMock = vi.fn(() => true);
  const windowObject = {
    clearInterval,
    confirm: confirmMock,
    history: {
      replaceState,
    },
    location,
    setInterval,
  };
  return {
    confirm: confirmMock,
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
  // sessionStorage 是流程里唯一的全局桩，逐个测试后清掉，避免跨用例串联
  vi.unstubAllGlobals();
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

  it("刷新后地址栏已无 fragment，仍用 tab 缓存取数据渲染", async () => {
    // 模拟刷新：URL 里没有 fragment，只剩上一轮加载写下的 sessionStorage 缓存
    const store = new Map([
      [
        "kuma.token",
        "token-abc",
      ],
    ]);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    const h = harness("");
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();

    expect(h.fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token-abc");
    expect(h.doc.getElementById("kuma-updated")?.textContent).toContain("更新于");
  });
});

describe("使用量总览与统计表", () => {
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
    expect(host?.textContent).toContain("1,234");
    expect(host?.textContent).toContain("覆盖项目数");
    expect(h.doc.getElementById("kuma-overview-notice")?.hidden).toBe(true);
  });

  it("概览数字：百万级用 M、亿级用亿，小数字保留千分位", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          overview: {
            costTotal: 12345.6,
            projectCount: 1234567,
            requestCount: 999,
            totalTokens: 123456789,
          },
        }),
      ),
    );

    h.start();
    await flush();

    const text = h.doc.getElementById("kuma-overview")?.textContent ?? "";
    expect(text).toContain("¥12,345.60");
    expect(text).toContain("1.23亿");
    expect(text).toContain("1.23M");
    expect(text).toContain("999");
  });

  it("统计表与供应商卡的时长同样走紧凑格式", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          stats: [
            {
              cacheReadCost: 0,
              cacheWriteCost: 0,
              costCacheRead: 0,
              costCacheWrite: 0,
              costInput: 1,
              costOutput: 2,
              costTotal: 3,
              model: "m1",
              provider: "p1",
              requestCount: 1234,
              tokensCacheRead: 0,
              tokensCacheWrite: 0,
              tokensInput: 1234567,
              tokensOutput: 1,
            },
          ],
          vendors: [
            vendor({
              totalTime: 1234,
              ttft: 12345,
            }),
          ],
        }),
      ),
    );

    h.start();
    await flush();

    expect(h.doc.getElementById("kuma-stats")?.textContent).toContain("1.23M");
    expect(h.doc.getElementById("kuma-stats")?.textContent).toContain("1,234");
    expect(h.doc.getElementById("kuma-vendors")?.textContent).toContain("1,234 ms");
    expect(h.doc.getElementById("kuma-vendors")?.textContent).toContain("12,345 ms");
  });

  it("统计表列头按需求顺序排列，占比按本期合计算出", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          stats: [
            {
              costCacheRead: 0.1,
              costCacheWrite: 0.2,
              costInput: 1,
              costOutput: 2,
              costTotal: 3,
              model: "m1",
              provider: "p1",
              requestCount: 1234,
              tokensCacheRead: 10,
              tokensCacheWrite: 20,
              tokensInput: 100,
              tokensOutput: 200,
              toolCalls: 7,
              totalTokens: 330,
            },
            {
              costCacheRead: 0,
              costCacheWrite: 0,
              costInput: 9,
              costOutput: 0,
              costTotal: 9,
              model: "m2",
              provider: "p2",
              requestCount: 5,
              tokensCacheRead: 0,
              tokensCacheWrite: 0,
              tokensInput: 600,
              tokensOutput: 0,
              toolCalls: 3,
              totalTokens: 600,
            },
          ],
        }),
      ),
    );

    h.start();
    await flush();

    // FakeDocument 只支持简单选择器，这里按结构逐层取：host > div.kuma-scroll > table
    const table = h.doc.getElementById("kuma-stats")?.children[0]?.children[0];
    const headers = (table?.children[0]?.children[0]?.children ?? []).map(
      (cell) => cell.textContent,
    );
    expect(headers).toEqual([
      "供应商",
      "模型",
      "请求次数",
      "输入 tok",
      "输入费用",
      "输出 tok",
      "输出费用",
      "缓存读",
      "缓存读费用",
      "缓存写",
      "缓存写费用",
      "工具调用次数",
      "单请求成本",
      "缓存命中率",
      "tokens 占比",
      "费用占比",
    ]);

    const rows = (table?.children[1]?.children ?? []).map((row) =>
      row.children.map((cell) => cell.textContent),
    );
    expect(rows[0]).toEqual([
      "p1",
      "m1",
      "1,234",
      "100",
      "¥1.00",
      "200",
      "¥2.00",
      "10",
      "¥0.10",
      "20",
      "¥0.20",
      "7",
      "¥0.00",
      "9.1%",
      "35.5%",
      "25.0%",
    ]);
    // 分摊取自全表合计：两行占比之和为 100.0%
    expect(rows[1]?.slice(-2)).toEqual([
      "64.5%",
      "75.0%",
    ]);
  });

  it("统计表合计为 0 时占比显示 0.0% 而不是破折号", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          stats: [
            {
              costCacheRead: 0,
              costCacheWrite: 0,
              costInput: 0,
              costOutput: 0,
              costTotal: 0,
              model: "m1",
              provider: "p1",
              requestCount: 0,
              tokensCacheRead: 0,
              tokensCacheWrite: 0,
              tokensInput: 0,
              tokensOutput: 0,
              toolCalls: 0,
            },
          ],
        }),
      ),
    );

    h.start();
    await flush();

    const table = h.doc.getElementById("kuma-stats")?.children[0]?.children[0];
    const cells = (table?.children[1]?.children[0]?.children ?? []).map(
      (cell) => cell.textContent,
    );
    expect(cells.slice(-2)).toEqual([
      "0.0%",
      "0.0%",
    ]);
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
});

describe("总览排行、效率与建议", () => {
  /** 只读区块：断言脚本没有对任何写接口发请求。 */
  function onlyReads(h: Harness): boolean {
    return h.fetchMock.mock.calls.every(
      ([, init]) =>
        (
          init as
            | {
                method?: string;
              }
            | undefined
        )?.method === "GET",
    );
  }

  it("概览第五项是缓存命中率，未知时显示未知而不是 0%", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          cache: {
            cacheReadTokens: 0,
            hitRate: null,
            inputTokens: 0,
          },
        }),
      ),
    );

    h.start();
    await flush();

    const text = h.doc.getElementById("kuma-overview")?.textContent ?? "";
    expect(text).toContain("缓存命中率");
    expect(text).toContain("未知");
    expect(text).not.toContain("0.0%");
  });

  it("有缓存命中率时按百分比显示", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          cache: {
            cacheReadTokens: 648,
            hitRate: 0.648,
            inputTokens: 352,
          },
        }),
      ),
    );

    h.start();
    await flush();

    expect(h.doc.getElementById("kuma-overview")?.textContent).toContain("64.8%");
  });

  it("排行摘要：provider/model 与项目费用，超出首屏的组合折叠成一行", async () => {
    const h = harness();
    const stats = Array.from(
      {
        length: 6,
      },
      (_, index) => ({
        costCacheRead: 0,
        costCacheWrite: 0,
        costInput: 0,
        costOutput: 0,
        costPerRequest: 0.1,
        costShare: 0.1,
        costTotal: 6 - index,
        model: `m${index}`,
        period: "24h",
        provider: `p${index}`,
        requestCount: 12,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensInput: 0,
        tokensOutput: 0,
        toolCalls: 0,
        totalTokens: 0,
      }),
    );
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          attribution: [
            {
              cacheHitRate: 0.5,
              costPerRequest: 0.5,
              costShare: 0.6,
              costTotal: 6,
              key: "/work/app",
              requestCount: 12,
              tokens: 10,
            },
            {
              cacheHitRate: null,
              costPerRequest: 0.4,
              costShare: 0.4,
              costTotal: 4,
              key: "",
              requestCount: 10,
              tokens: 8,
            },
          ],
          stats,
        }),
      ),
    );

    h.start();
    await flush();

    const models = h.doc.getElementById("kuma-rank-model")?.textContent ?? "";
    expect(models).toContain("provider/model 费用");
    expect(models).toContain("p0 · m0");
    // 6 行只展示前 5 行，第 6 行折叠成汇总行
    expect(models).not.toContain("p5 · m5");
    expect(models).toContain("其余 1 个组合已汇总");

    const projects = h.doc.getElementById("kuma-rank-project")?.textContent ?? "";
    expect(projects).toContain("/work/app");
    expect(projects).toContain("未知");
    expect(projects).toContain("60.0%");
    expect(onlyReads(h)).toBe(true);
  });

  it("建议卡片给出依据、样本数、时间范围与置信度，且没有写操作入口", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          insights: [
            {
              confidence: "medium",
              dimension: "cost",
              evidence: "单请求成本 ¥0.126 vs ¥0.187",
              period: "24h",
              sampleSize: 318,
              statement: "openai · gpt-4 的单请求成本最低",
              target: "openai · gpt-4",
            },
          ],
        }),
      ),
    );

    h.start();
    await flush();

    const host = h.doc.getElementById("kuma-insights");
    const text = host?.textContent ?? "";
    expect(text).toContain("成本：openai · gpt-4 的单请求成本最低");
    expect(text).toContain("¥0.126 vs ¥0.187");
    expect(text).toContain("318");
    expect(text).toContain("24小时");
    expect(text).toContain("中");
    // 建议只读：卡片里没有按钮，全程也只发 GET
    const buttons = (host?.descendants() ?? []).filter(
      (node) => node.tagName === "BUTTON",
    );
    expect(buttons).toHaveLength(0);
    expect(onlyReads(h)).toBe(true);
  });

  it("洞察不可用时显示不可用，基础统计照常渲染", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          efficiency: [],
          insights: null,
          stats: [
            {
              costCacheRead: 0,
              costCacheWrite: 0,
              costInput: 1,
              costOutput: 0,
              costPerRequest: 1,
              costShare: 1,
              costTotal: 1,
              model: "m1",
              period: "24h",
              provider: "p1",
              requestCount: 1,
              tokensCacheRead: 0,
              tokensCacheWrite: 0,
              tokensInput: 10,
              tokensOutput: 5,
              toolCalls: 0,
              totalTokens: 15,
            },
          ],
        }),
      ),
    );

    h.start();
    await flush();

    expect(h.doc.getElementById("kuma-insights")?.textContent).toContain(
      "洞察暂不可用",
    );
    expect(h.doc.getElementById("kuma-rank-efficiency")?.textContent).toContain(
      "洞察暂不可用",
    );
    // 基础统计不受影响
    expect(h.doc.getElementById("kuma-stats")?.textContent).toContain("p1");
    // 概览照常渲染（数值来自接口的 overview，不因洞察不可用而清空）
    expect(h.doc.getElementById("kuma-overview")?.textContent).toContain("缓存命中率");
    expect(h.doc.getElementById("kuma-stats")?.textContent).toContain("¥1.00");
  });

  it("效率排行区分暂无真实数据与样本不足", async () => {
    const empty = harness();
    empty.fetchMock.mockReturnValue(
      respond(
        dashboard({
          efficiency: [],
          insights: [],
        }),
      ),
    );
    empty.start();
    await flush();
    expect(empty.doc.getElementById("kuma-rank-efficiency")?.textContent).toContain(
      "暂无真实效率数据",
    );
    expect(empty.doc.getElementById("kuma-insights")?.textContent).toContain(
      "本期暂无可给出的建议",
    );

    const thin = harness();
    thin.fetchMock.mockReturnValue(
      respond(
        dashboard({
          insights: [],
          efficiency: [
            {
              model: "gpt-4",
              p50TotalMs: 1200,
              p50TtftMs: 120,
              p95TotalMs: 2400,
              p95TtftMs: 240,
              provider: "openai",
              sampleSize: 5,
              successRate: 0.8,
              sufficient: false,
            },
          ],
        }),
      ),
    );
    thin.start();
    await flush();
    const text = thin.doc.getElementById("kuma-rank-efficiency")?.textContent ?? "";
    expect(text).toContain("openai · gpt-4");
    expect(text).toContain("样本不足");
    expect(text).toContain("1,200 ms");
    expect(text).toContain("80.0%");
  });

  it("切换时间范围后排行与效率按新范围重查", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          efficiency: [],
          insights: [],
        }),
      ),
    );
    h.start();
    await flush();

    const week = h.doc
      .querySelectorAll("[data-range]")
      .find((btn) => btn.getAttribute("data-range") === "7d");
    week?.click();
    await flush();

    expect(h.fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/dashboard?period=7d");
    expect(onlyReads(h)).toBe(true);
  });
});

describe("空数据引导", () => {
  it("无记录时概览给出引导链接，各区块显示空态而不是零值行", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(
      respond(
        dashboard({
          attribution: [],
          efficiency: [],
          insights: [],
          stats: [],
          cache: {
            cacheReadTokens: 0,
            hitRate: null,
            inputTokens: 0,
          },
        }),
      ),
    );

    h.start();
    await flush();

    const notice = h.doc.getElementById("kuma-overview-notice");
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain("本期还没有使用量记录");
    const guide = (notice?.descendants() ?? []).find(
      (node) => node.getAttribute("data-kuma-nav") === "/empty",
    );
    expect(guide).toBeDefined();

    for (const id of [
      "kuma-rank-model",
      "kuma-rank-project",
    ]) {
      expect(h.doc.getElementById(id)?.textContent, id).toContain("暂无数据");
    }
    expect(h.doc.getElementById("kuma-rank-efficiency")?.textContent).toContain(
      "暂无真实效率数据",
    );
    expect(h.doc.getElementById("kuma-insights")?.textContent).toContain(
      "本期暂无可给出的建议",
    );
  });
});

describe("分区索引轨", () => {
  it("点击标签切换面板，同一时刻只有一个 aria-selected=true", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const tabs = h.doc.querySelectorAll("[data-tab]");
    const panels = h.doc.querySelectorAll("[data-tab-panel]");
    expect(tabs).toHaveLength(4);
    expect(panels).toHaveLength(4);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(panels[0].hidden).toBe(false);

    tabs[1].click();

    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(panels[1].hidden).toBe(false);
    expect(panels[0].hidden).toBe(true);
  });

  it("方向键在标签间循环，Home / End 跳到首尾", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const tabs = h.doc.querySelectorAll("[data-tab]");
    tabs[0].keydown("ArrowRight");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].focused).toBe(true);

    tabs[1].keydown("ArrowRight");
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");

    tabs[0].keydown("ArrowLeft");
    expect(tabs[3].getAttribute("aria-selected")).toBe("true");

    tabs[3].keydown("Home");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    tabs[0].keydown("End");
    expect(tabs[3].getAttribute("aria-selected")).toBe("true");
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

  it("卡片刷新按钮只探测该模型", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    h.fetchMock.mockClear();

    const buttons = h.doc.querySelectorAll(".kuma-card-foot button");
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    await flush();

    // 每模型一张卡：卡片按钮带 ?model=，只落该模型
    expect(h.fetchMock.mock.calls[0][0]).toBe(
      `/api/probes/${encodeURIComponent("[OI]")}?model=${encodeURIComponent("gpt-4o-mini")}`,
    );
    expect(h.fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("分组头的探测全部不带 model，探测该供应商所有模型", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));

    h.start();
    await flush();
    h.fetchMock.mockClear();

    const all = h.doc.querySelectorAll(".kuma-vendor-actions button")[0];
    all.click();
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

describe("供应商编辑表单", () => {
  /** 打开新增表单：入口是供应商面板操作行里的按钮。 */
  function openAdd(h: Harness): FakeElement {
    h.doc.getElementById("kuma-vendor-add")?.click();
    const host = h.doc.getElementById("kuma-vendor-form");
    if (!host) {
      throw new Error("缺少表单容器");
    }
    return host;
  }

  it("新增入口打开表单，密钥字段恒为空", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const host = openAdd(h);
    expect(host.hidden).toBe(false);
    const inputs = host.querySelectorAll("input");
    // name / endpoint / apiKey / interval / timeout：密钥那一格必须是空的
    expect(inputs).toHaveLength(5);
    expect(inputs[2].value).toBe("");
  });

  it("提交走 /api/vendors/save 且模型按行拆分去重", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();
    h.fetchMock.mockClear();

    const host = openAdd(h);
    const inputs = host.querySelectorAll("input");
    inputs[0].value = "Fresh";
    inputs[1].value = "https://api.example.test/v1";
    host.querySelectorAll("textarea")[0].value = "m1\nm2\nm1";
    host.querySelectorAll("form")[0].submit();
    await flush();

    const [path, init] = h.fetchMock.mock.calls[0];
    expect(path).toBe("/api/vendors/save");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body) as {
      models: string[];
      name: string;
    };
    expect(body.name).toBe("Fresh");
    expect(body.models).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("编辑预填现值，删除走确认后调用 /api/vendors/delete", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const actions = h.doc.querySelectorAll(".kuma-vendor-actions button");
    actions[1].click();
    const host = h.doc.getElementById("kuma-vendor-form");
    const inputs = host?.querySelectorAll("input") ?? [];
    expect(inputs[0].value).toBe("[OI]");
    expect(inputs[1].value).toBe("http://127.0.0.1:1/v1");
    // 编辑态不回显任何既有密钥
    expect(inputs[2].value).toBe("");
    expect(host?.querySelectorAll("textarea")[0].value).toBe("gpt-4o-mini");

    h.fetchMock.mockClear();
    actions[2].click();
    await flush();

    expect(h.confirm).toHaveBeenCalled();
    const [path, init] = h.fetchMock.mock.calls[0];
    expect(path).toBe("/api/vendors/delete");
    expect(JSON.parse(init.body)).toEqual({
      name: "[OI]",
    });
  });
});

describe("字号档位控件", () => {
  it("A+ / A− 移动档位并写入 localStorage，到边界后禁用", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const dec = h.doc.getElementById("kuma-font-dec");
    const inc = h.doc.getElementById("kuma-font-inc");
    const reset = h.doc.getElementById("kuma-font-reset");
    expect(dec?.disabled).toBe(false);
    expect(inc?.disabled).toBe(false);

    inc?.click();
    expect(h.doc.root.getAttribute("data-font")).toBe("4");
    expect(h.storage.get("kuma.font")).toBe("4");

    inc?.click();
    expect(h.doc.root.getAttribute("data-font")).toBe("5");
    expect(inc?.disabled).toBe(true);
    expect(dec?.disabled).toBe(false);

    reset?.click();
    expect(h.doc.root.getAttribute("data-font")).toBe("3");
    expect(h.storage.get("kuma.font")).toBe("3");
    expect(inc?.disabled).toBe(false);

    dec?.click();
    dec?.click();
    expect(h.doc.root.getAttribute("data-font")).toBe("1");
    expect(dec?.disabled).toBe(true);
  });

  it("越界档位按默认档处理，数据刷新不解禁边界按钮", async () => {
    const h = harness();
    h.doc.root.setAttribute("data-font", "9");
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const dec = h.doc.getElementById("kuma-font-dec");
    const inc = h.doc.getElementById("kuma-font-inc");
    expect(dec?.disabled).toBe(false);
    expect(inc?.disabled).toBe(false);

    inc?.click();
    inc?.click();
    expect(h.doc.root.getAttribute("data-font")).toBe("5");
    expect(inc?.disabled).toBe(true);

    // 一次数据刷新会重新启用被置灰的按钮，偏好类按钮必须豁免，否则边界禁用状态丢失
    h.doc.getElementById("kuma-refresh-all")?.click();
    await flush();
    expect(inc?.disabled).toBe(true);
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

    // 首帧默认是图鉴家族：选「默认」后移除属性，选回「图鉴」再设上
    const select = h.doc.getElementById("kuma-family");
    if (!select) {
      throw new Error("shell 缺少家族下拉");
    }
    expect(select.value).toBe("atlas");

    select.value = "default";
    select.change();
    expect(h.doc.documentElement.getAttribute("data-family")).toBeNull();
    expect(h.storage.get("kuma.family")).toBe("default");

    select.value = "atlas";
    select.change();
    expect(h.doc.documentElement.getAttribute("data-family")).toBe("atlas");
    expect(h.storage.get("kuma.family")).toBe("atlas");

    // 模拟刷新后重新打开：拿持久化的偏好跑一次首帧脚本
    const reopened = new FakeElement("html");
    reopened.setAttribute("data-family", "atlas");
    reopened.setAttribute("data-theme", "light");
    runBootstrap(preferenceBootstrapScript(), reopened, h.storage);
    expect(reopened.getAttribute("data-family")).toBe("atlas");
  });

  it("选到默认家族时移除属性并写入偏好", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    const select = h.doc.getElementById("kuma-family");
    if (!select) {
      throw new Error("shell 缺少家族下拉");
    }
    select.value = "default";
    select.change();
    expect(h.doc.documentElement.getAttribute("data-family")).toBeNull();
    expect(h.storage.get("kuma.family")).toBe("default");
  });

  it("切换明暗写入偏好，按钮文案跟随", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    // 首帧默认是亮色，所以按钮文案是「切到暗色」
    const btn = h.doc.getElementById("kuma-theme");
    expect(btn?.textContent).toBe("暗色");
    btn?.click();
    expect(h.doc.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(h.storage.get("kuma.theme")).toBe("dark");
    expect(btn?.textContent).toBe("亮色");
  });

  it("家族下拉的选中值反映当前家族", async () => {
    const h = harness();
    h.fetchMock.mockReturnValue(respond(dashboard()));
    h.start();
    await flush();

    // 首帧默认图鉴家族
    const select = h.doc.getElementById("kuma-family");
    if (!select) {
      throw new Error("shell 缺少家族下拉");
    }
    expect(select.value).toBe("atlas");

    select.value = "default";
    select.change();
    expect(select.value).toBe("default");
    expect(h.doc.documentElement.getAttribute("data-family")).toBeNull();
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
        name: "A",
        checks: [
          {
            action: null,
            detail: "name / endpoint / models 均已配置",
            key: "required",
            ok: true,
          },
          {
            action: null,
            detail: "已配置：https://api.example/v1",
            key: "endpoint",
            ok: true,
          },
          {
            action: null,
            detail: "已配置 1 个模型：m",
            key: "models",
            ok: true,
          },
          {
            action: "export OPENAI_API_KEY=...",
            detail: "${OPENAI_API_KEY} 当前未设置",
            key: "apiKey",
            ok: false,
          },
          {
            action: null,
            detail: "间隔 5m，超时 30000 ms",
            key: "probe",
            ok: true,
          },
        ],
        models: [
          "m",
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
    // 摘要条四项：供应商 / 检查项 / 未通过 / 解析状态
    const summary = h.doc.getElementById("kuma-issues")?.textContent ?? "";
    expect(summary).toContain("供应商1");
    expect(summary).toContain("检查项5");
    expect(summary).toContain("未通过1");
    expect(summary).toContain("解析通过");
    // 分卡而不是 rowspan 大表
    expect(h.doc.querySelectorAll(".kuma-vendor-check")).toHaveLength(1);
    expect(h.doc.querySelectorAll(".kuma-check-item")).toHaveLength(5);
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
  doc.root.setAttribute("data-family", "atlas");
  doc.root.setAttribute("data-theme", "light");
  doc.root.setAttribute("data-title-key", "page.dashboard.title");
  doc.add("div", "kuma-updated");
  doc.add("div", "kuma-vendors");
  doc.add("div", "kuma-notice");
  doc.add("div", "kuma-overview");
  doc.add("div", "kuma-overview-notice");
  doc.add("div", "kuma-stats");
  doc.add("div", "kuma-chart");
  doc.add("button", "kuma-refresh-all");
  for (const id of [
    "kuma-theme",
  ]) {
    doc.add("button", id).setAttribute("data-preference", "");
  }
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
