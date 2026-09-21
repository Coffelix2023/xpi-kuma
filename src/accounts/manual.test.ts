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

/**
 * 切到新的临时 agent 目录并写入配置。
 *
 * 写回目标现在是全局配置，所以必须先把 `PI_CODING_AGENT_DIR` 指到临时目录，
 * 再解析路径 —— `getAgentDir()` 每次调用都读环境变量。
 */
function tempAgentDir(content = BASE_CONFIG): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-manual-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const path = resolveConfigPath();
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

function contentOf(): string {
  return readFileSync(resolveConfigPath(), "utf8");
}

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("手动填写余额写盘", () => {
  it("写入手动余额与充值，注释与未知字段原样保留，并生成备份", () => {
    tempAgentDir();
    const before = contentOf();

    const result = writeManualBalance("A", {
      balance: 42.6,
      topup: 200,
    });

    const after = contentOf();
    expect(after).toContain("# 顶部注释必须保留");
    expect(after).toContain("custom_field: keep-me");
    expect(after).toContain("manual: 42.6");
    expect(after).toContain("topup: 200");

    const backups = readdirSync(dirname(resolveConfigPath())).filter((name) =>
      name.includes(".bak-"),
    );
    expect(backups).toHaveLength(1);
    expect(result.backupPath.endsWith(backups[0])).toBe(true);
    expect(readFileSync(result.backupPath, "utf8")).toBe(before);
  });

  it("已有 balance 段时只补字段，不覆盖既有 api_path", () => {
    tempAgentDir(
      [
        "vendors:",
        '  - name: "A"',
        '    endpoint: "https://api.example/v1"',
        '    model: "m"',
        "    balance:",
        '      api_path: "/v1/balance"',
      ].join("\n"),
    );

    writeManualBalance("A", {
      balance: 1.5,
    });

    const after = contentOf();
    expect(after).toContain('api_path: "/v1/balance"');
    expect(after).toContain("manual: 1.5");
  });

  it("解析失败时拒绝写入，原文件一个字节都不动", () => {
    const broken = 'vendors:\n  - name: "A"\n    endpoint: [unclosed\n';
    tempAgentDir(broken);

    expect(() =>
      writeManualBalance("A", {
        balance: 1,
      }),
    ).toThrow(/语法错误/);
    expect(contentOf()).toBe(broken);
    expect(readdirSync(dirname(resolveConfigPath()))).toEqual([
      "config.yaml",
    ]);
  });

  it("找不到该供应商时拒绝写入", () => {
    tempAgentDir();
    const before = contentOf();

    expect(() =>
      writeManualBalance("不存在", {
        balance: 1,
      }),
    ).toThrow(/没有名为/);
    expect(contentOf()).toBe(before);
  });
});
