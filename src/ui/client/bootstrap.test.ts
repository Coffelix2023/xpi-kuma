import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapFragment, preferenceBootstrapScript } from "./bootstrap.ts";

/** 最简根元素：首帧脚本只碰 documentElement 的 data-theme / data-family。 */
function makeRoot(initial: Record<string, string> = {}) {
  const attrs = new Map<string, string>(Object.entries(initial));
  return {
    getAttribute: (key: string) => attrs.get(key) ?? null,
    removeAttribute: (key: string) => {
      attrs.delete(key);
    },
    setAttribute: (key: string, value: string) => {
      attrs.set(key, value);
    },
  };
}

/** 执行首帧偏好脚本，返回它改过的根元素。 */
function runPreference(
  storage:
    | Map<string, string>
    | {
        getItem: (key: string) => string | null;
      },
  initial: Record<string, string> = {},
) {
  const root = makeRoot(initial);
  // 与装配层一致：Map 只是测试里的便捷写法，脚本看到的是带 getItem 的存储
  const localStorageStub =
    storage instanceof Map
      ? {
          getItem: (key: string) => storage.get(key) ?? null,
        }
      : storage;
  const factory = new Function("document", "localStorage", preferenceBootstrapScript());
  factory(
    {
      documentElement: root,
    },
    localStorageStub,
  );
  return root;
}

/** 执行开场片段，可返回片段内部的值（用于触碰闭包内的函数/变量）。 */
function runBootstrapFragment(
  windowObj: unknown,
  documentObj: unknown,
  epilogue = "",
): unknown {
  const factory = new Function(
    "window",
    "document",
    // 开场片段依赖装配层的头部变量；单测只注入本片段时补上最小声明
    `${[
      "var POLL_MS = 5000;",
      'var DEFAULT_PERIOD = "24h";',
    ].join("\n")}\n${bootstrapFragment()}\n${epilogue}`,
  );
  return factory(windowObj, documentObj);
}

/** sessionStorage 是流程里唯一的全局桩，逐个测试后清掉，避免跨用例串联。 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preferenceBootstrapScript", () => {
  it("按已保存偏好设置属性", () => {
    const root = runPreference(
      new Map([
        [
          "kuma.theme",
          "light",
        ],
        [
          "kuma.family",
          "atlas",
        ],
      ]),
    );
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.getAttribute("data-family")).toBe("atlas");
  });

  it("无偏好时保持 HTML 上的默认值（图鉴 · 亮色）", () => {
    const root = runPreference(new Map(), {
      "data-family": "atlas",
      "data-theme": "light",
    });
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.getAttribute("data-family")).toBe("atlas");
  });

  it("偏好为 default 家族时移除静态默认的 atlas", () => {
    const root = runPreference(
      new Map([
        [
          "kuma.family",
          "default",
        ],
      ]),
      {
        "data-family": "atlas",
        "data-theme": "light",
      },
    );
    expect(root.getAttribute("data-family")).toBeNull();
    // 主题没有 default 这一档，未设偏好时保持静态默认的亮色
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("非法偏好值被忽略，不写入属性", () => {
    const root = runPreference(
      new Map([
        [
          "kuma.theme",
          "chartreuse",
        ],
        [
          "kuma.family",
          "nope",
        ],
      ]),
    );
    expect(root.getAttribute("data-theme")).toBeNull();
    expect(root.getAttribute("data-family")).toBeNull();
  });

  it("存储不可用时不抛错，页面照常继续", () => {
    const throwing = {
      getItem: () => {
        throw new Error("storage disabled");
      },
    };
    expect(() => runPreference(throwing)).not.toThrow();
  });

  it("字号档位偏好：合法档位写 data-font，越界与脏值不写", () => {
    expect(
      runPreference(
        new Map([
          [
            "kuma.font",
            "4",
          ],
        ]),
      ).getAttribute("data-font"),
    ).toBe("4");
    for (const dirty of [
      "0",
      "6",
      "",
      "abc",
    ]) {
      expect(
        runPreference(
          new Map([
            [
              "kuma.font",
              dirty,
            ],
          ]),
        ).getAttribute("data-font"),
        dirty,
      ).toBeNull();
    }
  });
});

describe("bootstrapFragment", () => {
  it("读取 fragment 凭据后立即从地址栏清除", () => {
    const replaceState = vi.fn();
    runBootstrapFragment(
      {
        history: {
          replaceState,
        },
        location: {
          hash: "#secret-token",
          pathname: "/",
        },
      },
      {
        getElementById: () => null,
      },
    );
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("无凭据时 token 为空串", () => {
    const token = runBootstrapFragment(
      {
        history: {
          replaceState: vi.fn(),
        },
        location: {
          hash: "",
          pathname: "/",
        },
      },
      {
        getElementById: () => null,
      },
      "return token;",
    );
    expect(token).toBe("");
  });

  it("读到 fragment 凭据后按标签页缓存到 sessionStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    runBootstrapFragment(
      {
        history: {
          replaceState: vi.fn(),
        },
        location: {
          hash: "#secret-token",
          pathname: "/",
        },
      },
      {
        getElementById: () => null,
      },
    );
    expect(store.get("kuma.token")).toBe("secret-token");
  });

  it("地址栏没有 fragment 时回退到 sessionStorage 的缓存", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: vi.fn(),
      getItem: () => "cached-token",
    });
    const replaceState = vi.fn();
    const token = runBootstrapFragment(
      {
        history: {
          replaceState,
        },
        location: {
          hash: "",
          pathname: "/",
        },
      },
      {
        getElementById: () => null,
      },
      "return token;",
    );
    // 刷新（fragment 已抹掉）后凭据仍在，且地址栏照旧被清理
    expect(token).toBe("cached-token");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("setStatus 更新状态文案", () => {
    const stamp = {
      textContent: "",
    };
    const setStatus = runBootstrapFragment(
      {
        history: {
          replaceState: vi.fn(),
        },
        location: {
          hash: "",
          pathname: "/",
        },
      },
      {
        getElementById: (id: string) => (id === "kuma-updated" ? stamp : null),
      },
      "return setStatus;",
    ) as (message: string) => void;
    setStatus("更新于 12:00");
    expect(stamp.textContent).toBe("更新于 12:00");
  });
});
