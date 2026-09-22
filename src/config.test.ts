import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_DASHBOARD_PORT,
  expandEnvPlaceholders,
  loadConfig,
  readConfigTemplate,
  resolveConfigPath,
} from "./config.ts";

const cleanups: (() => void)[] = [];

/**
 * 切到一个新的临时 agent 目录。
 *
 * 配置现在只从全局目录读写，隔离只能靠 `PI_CODING_AGENT_DIR` —— `getAgentDir()`
 * 每次调用都读环境变量，因此逐个用例切换即可。
 */
function tempAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-config-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

function writeConfig(content: string): void {
  const path = resolveConfigPath();
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, content);
}

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("loadConfig", () => {
  it("解析仓库自带的示例配置", () => {
    tempAgentDir();
    writeConfig(readConfigTemplate());

    const config = loadConfig();

    expect(config.vendors).toHaveLength(4);
    expect(config.vendors[0]).toMatchObject({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      name: "OpenAI",
      price: {
        input: 0.15,
        output: 0.6,
      },
      probe: {
        enabled: true,
        interval: "5m",
        timeout: 30_000,
      },
    });
    expect(config.vendors[2].probe.enabled).toBe(false);
    expect(config.retention).toEqual({
      rawRecords: 7,
    });
  });

  it("文件不存在时从模板自动创建", () => {
    tempAgentDir();
    const configPath = resolveConfigPath();

    const config = loadConfig();

    expect(readFileSync(configPath, "utf8")).toBe(readConfigTemplate());
    expect(config.vendors.length).toBeGreaterThan(0);
  });

  it("createIfMissing=false 时文件缺失抛错", () => {
    tempAgentDir();
    expect(() =>
      loadConfig({
        createIfMissing: false,
      }),
    ).toThrow(ConfigError);
  });

  it("缺少必填字段时抛错", () => {
    tempAgentDir();
    writeConfig("vendors:\n  - name: OpenAI\n    model: gpt-4o-mini\n");
    expect(() => loadConfig()).toThrow(/endpoint/);
  });

  it("非法 probe.timeout 抛错", () => {
    tempAgentDir();
    writeConfig(
      'vendors:\n  - name: OpenAI\n    endpoint: "https://x/v1"\n    model: m\n    probe:\n      timeout: -1\n',
    );
    expect(() => loadConfig()).toThrow(/timeout/);
  });

  it("无 vendors 时返回空列表", () => {
    tempAgentDir();
    writeConfig("retention:\n  raw_records: 3\n");
    const config = loadConfig();
    expect(config.vendors).toEqual([]);
    expect(config.retention).toEqual({
      rawRecords: 3,
    });
  });
});

describe("dashboard.port", () => {
  it("段缺失时用内置默认端口", () => {
    tempAgentDir();
    writeConfig("vendors: []\n");
    expect(loadConfig().dashboard).toEqual({
      port: DEFAULT_DASHBOARD_PORT,
    });
  });

  it("解析自定义端口", () => {
    tempAgentDir();
    writeConfig("dashboard:\n  port: 6001\nvendors: []\n");
    expect(loadConfig().dashboard.port).toBe(6001);
  });

  it("非 1..65535 的整数一律抛 ConfigError", () => {
    for (const port of [
      "0",
      "65536",
      '"5180"',
      "1.5",
    ]) {
      tempAgentDir();
      writeConfig(`dashboard:\n  port: ${port}\nvendors: []\n`);
      expect(() => loadConfig(), port).toThrow(ConfigError);
    }
  });

  it("dashboard 不是映射时抛错", () => {
    tempAgentDir();
    writeConfig("dashboard: 5180\nvendors: []\n");
    expect(() => loadConfig()).toThrow("dashboard 必须是映射");
  });
});

/**
 * 随包模板是唯一的用户入口：它一旦失效，用户照抄就会踩坑，因此在这里锁住。
 */
describe("示例配置文件", () => {
  function parseAsConfig(content: string) {
    tempAgentDir();
    writeConfig(content);
    return loadConfig();
  }

  it("随包模板可被正常解析", () => {
    const config = parseAsConfig(readConfigTemplate());
    expect(config.vendors.map((v) => v.name)).toEqual([
      "OpenAI",
      "Anthropic",
      "9router",
      "commandcode",
    ]);
    expect(config.retention).toEqual({
      rawRecords: 7,
    });
  });

  it("示例里不含明文密钥，只用环境变量占位", () => {
    const config = parseAsConfig(readConfigTemplate());
    for (const vendor of config.vendors) {
      expect(vendor.apiKey).toMatch(/^\$\{[A-Z0-9_]+\}$/);
    }
  });
});
describe("YAML 语法错误", () => {
  it("抛出包含行号的友好错误", () => {
    tempAgentDir();
    writeConfig("vendors:\n  - name: OpenAI\n   model: broken-indent\n");

    let caught: unknown;
    try {
      loadConfig();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toMatch(/YAML 语法错误/);
    expect((caught as ConfigError).message).toMatch(/第 3 行/);
    expect((caught as ConfigError).line).toBe(3);
  });

  it("根节点不是映射时抛错", () => {
    tempAgentDir();
    writeConfig("- just\n- a\n- list\n");
    expect(() => loadConfig()).toThrow(/根节点/);
  });
});

describe("expandEnvPlaceholders", () => {
  it("替换已设置的环境变量", () => {
    process.env.XPI_KUMA_TEST_KEY = "sk-test";
    expect(expandEnvPlaceholders("${XPI_KUMA_TEST_KEY}")).toBe("sk-test");
    delete process.env.XPI_KUMA_TEST_KEY;
  });

  it("未设置的变量保留原样，便于用户察觉", () => {
    delete process.env.XPI_KUMA_MISSING;
    expect(expandEnvPlaceholders("${XPI_KUMA_MISSING}")).toBe("${XPI_KUMA_MISSING}");
  });

  it("加载配置时解析 api_key 占位符", () => {
    tempAgentDir();
    process.env.XPI_KUMA_TEST_KEY = "sk-test";
    writeConfig(
      'vendors:\n  - name: OpenAI\n    endpoint: "https://x/v1"\n    model: m\n    api_key: "${XPI_KUMA_TEST_KEY}"\n',
    );

    const config = loadConfig();
    delete process.env.XPI_KUMA_TEST_KEY;

    expect(config.vendors[0].apiKey).toBe("sk-test");
  });
});

describe("余额与授权配置段", () => {
  it("段缺失时视为未配置", () => {
    tempAgentDir();
    writeConfig(
      [
        "vendors:",
        '  - name: "A"',
        '    endpoint: "https://api.example/v1"',
        '    model: "m"',
      ].join("\n"),
    );

    const config = loadConfig();

    expect(config.vendors[0].balance).toBeUndefined();
    expect(config.vendors[0].oauth).toBeUndefined();
  });

  it("解析 balance 与 oauth 段", () => {
    tempAgentDir();
    writeConfig(
      [
        "vendors:",
        '  - name: "A"',
        '    endpoint: "https://api.example/v1"',
        '    model: "m"',
        "    balance:",
        '      api_path: "/v1/balance"',
        "      manual: 42.6",
        "      topup: 200",
        "    oauth:",
        '      authorize_url: "https://api.example/authorize"',
        '      token_url: "https://api.example/token"',
        '      client_id: "cid"',
        '      scopes: ["balance:read"]',
      ].join("\n"),
    );

    const config = loadConfig();

    expect(config.vendors[0].balance).toEqual({
      apiPath: "/v1/balance",
      manual: 42.6,
      topup: 200,
    });
    expect(config.vendors[0].oauth).toEqual({
      authorizeUrl: "https://api.example/authorize",
      clientId: "cid",
      tokenUrl: "https://api.example/token",
      scopes: [
        "balance:read",
      ],
    });
  });

  it("字段类型错误一律抛 ConfigError", () => {
    const cases = [
      [
        'balance: "nope"',
        /balance 必须是映射/,
      ],
      [
        'balance:\n      manual: "free"',
        /balance\.manual 必须是数字/,
      ],
      [
        'oauth:\n      scopes: "balance:read"',
        /oauth\.scopes 必须是字符串列表/,
      ],
      [
        "oauth:\n      client_id: 42",
        /oauth\.client_id 必须是非空字符串/,
      ],
    ] as const;

    for (const [segment, pattern] of cases) {
      tempAgentDir();
      writeConfig(
        [
          "vendors:",
          '  - name: "A"',
          '    endpoint: "https://api.example/v1"',
          '    model: "m"',
          ...segment.split("\n").map((line) => `    ${line}`),
        ].join("\n"),
      );

      expect(() => loadConfig()).toThrow(pattern);
    }
  });

  it("OAuth 段缺项按未配置处理，不报错", () => {
    tempAgentDir();
    writeConfig(
      [
        "vendors:",
        '  - name: "A"',
        '    endpoint: "https://api.example/v1"',
        '    model: "m"',
        "    oauth:",
        '      client_id: "cid"',
      ].join("\n"),
    );

    const config = loadConfig();

    expect(config.vendors[0].oauth).toBeUndefined();
  });
});
