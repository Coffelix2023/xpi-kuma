import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfigPath } from "./config.ts";
import { deleteVendor, upsertVendor, type VendorWriteInput } from "./config-writer.ts";

/**
 * 配置里出现的字面量占位符。
 *
 * 写成转义模板串而不是 `"${A_KEY}"`：后者会被 lint 当成漏替换的模板变量，
 * 也会让人误以为测试依赖某个真实环境变量。
 */
const A_KEY_PLACEHOLDER = `\${A_KEY}`;
const B_KEY_PLACEHOLDER = `\${B_KEY}`;

/** 写回后的 `models` 段落形状：列表项各占一行。 */
const MODELS_BLOCK = /models:\n\s+- m1\n\s+- m2/;
/** 旧式单值 `model:` 必须被彻底删掉，不能与 `models` 并存。 */
const LEGACY_MODEL_KEY = /^\s+model:/m;
/** 新增供应商只断言名字出现，不锁定 YAML 的引号风格。 */
const ADDED_NAME = /name: "?B"?/;
const cleanups: (() => void)[] = [];

const BASE_CONFIG = [
  "# 顶部注释必须保留",
  "vendors:",
  '  - name: "A"',
  '    endpoint: "https://api.example/v1"',
  '    model: "m"',
  `    api_key: "${A_KEY_PLACEHOLDER}"`,
  "    # 未知字段也必须保留",
  "    custom_field: keep-me",
  "",
  "retention:",
  "  raw_records: 7",
].join("\n");

function tempAgentDir(content = BASE_CONFIG): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-config-writer-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const path = resolveConfigPath();
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, content);
  return dir;
}

function readConfig(): string {
  return readFileSync(resolveConfigPath(), "utf8");
}

function input(overrides: Partial<VendorWriteInput> = {}): VendorWriteInput {
  return {
    endpoint: "https://api.example/v1",
    name: "A",
    probeEnabled: true,
    probeInterval: "5m",
    probeTimeout: 30_000,
    models: [
      "m1",
      "m2",
    ],
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("upsertVendor", () => {
  it("更新既有供应商：注释与未知字段保留、生成备份、权限 0600", () => {
    tempAgentDir();
    const configPath = resolveConfigPath();

    const result = upsertVendor(input());

    const written = readConfig();
    expect(written).toContain("# 顶部注释必须保留");
    expect(written).toContain("custom_field: keep-me");
    expect(written).toMatch(MODELS_BLOCK);
    // 旧式单值 model 被 models 取代
    expect(written).not.toMatch(LEGACY_MODEL_KEY);
    // api_key 留空 = 不修改，既有占位符保留
    expect(written).toContain(A_KEY_PLACEHOLDER);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);

    const backups = Object.keys(result);
    expect(backups).toEqual([
      "backupPath",
    ]);
    expect(readFileSync(result.backupPath, "utf8")).toBe(BASE_CONFIG);
  });

  it("新增供应商追加到 vendors 列表", () => {
    tempAgentDir();

    upsertVendor(
      input({
        name: "B",
      }),
    );

    const written = readConfig();
    expect(written).toMatch(ADDED_NAME);
    expect(written).toContain("# 顶部注释必须保留");
  });

  it("填入占位符时写入，明文 api_key 被拒绝", () => {
    tempAgentDir();

    upsertVendor(
      input({
        apiKey: B_KEY_PLACEHOLDER,
      }),
    );
    expect(readConfig()).toContain(B_KEY_PLACEHOLDER);

    const before = readConfig();
    expect(() =>
      upsertVendor(
        input({
          apiKey: "sk-plain-text",
        }),
      ),
    ).toThrow("占位符");
    expect(readConfig()).toBe(before);
  });

  it("非法输入零写盘", () => {
    tempAgentDir();
    const before = readConfig();
    const cases: Parameters<typeof input>[0][] = [
      {
        name: " ",
      },
      {
        endpoint: "ftp://x",
      },
      {
        models: [],
      },
      {
        models: [
          "",
        ],
      },
      {
        probeInterval: "5 minutes",
      },
      {
        probeTimeout: -1,
      },
    ];
    for (const overrides of cases) {
      expect(() => upsertVendor(input(overrides))).toThrow();
      expect(readConfig()).toBe(before);
    }
  });

  it("YAML 语法错误时零写盘", () => {
    tempAgentDir("vendors: [unclosed");
    expect(() => upsertVendor(input())).toThrow("YAML");
  });
});

describe("deleteVendor", () => {
  it("删除指定供应商并生成备份，其余内容保留", () => {
    tempAgentDir();

    const result = deleteVendor("A");

    const written = readConfig();
    expect(written).not.toContain('name: "A"');
    expect(written).toContain("# 顶部注释必须保留");
    expect(written).toContain("raw_records: 7");
    expect(readFileSync(result.backupPath, "utf8")).toBe(BASE_CONFIG);
  });

  it("供应商不存在时抛错且零写盘", () => {
    tempAgentDir();
    const before = readConfig();
    expect(() => deleteVendor("不存在")).toThrow("没有名为");
    expect(readConfig()).toBe(before);
  });

  it("name 为空时抛错", () => {
    tempAgentDir();
    expect(() => deleteVendor(" ")).toThrow("不能为空");
  });
});
