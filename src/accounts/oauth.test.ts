import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VendorConfig } from "../types.ts";
import {
  defaultOAuthTokenPath,
  isTokenExpired,
  OAuthFlow,
  OAuthTokenStore,
} from "./oauth.ts";

const cleanups: (() => void)[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-oauth-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  return dir;
}

function vendor(overrides: Partial<VendorConfig> = {}): VendorConfig {
  return {
    endpoint: "https://api.example/v1",
    name: "A",
    models: [
      "m",
    ],
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

afterEach(() => {
  vi.unstubAllGlobals();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("令牌落盘", () => {
  it("写入后文件权限为 0600，读回内容一致", () => {
    const path = join(tempDir(), "oauth.json");
    const store = new OAuthTokenStore(path);
    store.write("A", {
      accessToken: "tok-1",
      expiresAt: 1_700_000_000_000,
    });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(store.read("A")).toEqual({
      accessToken: "tok-1",
      expiresAt: 1_700_000_000_000,
    });
    expect(store.read("B")).toBeNull();
  });

  it("第二次写入保留其它供应商的令牌", () => {
    const store = new OAuthTokenStore(join(tempDir(), "oauth.json"));
    store.write("A", {
      accessToken: "tok-a",
      expiresAt: 2,
    });
    store.write("B", {
      accessToken: "tok-b",
      expiresAt: 3,
    });

    expect(store.read("A")?.accessToken).toBe("tok-a");
    expect(store.read("B")?.accessToken).toBe("tok-b");
  });

  it("文件损坏时按未授权处理，不抛错", () => {
    const path = join(tempDir(), "oauth.json");
    writeFileSync(path, "{ 这不是 JSON");

    expect(new OAuthTokenStore(path).read("A")).toBeNull();
  });

  it("默认位置落在 agent 数据目录下", () => {
    expect(defaultOAuthTokenPath()).toMatch(/xpi-kuma[/\\]oauth\.json$/);
  });

  it("过期判定留安全余量", () => {
    const now = 1_000_000;
    expect(
      isTokenExpired(
        {
          accessToken: "t",
          expiresAt: now + 60_000,
        },
        now,
      ),
    ).toBe(false);
    // 距过期不足余量（30s）时按已过期处理
    expect(
      isTokenExpired(
        {
          accessToken: "t",
          expiresAt: now + 1_000,
        },
        now,
      ),
    ).toBe(true);
  });
});

describe("授权流程", () => {
  it("state 一次性：第一次命中，第二次拿不到供应商", () => {
    const flow = new OAuthFlow("http://127.0.0.1:1234/oauth/callback");
    const { state, url } = flow.begin(vendor());

    expect(url).toContain("client_id=cid");
    expect(url).toContain(encodeURIComponent("balance:read"));
    expect(flow.consume(state)).toBe("A");
    expect(flow.consume(state)).toBeNull();
  });

  it("授权地址非法时报错而不是抛 TypeError", () => {
    const flow = new OAuthFlow("http://127.0.0.1:1234/oauth/callback");
    expect(() =>
      flow.begin(
        vendor({
          oauth: {
            authorizeUrl: "not a url",
            clientId: "cid",
            scopes: [],
            tokenUrl: "https://api.example/token",
          },
        }),
      ),
    ).toThrow("authorize_url 不是合法的地址");
  });

  it("未配置 OAuth 时拒绝发起", () => {
    const flow = new OAuthFlow("http://127.0.0.1:1234/oauth/callback");
    expect(() =>
      flow.begin(
        vendor({
          oauth: undefined,
        }),
      ),
    ).toThrow("未配置 OAuth 授权");
  });

  it("用授权码换令牌并算出过期时间", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "tok",
        expires_in: 3600,
      }),
    );
    const flow = new OAuthFlow("http://127.0.0.1:1234/oauth/callback");

    await expect(
      flow.exchange(vendor(), "code-1", {
        fetchImpl: fetchMock as unknown as typeof fetch,
        now: 1000,
      }),
    ).resolves.toEqual({
      accessToken: "tok",
      expiresAt: 1000 + 3_600_000,
    });
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(String(init.body)).toContain("grant_type=authorization_code");
    // client secret 不参与换令牌：本地只存令牌与过期时间
    expect(String(init.body)).not.toContain("client_secret");
  });

  it("换令牌失败时报错，错误信息不含令牌", async () => {
    const flow = new OAuthFlow("http://127.0.0.1:1234/oauth/callback");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("nope", {
        status: 400,
      }),
    );

    await expect(
      flow.exchange(vendor(), "code-1", {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 400");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    json: () => Promise.resolve(body),
    status,
  } as Response;
}
