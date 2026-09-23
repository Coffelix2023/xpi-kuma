import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfigPath } from "../config.ts";
import { defaultDatabasePath } from "../storage/database.ts";
import { collectDiagnostics, describeApiKeySource } from "./inspect.ts";

const cleanups: (() => void)[] = [];
let agentDir = "";

function tempDir(prefix = "xpi-kuma-inspect-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  return dir;
}

/** 写进全局配置路径（`PI_CODING_AGENT_DIR` 已由 beforeEach 指到临时目录）。 */
function writeConfig(content: string): void {
  const path = resolveConfigPath();
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, content);
}

/** 最小可解析配置；`api_key` 用占位符，避免测试依赖真实密钥。 */
function configWith(extra: string): string {
  return [
    "vendors:",
    '  - name: "A"',
    '    endpoint: "https://api.example/v1"',
    '    model: "m"',
    '    api_key: "${XPI_KUMA_DIAG_KEY}"',
    extra,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

beforeEach(() => {
  agentDir = tempDir("xpi-kuma-agent-");
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.XPI_KUMA_DIAG_KEY;
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("只读体检", () => {
  it("文件缺失时只报告位置，不创建任何文件", () => {
    const dir = tempDir();
    const payload = collectDiagnostics(dir);

    expect(payload.configExists).toBe(false);
    expect(payload.error).toContain("配置文件不存在");
    expect(payload.vendors).toBeNull();
    expect(payload.global).toBeNull();
    // 只读：目录里不该出现模板或备份
    expect(readdirSync(dir)).toEqual([]);
  });

  it("解析失败时给出行号，且不展示半截供应商表与全局项", () => {
    const dir = tempDir();
    writeConfig(
      [
        "vendors:",
        '  - name: "A"',
        "    endpoint: [unclosed",
      ].join("\n"),
    );

    const payload = collectDiagnostics(dir);

    expect(payload.configExists).toBe(true);
    expect(payload.error).toContain("语法错误");
    expect(payload.errorLine).toBeGreaterThan(0);
    expect(payload.vendors).toBeNull();
    expect(payload.global).toBeNull();
    expect(payload.issueCount).toBe(0);
  });

  it("结构错误同样 fail-closed", () => {
    const dir = tempDir();
    writeConfig("vendors: 不是列表");

    const payload = collectDiagnostics(dir);

    expect(payload.error).toContain("vendors 必须是列表");
    expect(payload.vendors).toBeNull();
    expect(payload.global).toBeNull();
  });

  it("环境变量未设置时标注未设置并给出下一步", () => {
    const dir = tempDir();
    writeConfig(configWith(""));

    const payload = collectDiagnostics(dir);
    const vendor = payload.vendors?.[0];
    const check = vendor?.checks.find((item) => item.key === "apiKey");

    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("${XPI_KUMA_DIAG_KEY}");
    expect(check?.detail).toContain("未设置");
    expect(check?.action).toContain("export XPI_KUMA_DIAG_KEY");
    expect(vendor?.issueCount).toBeGreaterThan(0);
    expect(payload.issueCount).toBe(vendor?.issueCount);
  });

  it("环境变量已设置时该项通过", () => {
    process.env.XPI_KUMA_DIAG_KEY = "sk-secret-value";
    const dir = tempDir();
    writeConfig(configWith(""));

    const payload = collectDiagnostics(dir);
    const check = payload.vendors?.[0].checks.find((item) => item.key === "apiKey");

    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("${XPI_KUMA_DIAG_KEY} 已设置");
    // 密钥值绝不回显
    expect(JSON.stringify(payload)).not.toContain("sk-secret-value");
  });

  it("models 多模型全部列出，价格字段已被移除", () => {
    const dir = tempDir();
    writeConfig(configWith("").replace('    model: "m"', '    models: ["m-a", "m-b"]'));

    const checks = collectDiagnostics(dir).vendors?.[0].checks;

    const models = checks?.find((item) => item.key === "models");
    expect(models?.ok).toBe(true);
    expect(models?.detail).toContain("m-a、m-b");
    expect(checks?.some((item) => String(item.key) === "price")).toBe(false);
  });
  it("未配密钥时给出补齐占位符的建议", () => {
    const dir = tempDir();
    writeConfig(
      [
        "vendors:",
        '  - name: "A"',
        '    endpoint: "https://api.example/v1"',
        '    model: "m"',
      ].join("\n"),
    );

    const check = collectDiagnostics(dir).vendors?.[0].checks.find(
      (item) => item.key === "apiKey",
    );

    expect(check?.ok).toBe(false);
    expect(check?.detail).toBe("未配置");
    expect(check?.action).toContain("被服务商拒绝");
  });

  it("明文密钥不回显，只标注不是占位符", () => {
    const dir = tempDir();
    writeConfig(configWith("").replace('"${XPI_KUMA_DIAG_KEY}"', '"sk-plain-text"'));

    const payload = collectDiagnostics(dir);
    const check = payload.vendors?.[0].checks.find((item) => item.key === "apiKey");

    expect(check?.detail).toContain("不是环境变量占位符");
    expect(JSON.stringify(payload)).not.toContain("sk-plain-text");
  });

  it("api_key 来源描述只暴露变量名", () => {
    expect(describeApiKeySource("${OPENAI_API_KEY}")).toEqual({
      label: "${OPENAI_API_KEY}",
      variable: "OPENAI_API_KEY",
    });
    expect(describeApiKeySource("sk-live-123")).toEqual({
      label: "已配置（不是环境变量占位符）",
      variable: null,
    });
    expect(describeApiKeySource(undefined)).toEqual({
      label: "未配置",
      variable: null,
    });
  });
});

describe("全局与存储项", () => {
  it("用量库不存在时标注不存在，而不是 0 字节", () => {
    const dir = tempDir();
    writeConfig(configWith(""));

    const global = collectDiagnostics(dir).global;

    expect(global?.databaseExists).toBe(false);
    expect(global?.databaseBytes).toBeNull();
    expect(global?.databasePath).toBe(defaultDatabasePath());
    expect(global?.cwd).toBe(dir);
  });

  it("用量库存在时给出字节数", () => {
    const dir = tempDir();
    writeConfig(configWith(""));
    const dbPath = defaultDatabasePath();
    mkdirSync(dirname(dbPath), {
      recursive: true,
    });
    writeFileSync(dbPath, "1234567890");

    const global = collectDiagnostics(dir).global;

    expect(global?.databaseExists).toBe(true);
    expect(global?.databaseBytes).toBe(10);
  });

  it("保留天数标注是否为默认值，并带上探测默认参数", () => {
    const dir = tempDir();
    writeConfig(configWith(""));

    const withoutRetention = collectDiagnostics(dir).global;
    expect(withoutRetention?.retentionDays).toBe(7);
    expect(withoutRetention?.retentionIsDefault).toBe(true);
    expect(withoutRetention?.probeInterval).toBe("5m");
    expect(withoutRetention?.probeTimeoutMs).toBe(30_000);

    const explicit = tempDir();
    writeConfig(
      [
        configWith(""),
        "retention:",
        "  raw_records: 14",
      ].join("\n"),
    );
    const withRetention = collectDiagnostics(explicit).global;
    expect(withRetention?.retentionDays).toBe(14);
    expect(withRetention?.retentionIsDefault).toBe(false);
  });
});
