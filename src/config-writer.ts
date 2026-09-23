import {
  chmodSync,
  copyFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isMap, isSeq, parseDocument } from "yaml";
import { resolveConfigPath } from "./config.ts";
import { parseInterval } from "./monitors/vendor-monitor.ts";

/** 面板写回的供应商字段（字段白名单；未知键不进配置文件）。 */
export interface VendorWriteInput {
  /** 环境变量占位符 `${VAR}` 原样保存；空串表示「不修改既有密钥」 */
  apiKey?: string;
  endpoint: string;
  models: string[];
  name: string;
  probeEnabled: boolean;
  /** 间隔，支持 `"5m"` / `"1h"` 形式 */
  probeInterval: string;
  /** 单次探测超时，毫秒 */
  probeTimeout: number;
}

export interface ConfigWriteResult {
  backupPath: string;
}
/**
 * 顶层正则常量。
 *
 * 写成模块级字面量而不是内联在函数里：这两个校验会被每次保存调用，
 * 内联会让 V8 每次重新编译同一个正则。
 */
const ENDPOINT_PATTERN = /^https?:\/\/\S+$/;
const ENV_PLACEHOLDER_PATTERN = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/** 备份文件时间戳后缀：ISO 8601 里不适合做文件名的字符换成 `-`。 */
function backupSuffix(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

/**
 * 字段白名单校验（fail-closed）：非法输入直接抛错，调用方保证零写盘。
 *
 * - `name` 非空；`endpoint` 必须 `http(s)://` 开头
 * - `models` 非空、去重后的字符串列表
 * - `probeInterval` 能被 `parseInterval` 解析；`probeTimeout` 为正整数
 */
export function validateVendorInput(input: VendorWriteInput): void {
  if (input.name.trim() === "") {
    throw new Error("供应商 name 不能为空");
  }
  if (!ENDPOINT_PATTERN.test(input.endpoint)) {
    throw new Error(`endpoint 必须以 http(s):// 开头，当前为 ${input.endpoint}`);
  }
  if (
    !Array.isArray(input.models) ||
    input.models.length === 0 ||
    input.models.some((m) => typeof m !== "string" || m.trim() === "")
  ) {
    throw new Error("models 必须是非空字符串列表");
  }
  parseInterval(input.probeInterval);
  if (!Number.isInteger(input.probeTimeout) || input.probeTimeout <= 0) {
    throw new Error("probe.timeout 必须是正整数毫秒");
  }
  if (
    input.apiKey !== undefined &&
    input.apiKey !== "" &&
    !ENV_PLACEHOLDER_PATTERN.test(input.apiKey)
  ) {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 文案里要展示占位符字面量
    throw new Error("api_key 只接受 ${VAR} 环境变量占位符，不接受明文");
  }
}

function readDocument(): {
  configPath: string;
  document: ReturnType<typeof parseDocument>;
} {
  const configPath = resolveConfigPath();
  const document = parseDocument(readFileSync(configPath, "utf8"));
  const syntaxError = document.errors[0];
  if (syntaxError) {
    throw new Error(`配置文件 YAML 语法错误：${syntaxError.message.trim()}`);
  }
  return {
    configPath,
    document,
  };
}

function vendorsSeq(document: ReturnType<typeof parseDocument>) {
  const vendors = document.get("vendors");
  if (vendors === null || vendors === undefined) {
    document.setIn(
      [
        "vendors",
      ],
      [],
    );
    return document.get("vendors");
  }
  if (!isSeq(vendors)) {
    throw new Error("配置文件的 vendors 必须是列表");
  }
  return vendors;
}

function buildVendorNode(
  input: VendorWriteInput,
  existingApiKey: unknown,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    endpoint: input.endpoint,
    name: input.name,
    models: [
      ...new Set(input.models),
    ],
    probe: {
      enabled: input.probeEnabled,
      interval: input.probeInterval,
      timeout: input.probeTimeout,
    },
  };
  // 留空 = 不修改既有密钥；填了占位符才写
  const apiKey =
    input.apiKey === "" || input.apiKey === undefined ? existingApiKey : input.apiKey;
  if (typeof apiKey === "string" && apiKey !== "") {
    node.api_key = apiKey;
  }
  return node;
}

/** 备份 + 临时文件 0600 + `rename` 原子替换；返回备份路径。 */
function commit(
  configPath: string,
  document: ReturnType<typeof parseDocument>,
): ConfigWriteResult {
  const backupPath = `${configPath}.bak-${backupSuffix(Date.now())}`;
  copyFileSync(configPath, backupPath);
  const tempPath = `${configPath}.tmp-${process.pid}`;
  writeFileSync(tempPath, String(document));
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, configPath);
  return {
    backupPath,
  };
}

/**
 * 新增或更新一个供应商（按 `name` 定位）。
 *
 * 纪律同 `accounts/manual.ts`：`Document` 定点改保住注释与未知字段、写前备份、
 * 临时文件 + `rename` 原子替换；校验失败零写盘。
 */
export function upsertVendor(input: VendorWriteInput): ConfigWriteResult {
  validateVendorInput(input);
  const { configPath, document } = readDocument();
  const seq = vendorsSeq(document);
  if (!isSeq(seq)) {
    throw new Error("配置文件的 vendors 必须是列表");
  }
  const index = seq.items.findIndex(
    (item) => isMap(item) && item.get("name") === input.name,
  );
  const existing = index === -1 ? undefined : seq.items[index];
  const existingApiKey = isMap(existing) ? existing.get("api_key") : undefined;
  const node = buildVendorNode(input, existingApiKey);
  if (isMap(existing)) {
    // 定点改字段：保住该供应商节点上的注释与未知字段
    for (const [key, value] of Object.entries(node)) {
      existing.set(key, value);
    }
    // 旧式单值 model 被 models 取代，避免双表示并存
    existing.delete("model");
  } else {
    seq.add(node);
  }
  return commit(configPath, document);
}

/** 按 `name` 删除供应商；找不到该供应商时抛错（零写盘）。 */
export function deleteVendor(name: string): ConfigWriteResult {
  if (name.trim() === "") {
    throw new Error("供应商 name 不能为空");
  }
  const { configPath, document } = readDocument();
  const seq = vendorsSeq(document);
  if (!isSeq(seq)) {
    throw new Error("配置文件的 vendors 必须是列表");
  }
  const index = seq.items.findIndex((item) => isMap(item) && item.get("name") === name);
  if (index === -1) {
    throw new Error(`配置文件里没有名为 ${name} 的供应商`);
  }
  seq.delete(index);
  return commit(configPath, document);
}
