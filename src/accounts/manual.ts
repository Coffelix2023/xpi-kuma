import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isMap, parseDocument } from "yaml";
import { resolveConfigPath } from "../config.ts";

/** 手动填写的余额与累计充值。 */
export interface ManualBalanceInput {
  /** 当前余额（必填，是第三档降级的唯一依据） */
  balance: number;
  /** 累计充值（可选） */
  topup?: number;
}

/** 写入结果：备份文件路径。 */
export interface ManualBalanceResult {
  backupPath: string;
}

/** 备份文件的时间戳后缀：ISO 8601 里不适合做文件名的字符一律换成 `-`。 */
function backupSuffix(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把手动填写的余额写回全局配置 `~/.pi/agent/data/xpi-kuma/config.yaml`（第三档降级）。
 *
 * 三条纪律：
 *
 * 1. 用 yaml 的 `Document` API 定点改，注释与未知字段原样保留 —— 用户的配置文件不是
 *    本扩展的私产，不能整文件重写成我们认识的样子；
 * 2. 写前备份 `config.yaml.bak-<时间戳>`，写时临时文件 + `rename` 原子替换；
 * 3. 解析失败或找不到该供应商时**拒绝写入**，原文件一个字节都不动。
 */
export function writeManualBalance(
  vendorName: string,
  input: ManualBalanceInput,
): ManualBalanceResult {
  const configPath = resolveConfigPath();
  const raw = readFileSync(configPath, "utf8");
  const document = parseDocument(raw);
  const syntaxError = document.errors[0];
  if (syntaxError) {
    throw new Error(`配置文件 YAML 语法错误：${syntaxError.message.trim()}`);
  }

  const parsed: unknown = document.toJS();
  const vendors = isRecord(parsed) ? parsed.vendors : undefined;
  if (!Array.isArray(vendors)) {
    throw new Error("配置文件的 vendors 必须是非空列表");
  }
  const index = vendors.findIndex(
    (entry) => isRecord(entry) && entry.name === vendorName,
  );
  if (index === -1) {
    throw new Error(`配置文件里没有名为 ${vendorName} 的供应商`);
  }

  // balance 段可能还不存在；已有就原地补字段（保住既有 api_path），没有就整段建出来
  const balancePath = [
    "vendors",
    index,
    "balance",
  ];
  const extra: Record<string, number> = {
    manual: input.balance,
  };
  if (input.topup !== undefined) {
    extra.topup = input.topup;
  }
  const balanceNode = document.getIn(balancePath);
  if (isMap(balanceNode)) {
    for (const [key, value] of Object.entries(extra)) {
      balanceNode.set(key, value);
    }
  } else {
    document.setIn(balancePath, extra);
  }

  const backupPath = `${configPath}.bak-${backupSuffix(Date.now())}`;
  copyFileSync(configPath, backupPath);
  const tempPath = `${configPath}.tmp-${process.pid}`;
  writeFileSync(tempPath, String(document));
  renameSync(tempPath, configPath);
  return {
    backupPath,
  };
}
