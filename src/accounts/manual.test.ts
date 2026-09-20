import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfigPath } from "../config.ts";
import { writeManualBalance } from "./manual.ts";

const cleanups: (() => void)[] = [];

const BASE_CONFIG = [
  "# 顶部注释必须保留",
  "vendors:",
  '  - name: "A"',
  '    endpoint: "https://api.example/v1"',
  '    model: "m"',
  "    # 未知字段也必须保留",
  "    custom_field: keep-me",
].join("\n");

function tempCwd(content = BASE_CONFIG): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-manual-"));
  const path = resolveConfigPath(dir);
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, content);
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  return dir;
}

function contentOf(cwd: string): string {
  return readFileSync(resolveConfigPath(cwd), "utf8");
}

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("手动填写余额写盘", () => {
  it("写入手动余额与充值，注释与未知字段原样保留，并生成备份", () => {
    const cwd = tempCwd();
    const before = contentOf(cwd);

    const result = writeManualBalance(cwd, "A", {
      balance: 42.6,
      topup: 200,
    });

    const after = contentOf(cwd);
    expect(after).toContain("# 顶部注释必须保留");
    expect(after).toContain("custom_field: keep-me");
    expect(after).toContain("manual: 42.6");
    expect(after).toContain("topup: 200");

    const backups = readdirSync(dirname(resolveConfigPath(cwd))).filter((name) =>
      name.includes(".bak-"),
    );
    expect(backups).toHaveLength(1);
    expect(result.backupPath.endsWith(backups[0])).toBe(true);
    expect(readFileSync(result.backupPath, "utf8")).toBe(before);
  });

  it("已有 balance 段时只补字段，不覆盖既有 api_path", () => {
    const cwd = tempCwd(
      [
        "vendors:",
        '  - name: "A"',
        '    endpoint: "https://api.example/v1"',
        '    model: "m"',
        "    balance:",
        '      api_path: "/v1/balance"',
      ].join("\n"),
    );

    writeManualBalance(cwd, "A", {
      balance: 1.5,
    });

    const after = contentOf(cwd);
    expect(after).toContain('api_path: "/v1/balance"');
    expect(after).toContain("manual: 1.5");
  });

  it("解析失败时拒绝写入，原文件一个字节都不动", () => {
    const broken = 'vendors:\n  - name: "A"\n    endpoint: [unclosed\n';
    const cwd = tempCwd(broken);

    expect(() =>
      writeManualBalance(cwd, "A", {
        balance: 1,
      }),
    ).toThrow(/语法错误/);
    expect(contentOf(cwd)).toBe(broken);
    expect(readdirSync(dirname(resolveConfigPath(cwd)))).toEqual([
      "config.yaml",
    ]);
  });

  it("找不到该供应商时拒绝写入", () => {
    const cwd = tempCwd();
    const before = contentOf(cwd);

    expect(() =>
      writeManualBalance(cwd, "不存在", {
        balance: 1,
      }),
    ).toThrow(/没有名为/);
    expect(contentOf(cwd)).toBe(before);
  });
});
