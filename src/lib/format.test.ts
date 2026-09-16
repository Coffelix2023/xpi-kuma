import { describe, expect, it } from "vitest";
import { formatCost, formatStatus, formatTokens } from "./format.ts";

describe("formatTokens", () => {
  it("小于 1000 显示原始数字", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("1000 至 999999 显示 K 并保留一位小数", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1234)).toBe("1.2K");
    expect(formatTokens(12345)).toBe("12.3K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  it("100 万及以上显示 M 并保留一位小数", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_234_567)).toBe("1.2M");
  });

  it("非数值返回 - 以支持降级显示", () => {
    expect(formatTokens(Number.NaN)).toBe("-");
    expect(formatTokens(-1)).toBe("-");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("formatCost", () => {
  it("保留两位小数并加 ¥ 前缀", () => {
    expect(formatCost(0)).toBe("¥0.00");
    expect(formatCost(0.05)).toBe("¥0.05");
    expect(formatCost(0.153)).toBe("¥0.15");
  });

  it("非数值返回 -", () => {
    expect(formatCost(Number.NaN)).toBe("-");
  });
});

describe("formatStatus", () => {
  it("按 footer 约定拼接", () => {
    expect(
      formatStatus({
        totalCost: 0.05,
        totalTokens: 1234,
      }),
    ).toBe("💰 ¥0.05 | 📊 1.2K");
  });

  it("会话开始时显示零值", () => {
    expect(
      formatStatus({
        totalCost: 0,
        totalTokens: 0,
      }),
    ).toBe("💰 ¥0.00 | 📊 0");
  });

  it("数值异常时降级而不抛错", () => {
    expect(
      formatStatus({
        totalCost: Number.NaN,
        totalTokens: Number.NaN,
      }),
    ).toBe("💰 - | 📊 -");
  });
});
