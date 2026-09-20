import { describe, expect, it, vi } from "vitest";
import { apiFragment } from "./api.ts";

/** 执行请求片段并取回内部的 api()；token 通过前导 var 注入。 */
function evalApi(token: string, fetchImpl: unknown) {
  const factory = new Function(
    "fetch",
    `var token = ${JSON.stringify(token)};\n${apiFragment()}\nreturn api;`,
  );
  return factory(fetchImpl) as (path: string, method?: string) => Promise<unknown>;
}

describe("apiFragment", () => {
  it("请求带 Bearer 凭据头", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
          }),
      }),
    );
    const api = evalApi("secret-token", fetchMock);

    await api("/api/dashboard?period=24h");

    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard?period=24h", {
      method: "GET",
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
  });

  it("POST 请求透传方法", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
          }),
      }),
    );
    const api = evalApi("t", fetchMock);

    await api("/api/probes", "POST");

    expect(fetchMock).toHaveBeenCalledWith("/api/probes", {
      method: "POST",
      headers: {
        Authorization: "Bearer t",
      },
    });
  });

  it("非 2xx 归一为带状态码的 Error", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
      }),
    );
    const api = evalApi("t", fetchMock);

    await expect(api("/api/dashboard")).rejects.toThrow("HTTP 401");
  });

  it("成功时解析 JSON", async () => {
    const body = {
      generatedAt: 1,
      period: "24h",
    };
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      }),
    );
    const api = evalApi("t", fetchMock);

    await expect(api("/api/dashboard")).resolves.toEqual(body);
  });
});
