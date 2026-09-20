import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountBalance, VendorConfig } from "../types.ts";
import { resolveBalance, resolveBalances } from "./resolve.ts";

const NOW = 1_700_000_000_000;

function vendor(overrides: Partial<VendorConfig> = {}): VendorConfig {
  return {
    apiKey: "sk-secret",
    endpoint: "https://api.example/v1",
    model: "m",
    name: "A",
    balance: {
      apiPath: "/v1/balance",
    },
    oauth: {
      authorizeUrl: "https://api.example/authorize",
      clientId: "cid",
      tokenUrl: "https://api.example/token",
      scopes: [
        "balance:read",
      ],
    },
    probe: {
      enabled: false,
      interval: "5m",
      timeout: 1000,
    },
    ...overrides,
  };
}

function previous(overrides: Partial<AccountBalance> = {}): AccountBalance {
  return {
    balance: 5,
    currency: "CNY",
    error: null,
    source: "api",
    stale: false,
    syncedAt: NOW - 1000,
    topup: 100,
    vendor: "A",
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

describe("三档降级编排", () => {
  it("接口可用时用接口值，来源标为接口查询", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          balance: 9.5,
          currency: "USD",
        }),
      ),
    );

    await expect(
      resolveBalance(vendor(), {
        now: NOW,
      }),
    ).resolves.toEqual({
      balance: 9.5,
      currency: "USD",
      error: null,
      source: "api",
      stale: false,
      syncedAt: NOW,
      topup: null,
      vendor: "A",
    });
  });

  it("接口失败回落到 OAuth 授权查询", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(
        jsonResponse({
          balance: 7,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const row = await resolveBalance(vendor(), {
      now: NOW,
      readToken: () => ({
        accessToken: "tok",
        expiresAt: NOW + 60_000,
      }),
    });

    expect(row.source).toBe("oauth");
    expect(row.balance).toBe(7);
    expect(row.stale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("两档都不通时回落到手动填写", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    await expect(
      resolveBalance(
        vendor({
          balance: {
            apiPath: "/v1/balance",
            manual: 3.25,
            topup: 50,
          },
        }),
        {
          now: NOW,
        },
      ),
    ).resolves.toEqual({
      balance: 3.25,
      currency: "CNY",
      error: null,
      source: "manual",
      stale: false,
      syncedAt: NOW,
      topup: 50,
      vendor: "A",
    });
  });

  it("全部不可得时返回未知而不是 0", async () => {
    const row = await resolveBalance(
      vendor({
        balance: {},
      }),
      {
        now: NOW,
      },
    );

    expect(row.balance).toBeNull();
    expect(row.source).toBeNull();
    expect(row.error).toContain("未配置任何余额来源");
  });

  it("授权过期且没有上次值时返回未知并说明原因", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    const row = await resolveBalance(vendor(), {
      now: NOW,
      readToken: () => ({
        accessToken: "tok",
        expiresAt: NOW - 1,
      }),
    });

    expect(row.balance).toBeNull();
    expect(row.error).toContain("授权已过期");
  });

  it("全部失败但上次有值时保留旧值并标 stale", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    const row = await resolveBalance(vendor(), {
      now: NOW,
      previous: previous(),
    });

    expect(row.balance).toBe(5);
    expect(row.stale).toBe(true);
    expect(row.error).toContain("显示上次成功获取的值");
  });

  it("批量取数时单个供应商失败不影响其他行", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          balance: 2,
        }),
      ),
    );

    const rows = await resolveBalances(
      [
        vendor(),
        vendor({
          balance: {},
          name: "BAD",
        }),
      ],
      {
        now: NOW,
      },
    );

    expect(rows.map((row) => row.vendor)).toEqual([
      "A",
      "BAD",
    ]);
    expect(rows[0].balance).toBe(2);
    expect(rows[1].balance).toBeNull();
  });
});
