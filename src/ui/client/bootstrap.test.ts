import { describe, expect, it, vi } from "vitest";
import { bootstrapFragment, preferenceBootstrapScript } from "./bootstrap.ts";

/** 最简根元素：首帧脚本只碰 documentElement 的 data-theme / data-family。 */
function makeRoot() {
  const attrs = new Map<string, string>();
  return {
    getAttribute: (key: string) => attrs.get(key) ?? null,
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
) {
  const root = makeRoot();
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
      'var NO_VENDOR = "";',
    ].join("\n")}\n${bootstrapFragment()}\n${epilogue}`,
  );
  return factory(windowObj, documentObj);
}

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

  it("无偏好时保持 HTML 上的默认值", () => {
    const root = runPreference(new Map());
    expect(root.getAttribute("data-theme")).toBeNull();
    expect(root.getAttribute("data-family")).toBeNull();
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
