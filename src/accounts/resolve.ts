import type { AccountBalance, VendorConfig } from "../types.ts";
import { fetchBalanceViaApi, fetchBalanceViaOAuth } from "./balance-api.ts";
import { isTokenExpired, type OAuthToken } from "./oauth.ts";

/** 编排依赖；全部可选，测试与服务层注入。 */
export interface ResolveBalanceDeps {
  /** 当前时间（毫秒）；默认 `Date.now()` */
  now?: number;
  /** 上一次的余额快照；本次全部失败时保留其数值并标 `stale` */
  previous?: AccountBalance | null;
  /** 读取该供应商的 OAuth 令牌；未授权返回 null */
  readToken?: (vendor: string) => OAuthToken | null;
}

/** 批量取数的依赖。 */
export interface ResolveBalancesDeps {
  now?: number;
  previousOf?: (vendor: string) => AccountBalance | null;
  readToken?: (vendor: string) => OAuthToken | null;
}

/**
 * 按「余额接口 → OAuth 授权 → 手动填写」三档降级取数。
 *
 * 每一档失败都**只记录不抛错**，继续往下一档走；全都拿不到时保留上一次已知值并标
 * `stale`，从未拿到过就返回 `balance: null`（界面显示「未知」）—— **绝不返回 0 顶替**。
 *
 * 手动填写放在最后一档而不是优先：自动取到的值更新鲜，用户填的值是自动档都不可用时的兜底。
 */
export async function resolveBalance(
  vendor: VendorConfig,
  deps: ResolveBalanceDeps = {},
): Promise<AccountBalance> {
  const now = deps.now ?? Date.now();
  const topup = vendor.balance?.topup ?? null;
  const apiPath = vendor.balance?.apiPath;
  const failures: string[] = [];

  if (apiPath && vendor.apiKey) {
    try {
      const result = await fetchBalanceViaApi(vendor);
      return success(vendor, result.balance, result.currency, "api", topup, now);
    } catch (error) {
      failures.push(`余额接口不可用（${describeFailure(error)}）`);
    }
  } else if (apiPath) {
    failures.push("余额接口缺少 API Key");
  }

  if (vendor.oauth && apiPath) {
    const token = deps.readToken?.(vendor.name) ?? null;
    if (token && !isTokenExpired(token, now)) {
      try {
        const result = await fetchBalanceViaOAuth(vendor, token.accessToken);
        return success(vendor, result.balance, result.currency, "oauth", topup, now);
      } catch (error) {
        failures.push(`授权查询失败（${describeFailure(error)}）`);
      }
    } else {
      failures.push(token ? "授权已过期" : "尚未完成授权");
    }
  }

  const manual = vendor.balance?.manual;
  if (manual !== undefined) {
    return success(vendor, manual, "CNY", "manual", topup, now);
  }

  return fallback(vendor, deps.previous ?? null, failures, topup);
}

/**
 * 逐个供应商取数。
 *
 * 单个供应商失败不影响其他行：失败的那行落成「未知 + 原因」，其余照常。
 */
export async function resolveBalances(
  vendors: VendorConfig[],
  deps: ResolveBalancesDeps = {},
): Promise<AccountBalance[]> {
  const now = deps.now ?? Date.now();
  const results: AccountBalance[] = [];
  for (const vendor of vendors) {
    try {
      results.push(
        await resolveBalance(vendor, {
          now,
          previous: deps.previousOf?.(vendor.name) ?? null,
          readToken: deps.readToken,
        }),
      );
    } catch (error) {
      results.push({
        balance: null,
        currency: "CNY",
        error: `取数失败：${describeFailure(error)}`,
        source: null,
        stale: false,
        syncedAt: null,
        topup: vendor.balance?.topup ?? null,
        vendor: vendor.name,
      });
    }
  }
  return results;
}

function success(
  vendor: VendorConfig,
  balance: number,
  currency: string,
  source: AccountBalance["source"],
  topup: number | null,
  now: number,
): AccountBalance {
  return {
    balance,
    currency,
    error: null,
    source,
    stale: false,
    syncedAt: now,
    topup,
    vendor: vendor.name,
  };
}

/**
 * 三档全不通时的收尾。
 *
 * 有上次成功值就保留它并标 `stale`（数值照旧可见，但明确标注是旧值）；没有就返回
 * `balance: null`，让界面显示「未知」。
 */
function fallback(
  vendor: VendorConfig,
  previous: AccountBalance | null,
  failures: string[],
  topup: number | null,
): AccountBalance {
  const reason = failures.length > 0 ? failures.join("；") : "未配置任何余额来源";
  if (previous && previous.balance !== null) {
    return {
      balance: previous.balance,
      currency: previous.currency,
      error: `${reason}（显示上次成功获取的值）`,
      source: previous.source,
      stale: true,
      syncedAt: previous.syncedAt,
      topup: topup ?? previous.topup,
      vendor: vendor.name,
    };
  }
  return {
    balance: null,
    currency: "CNY",
    error: reason,
    source: null,
    stale: false,
    syncedAt: null,
    topup,
    vendor: vendor.name,
  };
}

/** 只保留诊断所需信息；错误信息里不含任何凭据。 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
