import { afterEach, describe, expect, it, vi } from "vitest";
import type { VendorConfig } from "../types.ts";
import {
  fetchBalanceViaApi,
  fetchBalanceViaOAuth,
  findBalance,
  resolveBalanceUrl,
} from "./balance-api.ts";

function vendor(overrides: Partial<VendorConfig> = {}): VendorConfig {
  return {
    apiKey: "sk-secret",
    endpoint: "https://api.example/v1",
    model: "m",
    name: "A",
    balance: {
      apiPath: "/v1/balance",
    },
    probe: {
      enabled: false,
      interval: "5m",
      timeout: 1000,
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    json: () => Promise.resolve(body),
    status,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("余额接口取数", () => {
  it("成功时返回余额与币种，并带上 API Key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          balance: 12.5,
          currency: "USD",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBalanceViaApi(vendor())).resolves.toEqual({
      balance: 12.5,
      currency: "USD",
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.example/v1/v1/balance");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-secret",
    );
  });

  it("非 2xx 抛错，且错误信息不含凭据", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    await expect(fetchBalanceViaApi(vendor())).rejects.toThrow("HTTP 401");
    await expect(fetchBalanceViaApi(vendor())).rejects.not.toThrow(/sk-secret/);
  });

  it("超时归一为 timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    );

    await expect(
      fetchBalanceViaApi(vendor(), {
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timeout");
  });

  it("缺少路径或 API Key 时直接失败，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchBalanceViaApi(
        vendor({
          balance: {},
        }),
      ),
    ).rejects.toThrow("未配置余额接口路径");
    await expect(
      fetchBalanceViaApi(
        vendor({
          apiKey: undefined,
        }),
      ),
    ).rejects.toThrow("未配置 API Key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OAuth 档用访问令牌请求同一路径", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        balance: 3,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBalanceViaOAuth(vendor(), "tok")).resolves.toEqual({
      balance: 3,
      currency: "CNY",
    });
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("响应里没有可识别的余额字段时报错，不随便挑一个数字", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          tokens: 12_345,
        }),
      ),
    );

    await expect(fetchBalanceViaApi(vendor())).rejects.toThrow("没有可识别的余额字段");
  });

  it("地址拼接支持绝对路径与相对路径", () => {
    expect(resolveBalanceUrl("https://api.example/v1", "/balance")).toBe(
      "https://api.example/v1/balance",
    );
    expect(resolveBalanceUrl("https://api.example/v1/", "balance")).toBe(
      "https://api.example/v1/balance",
    );
    expect(resolveBalanceUrl("https://api.example/v1", "https://other.example/b")).toBe(
      "https://other.example/b",
    );
  });

  it("余额解析跳过嵌套里的非余额数字", () => {
    expect(
      findBalance({
        usage: 999,
        data: {
          credit_balance: 7,
        },
      }),
    ).toBe(7);
    expect(
      findBalance({
        usage: 999,
      }),
    ).toBeUndefined();
  });
});
