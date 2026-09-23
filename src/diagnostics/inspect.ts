import { existsSync, readFileSync, type Stats, statSync } from "node:fs";
import { parseDocument } from "yaml";
import {
  ConfigError,
  DEFAULT_PROBE_INTERVAL,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_RETENTION_DAYS,
  parseConfigText,
  resolveConfigPath,
} from "../config.ts";
import { parseInterval } from "../monitors/vendor-monitor.ts";
import { defaultDatabasePath } from "../storage/database.ts";
import type { KumaConfig, VendorConfig } from "../types.ts";

/** 五项逐供应商检查的稳定标识；界面据此翻译标签。 */
export type VendorCheckKey = "apiKey" | "endpoint" | "models" | "probe" | "required";
/** 单项检查结果。`detail` 与 `action` 含动态值（如环境变量名），由服务端生成。 */
export interface DiagnosticsCheck {
  /** 下一步动作；检查通过时为 null */
  action: string | null;
  detail: string;
  key: VendorCheckKey;
  ok: boolean;
}

/** 一个供应商的体检结果。 */
export interface DiagnosticsVendor {
  checks: DiagnosticsCheck[];
  endpoint: string;
  /** 未通过的检查数 */
  issueCount: number;
  models: string[];
  name: string;
}

/** 全局与存储项。 */
export interface DiagnosticsGlobal {
  cwd: string;
  /** 用量库文件字节数；文件不存在时为 null */
  databaseBytes: number | null;
  databaseExists: boolean;
  databasePath: string;
  /** 探测默认间隔（未配置时使用的值） */
  probeInterval: string;
  probeTimeoutMs: number;
  retentionDays: number;
  /** 保留天数是否为内置默认值（配置里没写） */
  retentionIsDefault: boolean;
}

/**
 * 体检数据快照。
 *
 * `vendors` 与 `global` 在解析失败时一律为 null：**宁可什么都不展示，也不展示半截数据**
 * 或用默认值顶替（`config-diagnostics` spec 的「解析失败时 fail-closed」）。
 */
export interface DiagnosticsPayload {
  configExists: boolean;
  configModifiedAt: number | null;
  configPath: string;
  error: string | null;
  errorLine: number | null;
  generatedAt: number;
  global: DiagnosticsGlobal | null;
  /** 所有供应商未通过检查的总数 */
  issueCount: number;
  vendors: DiagnosticsVendor[] | null;
}

/** 环境变量占位符；与 config.ts 的展开规则保持一致。 */
const ENV_PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/i;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** mtime/大小这类元数据读不到就返回 null，不让体检因为一次 stat 失败整体挂掉。 */
function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * 只读地采集配置与存储状态。
 *
 * **绝不写盘**：不使用会创建模板的 `loadConfig()`，只看 `existsSync`；文件缺失只报告位置，
 * 解析失败只报告原因与行号，不修改原文件、不生成"修复后"副本。
 *
 * `cwd` 只用于在体检页展示「当前项目」；配置位置与它无关（全局唯一）。
 */
export function collectDiagnostics(cwd: string = process.cwd()): DiagnosticsPayload {
  const configPath = resolveConfigPath();
  const base: DiagnosticsPayload = {
    configExists: false,
    configModifiedAt: null,
    configPath,
    error: null,
    errorLine: null,
    generatedAt: Date.now(),
    global: null,
    issueCount: 0,
    vendors: null,
  };

  if (!existsSync(configPath)) {
    return {
      ...base,
      error: `配置文件不存在：${configPath}`,
    };
  }

  const stats = safeStat(configPath);
  const withFile: DiagnosticsPayload = {
    ...base,
    configExists: true,
    configModifiedAt: stats ? Math.round(stats.mtimeMs) : null,
  };

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    return {
      ...withFile,
      error: `配置文件不可读：${describeError(error)}`,
    };
  }

  let config: KumaConfig;
  try {
    config = parseConfigText(raw);
  } catch (error) {
    const line = error instanceof ConfigError ? error.line : undefined;
    return {
      ...withFile,
      error:
        error instanceof ConfigError
          ? error.message
          : `配置解析失败：${describeError(error)}`,
      errorLine: line ?? null,
    };
  }

  const vendors = config.vendors.map((vendor, index) =>
    inspectVendor(vendor, readRawEntry(raw, index)),
  );
  return {
    ...withFile,
    global: inspectGlobal(config, cwd, raw),
    issueCount: vendors.reduce((total, vendor) => total + vendor.issueCount, 0),
    vendors,
  };
}

/** 取原始 YAML 里第 index 个供应商条目（**未展开**环境变量，供 api_key 溯源）。 */
function readRawEntry(raw: string, index: number): Record<string, unknown> | null {
  // parseDocument 不抛错：语法问题体现在 document.errors 里，这里只取原始结构
  const parsed: unknown = parseDocument(raw).toJS();
  if (!isRecord(parsed) || !Array.isArray(parsed.vendors)) {
    return null;
  }
  const entry = parsed.vendors[index];
  return isRecord(entry) ? entry : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 描述 api_key 的来源：只暴露变量名，明文密钥一律不回显。 */
export function describeApiKeySource(rawValue: unknown): {
  label: string;
  variable: string | null;
} {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return {
      label: "未配置",
      variable: null,
    };
  }
  const match = ENV_PLACEHOLDER.exec(rawValue);
  if (match) {
    return {
      label: `\${${match[1]}}`,
      variable: match[1],
    };
  }
  return {
    label: "已配置（不是环境变量占位符）",
    variable: null,
  };
}

/** 逐供应商五项检查；每项未通过时都带一句可执行的下一步。 */
export function inspectVendor(
  vendor: VendorConfig,
  rawEntry: Record<string, unknown> | null,
): DiagnosticsVendor {
  const checks: DiagnosticsCheck[] = [
    {
      action: null,
      detail: "name / endpoint / models 均已配置",
      key: "required",
      ok: true,
    },
    endpointCheck(vendor),
    modelsCheck(vendor),
    apiKeyCheck(rawEntry),
    probeCheck(vendor),
  ];
  return {
    checks,
    endpoint: vendor.endpoint,
    issueCount: checks.filter((check) => !check.ok).length,
    models: vendor.models,
    name: vendor.name,
  };
}

function endpointCheck(vendor: VendorConfig): DiagnosticsCheck {
  const ok = /^https?:\/\//i.test(vendor.endpoint);
  return {
    key: "endpoint",
    ok,
    action: ok ? null : "补齐完整地址，例如 https://api.example.com/v1",
    detail: ok
      ? `已配置：${vendor.endpoint}`
      : `endpoint 必须以 http(s):// 开头，当前为 ${vendor.endpoint}`,
  };
}

function modelsCheck(vendor: VendorConfig): DiagnosticsCheck {
  const models = vendor.models;
  const ok = models.length > 0 && models.every((name) => name.trim() !== "");
  return {
    key: "models",
    ok,
    action: ok ? null : "填写该供应商要调用的模型 ID 列表（models 至少一项）",
    detail: ok ? `已配置 ${models.length} 个模型：${models.join("、")}` : "models 为空",
  };
}

function apiKeyCheck(rawEntry: Record<string, unknown> | null): DiagnosticsCheck {
  const source = describeApiKeySource(rawEntry?.api_key);
  if (source.variable === null) {
    return {
      action: '在配置里补 api_key: "${YOUR_KEY}"；不带密钥的请求会被服务商拒绝',
      detail: source.label,
      key: "apiKey",
      ok: false,
    };
  }
  const set = process.env[source.variable] !== undefined;
  return {
    action: set
      ? null
      : `导出该环境变量，或改成已存在的变量名：export ${source.variable}=...`,
    detail: set
      ? `${source.label} 已设置`
      : `${source.label} 当前未设置（仅显示变量名，不回显密钥值）`,
    key: "apiKey",
    ok: set,
  };
}

function probeCheck(vendor: VendorConfig): DiagnosticsCheck {
  const probe = vendor.probe;
  if (!probe.enabled) {
    return {
      action: null,
      detail: "探测已关闭（不会主动请求该供应商）",
      key: "probe",
      ok: true,
    };
  }
  try {
    const intervalMs = parseInterval(probe.interval);
    return {
      action: null,
      detail: `每 ${probe.interval}（${intervalMs} ms）探测一次，超时 ${probe.timeout} ms`,
      key: "probe",
      ok: true,
    };
  } catch {
    return {
      action: "改成 5m / 30s / 1h 这类形式",
      detail: `无法解析探测间隔 "${probe.interval}"`,
      key: "probe",
      ok: false,
    };
  }
}

function inspectGlobal(
  config: KumaConfig,
  cwd: string,
  raw: string,
): DiagnosticsGlobal {
  const databasePath = defaultDatabasePath();
  const exists = existsSync(databasePath);
  const stats = exists ? safeStat(databasePath) : null;
  return {
    cwd,
    databaseBytes: stats ? stats.size : null,
    databaseExists: exists,
    databasePath,
    probeInterval: DEFAULT_PROBE_INTERVAL,
    probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    retentionDays: config.retention.rawRecords,
    retentionIsDefault:
      config.retention.rawRecords === DEFAULT_RETENTION_DAYS && !hasRetention(raw),
  };
}

/** 原始 YAML 里是否显式写了 retention.raw_records。 */
function hasRetention(raw: string): boolean {
  return /^\s*retention\s*:/m.test(raw) && /raw_records\s*:/m.test(raw);
}
