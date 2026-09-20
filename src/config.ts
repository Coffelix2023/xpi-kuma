import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import type {
  KumaConfig,
  RetentionConfig,
  VendorBalanceConfig,
  VendorConfig,
  VendorOAuthConfig,
  VendorProbeConfig,
} from "./types.ts";

/** 配置文件相对项目根的位置。 */
const CONFIG_RELATIVE_PATH = join(".pi", "xpi-kuma", "config.yaml");

/** 打包在扩展源码旁的模板。 */
const TEMPLATE_PATH = fileURLToPath(new URL("./config.example.yaml", import.meta.url));

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_INTERVAL = "5m";

/** 配置读取或校验失败；`line` 在 YAML 语法错误时有值。 */
export class ConfigError extends Error {
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `${message}（第 ${line} 行）`);
    this.name = "ConfigError";
    this.line = line;
  }
}

export interface LoadConfigOptions {
  /** 是否在文件缺失时创建模板，默认 true */
  createIfMissing?: boolean;
  /** 项目根目录，默认 `process.cwd()` */
  cwd?: string;
}

/** 解析后的配置文件绝对路径。 */
export function resolveConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, CONFIG_RELATIVE_PATH);
}

/** 读取旁置模板内容，用于首次运行时创建配置文件。 */
export function readConfigTemplate(): string {
  return readFileSync(TEMPLATE_PATH, "utf8");
}

/**
 * 加载 `.pi/xpi-kuma/config.yaml`。
 *
 * 文件缺失时从模板创建后再读；语法错误、必填字段缺失或类型不符一律抛
 * `ConfigError`（fail-closed），由调用方决定如何提示用户。
 */
export function loadConfig(options: LoadConfigOptions = {}): KumaConfig {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd);
  const createIfMissing = options.createIfMissing ?? true;

  if (!existsSync(configPath)) {
    if (!createIfMissing) {
      throw new ConfigError(`配置文件不存在：${configPath}`);
    }
    mkdirSync(dirname(configPath), {
      recursive: true,
    });
    copyFileSync(TEMPLATE_PATH, configPath);
  }

  const raw = readFileSync(configPath, "utf8");
  const document = parseDocument(raw);
  const syntaxError = document.errors[0];
  if (syntaxError) {
    throw new ConfigError(
      `配置文件 YAML 语法错误：${syntaxError.message.trim()}`,
      syntaxError.linePos?.[0]?.line,
    );
  }

  const parsed: unknown = document.toJS();
  if (!isRecord(parsed)) {
    throw new ConfigError("配置文件根节点必须是映射（键值对）");
  }

  return {
    retention: parseRetention(parsed.retention),
    vendors: parseVendors(parsed.vendors),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`vendors[${index}] 缺少必填字段 ${field}`);
  }
  return value;
}

/** 把 `${ENV_VAR}` 占位符替换为环境变量值；未设置时保留原样以便用户察觉。 */
export function expandEnvPlaceholders(value: string): string {
  return value.replace(
    /\$\{([A-Z0-9_]+)\}/gi,
    (match, name: string) => process.env[name] ?? match,
  );
}

function parseProbe(value: unknown, index: number): VendorProbeConfig {
  if (!isRecord(value)) {
    return {
      enabled: false,
      interval: DEFAULT_PROBE_INTERVAL,
      timeout: DEFAULT_PROBE_TIMEOUT_MS,
    };
  }
  const timeout = value.timeout;
  if (timeout !== undefined && (typeof timeout !== "number" || timeout <= 0)) {
    throw new ConfigError(`vendors[${index}].probe.timeout 必须是正数（毫秒）`);
  }
  const interval = value.interval;
  if (interval !== undefined && typeof interval !== "string") {
    throw new ConfigError(`vendors[${index}].probe.interval 必须是字符串，例如 "5m"`);
  }
  return {
    enabled: value.enabled === true,
    interval: interval ?? DEFAULT_PROBE_INTERVAL,
    timeout: timeout ?? DEFAULT_PROBE_TIMEOUT_MS,
  };
}

/**
 * 解析供应商的余额配置。
 *
 * 段缺失视为「未配置」，不做任何猜测性请求；段存在但字段类型不符即抛
 * `ConfigError`（fail-closed）。
 */
function parseVendorBalance(
  value: unknown,
  index: number,
): VendorBalanceConfig | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ConfigError(`vendors[${index}].balance 必须是映射`);
  }
  const apiPath = readOptionalString(
    value.api_path,
    `vendors[${index}].balance.api_path`,
  );
  const manual = readOptionalNumber(value.manual, `vendors[${index}].balance.manual`);
  const topup = readOptionalNumber(value.topup, `vendors[${index}].balance.topup`);
  const balance: VendorBalanceConfig = {};
  if (apiPath !== undefined) {
    balance.apiPath = apiPath;
  }
  if (manual !== undefined) {
    balance.manual = manual;
  }
  if (topup !== undefined) {
    balance.topup = topup;
  }
  return balance;
}

/**
 * 解析供应商的 OAuth 配置。
 *
 * 四项齐全才算配置完整；缺项视为未配置授权，不报错 —— 用户可能只用余额接口。
 */
function parseVendorOAuth(
  value: unknown,
  index: number,
): VendorOAuthConfig | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ConfigError(`vendors[${index}].oauth 必须是映射`);
  }
  const authorizeUrl = readOptionalString(
    value.authorize_url,
    `vendors[${index}].oauth.authorize_url`,
  );
  const tokenUrl = readOptionalString(
    value.token_url,
    `vendors[${index}].oauth.token_url`,
  );
  const clientId = readOptionalString(
    value.client_id,
    `vendors[${index}].oauth.client_id`,
  );
  const scopes = readOptionalStringArray(
    value.scopes,
    `vendors[${index}].oauth.scopes`,
  );
  if (!authorizeUrl || !tokenUrl || !clientId || !scopes) {
    return undefined;
  }
  return {
    authorizeUrl,
    clientId,
    scopes,
    tokenUrl,
  };
}

/** 读取可选字符串；出现但为空或类型不符即抛 `ConfigError`。 */
function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${field} 必须是非空字符串`);
  }
  return value;
}

/** 读取可选数字；出现但类型不符即抛 `ConfigError`。 */
function readOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError(`${field} 必须是数字`);
  }
  return value;
}

/** 读取可选字符串列表；出现但元素类型不符即抛 `ConfigError`。 */
function readOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ConfigError(`${field} 必须是字符串列表`);
  }
  return value as string[];
}

function parseVendors(value: unknown): VendorConfig[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ConfigError("vendors 必须是列表");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ConfigError(`vendors[${index}] 必须是映射`);
    }
    const apiKey = entry.api_key;
    if (apiKey !== undefined && typeof apiKey !== "string") {
      throw new ConfigError(`vendors[${index}].api_key 必须是字符串`);
    }
    const price = entry.price;
    const balance = parseVendorBalance(entry.balance, index);
    const oauth = parseVendorOAuth(entry.oauth, index);
    return {
      apiKey: apiKey === undefined ? undefined : expandEnvPlaceholders(apiKey),
      balance,
      endpoint: requireString(entry.endpoint, "endpoint", index),
      model: requireString(entry.model, "model", index),
      name: requireString(entry.name, "name", index),
      oauth,
      price:
        isRecord(price) &&
        typeof price.input === "number" &&
        typeof price.output === "number"
          ? {
              input: price.input,
              output: price.output,
            }
          : undefined,
      probe: parseProbe(entry.probe, index),
    };
  });
}

function parseRetention(value: unknown): RetentionConfig {
  if (value === undefined || value === null) {
    return {
      rawRecords: DEFAULT_RETENTION_DAYS,
    };
  }
  if (!isRecord(value)) {
    throw new ConfigError("retention 必须是映射");
  }
  const days = value.raw_records;
  if (days === undefined) {
    return {
      rawRecords: DEFAULT_RETENTION_DAYS,
    };
  }
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
    throw new ConfigError("retention.raw_records 必须是非负数字（天）");
  }
  return {
    rawRecords: days,
  };
}
