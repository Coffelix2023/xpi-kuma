import { describe, expect, it } from "vitest";
import { usageFingerprint } from "./fingerprint.ts";

const base = {
  costCacheRead: 0,
  costCacheWrite: 0,
  costInput: 0.001,
  costOutput: 0.002,
  costTotal: 0.003,
  messageAt: 1_727_000_000,
  model: "gpt-4",
  provider: "openai",
  sessionId: "sess-1",
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  tokensInput: 100,
  tokensOutput: 50,
};

describe("usageFingerprint", () => {
  it("相同字段得到相同指纹", () => {
    expect(usageFingerprint(base)).toBe(
      usageFingerprint({
        ...base,
      }),
    );
  });

  it("任一基础字段不同指纹即不同", () => {
    for (const override of [
      {
        messageAt: 1_727_000_001,
      },
      {
        sessionId: "sess-2",
      },
      {
        tokensInput: 101,
      },
      {
        costTotal: 0.004,
      },
      {
        model: "gpt-4o",
      },
    ]) {
      expect(
        usageFingerprint({
          ...base,
          ...override,
        }),
      ).not.toBe(usageFingerprint(base));
    }
  });

  it("费用浮点格式漂移不影响指纹", () => {
    // 0.1 + 0.2 的浮点尾巴被 toFixed(10) 归一
    expect(
      usageFingerprint({
        ...base,
        costTotal: 0.1 + 0.2,
      }),
    ).toBe(
      usageFingerprint({
        ...base,
        costTotal: 0.3,
      }),
    );
  });

  it("没有消息时间返回 undefined：旧行不走指纹对账", () => {
    const { messageAt: _omitted, ...withoutTime } = base;
    expect(usageFingerprint(withoutTime)).toBeUndefined();
  });
});
