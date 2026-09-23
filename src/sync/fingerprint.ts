import { createHash } from "node:crypto";

/**
 * 指纹输入：两侧（实时事件与日志条目）都能稳定提供的字段。
 *
 * 会话、消息时间、provider/model、token 计数与费用字段构成对账的基础键；
 * 内容摘要不进指纹 —— 只在两端都有且候选相同时辅助消歧（ADR 0001）。
 */
export interface FingerprintInput {
  costCacheRead: number;
  costCacheWrite: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  messageAt?: number;
  model: string;
  provider: string;
  sessionId: string;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensInput: number;
  tokensOutput: number;
}

/** 费用用固定精度序列化：浮点格式漂移不能让同一调用的两侧指纹不同。 */
function costPart(value: number): string {
  return value.toFixed(10);
}

/**
 * 计算 usage 行的实时/日志对账指纹（sha256 hex）。
 *
 * 没有消息时间时返回 `undefined`：伪造一个消息时间会让缺少该字段的旧行
 * 错误碰撞，旧行对账走保守路径，不靠指纹。
 */
export function usageFingerprint(input: FingerprintInput): string | undefined {
  if (input.messageAt === undefined) {
    return undefined;
  }
  const parts = [
    input.sessionId,
    String(input.messageAt),
    input.provider,
    input.model,
    input.tokensInput,
    input.tokensOutput,
    input.tokensCacheRead,
    input.tokensCacheWrite,
    costPart(input.costInput),
    costPart(input.costOutput),
    costPart(input.costCacheRead),
    costPart(input.costCacheWrite),
    costPart(input.costTotal),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
