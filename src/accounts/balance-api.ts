import type { VendorConfig } from "../types.ts";

/** 余额接口的默认超时；与探测一样用 `AbortController` 兜住挂起的连接。 */
export const DEFAULT_BALANCE_TIMEOUT_MS = 10_000;

/** 余额查询的成功结果。 */
export interface BalanceQueryResult {
  balance: number;
  currency: string;
}

/**
 * 余额接口取数（三档降级的第一档）。
 *
 * **只请求配置里显式声明的路径**：`balance.api_path` 缺失就直接失败，绝不猜测服务商的
 * 余额端点（探测结论见 `docs/probe-balance-and-oauth.md`）。
 *
 * 响应结构各家不一，因此用宽容但有界的解析：在响应体里找第一个「键名像余额」的数值字段。
 * 错误信息只保留状态码或网络错误类别，不含 URL 之外的任何凭据。
 */
export async function fetchBalanceViaApi(
  vendor: VendorConfig,
  options: {
    timeoutMs?: number;
  } = {},
): Promise<BalanceQueryResult> {
  const apiPath = vendor.balance?.apiPath;
  if (!apiPath) {
    throw new Error("未配置余额接口路径");
  }
  if (!vendor.apiKey) {
    throw new Error("未配置 API Key");
  }
  return requestBalance(
    resolveBalanceUrl(vendor.endpoint, apiPath),
    vendor.apiKey,
    options.timeoutMs,
  );
}

/**
 * 用 OAuth 访问令牌查询同一个余额接口（第二档）。
 *
 * 与第一档共用同一个路径与解析：差别只在凭据来源。
 */
export async function fetchBalanceViaOAuth(
  vendor: VendorConfig,
  accessToken: string,
  options: {
    timeoutMs?: number;
  } = {},
): Promise<BalanceQueryResult> {
  const apiPath = vendor.balance?.apiPath;
  if (!apiPath) {
    throw new Error("未配置余额接口路径");
  }
  return requestBalance(
    resolveBalanceUrl(vendor.endpoint, apiPath),
    accessToken,
    options.timeoutMs,
  );
}

/** 拼接余额接口地址：以 `http` 开头按绝对地址，否则挂在 `endpoint` 下。 */
export function resolveBalanceUrl(endpoint: string, apiPath: string): string {
  if (/^https?:\/\//i.test(apiPath)) {
    return apiPath;
  }
  return `${endpoint.replace(/\/$/, "")}/${apiPath.replace(/^\//, "")}`;
}

async function requestBalance(
  url: string,
  token: string,
  timeoutMs: number = DEFAULT_BALANCE_TIMEOUT_MS,
): Promise<BalanceQueryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    const balance = findBalance(payload);
    if (balance === undefined) {
      throw new Error("响应里没有可识别的余额字段");
    }
    return {
      balance,
      currency: findCurrency(payload) ?? "CNY",
    };
  } catch (error) {
    throw new Error(describeBalanceError(error));
  } finally {
    clearTimeout(timer);
  }
}

/** 键名看起来像余额的字段；不做语言模型式的猜测，只认这几个词根。 */
const BALANCE_KEY = /(balance|credit|available|remaining|quota)/i;
/** 键名看起来像币种的字段。 */
const CURRENCY_KEY = /(currency|unit)/i;
/** 递归深度上限：服务商返回嵌套结构，但不该无限深。 */
const MAX_DEPTH = 4;

/**
 * 在响应体里广度优先找第一个余额数值。
 *
 * 优先匹配键名含 balance/credit 等词根的字段；找不到返回 `undefined`（调用方据此判失败），
 * 不做「随便挑一个数字」的兜底 —— 那会把 token 数当成钱。
 */
export function findBalance(payload: unknown): number | undefined {
  return findNumber(payload, BALANCE_KEY);
}

/** 找币种字符串；找不到返回 undefined，由调用方回落到默认币种。 */
export function findCurrency(payload: unknown): string | undefined {
  return findString(payload, CURRENCY_KEY);
}

function findNumber(root: unknown, keyPattern: RegExp): number | undefined {
  let level: unknown[] = [
    root,
  ];
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const node of level) {
      if (!isRecord(node)) {
        continue;
      }
      for (const [key, value] of Object.entries(node)) {
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          keyPattern.test(key)
        ) {
          return value;
        }
        if (isRecord(value) || Array.isArray(value)) {
          next.push(value);
        }
      }
    }
    level = next;
  }
  return undefined;
}

function findString(root: unknown, keyPattern: RegExp): string | undefined {
  let level: unknown[] = [
    root,
  ];
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const node of level) {
      if (!isRecord(node)) {
        continue;
      }
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string" && value.trim() !== "" && keyPattern.test(key)) {
          return value;
        }
        if (isRecord(value) || Array.isArray(value)) {
          next.push(value);
        }
      }
    }
    level = next;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只保留诊断所需信息：超时归一为 `timeout`，其余用原始 message（不含凭据）。 */
function describeBalanceError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "timeout" : error.message;
  }
  return String(error);
}
