import type { FileLogger } from "../lib/log.ts";
import type { Database } from "../storage/database.ts";
import type { AccountBalance, KumaConfig, VendorConfig } from "../types.ts";
import { type ManualBalanceInput, writeManualBalance } from "./manual.ts";
import { OAuthFlow, OAuthTokenStore } from "./oauth.ts";
import { resolveBalances } from "./resolve.ts";

/** 明细表的一行：余额快照 + 该供应商的模型列表，表格展示成「供应商 · 模型1、模型2」。 */
export interface AccountRow extends AccountBalance {
  models: string[];
}

/**
 * 账户页概览。
 *
 * `manualCount` 与 `staleCount` 是「不可信说明」的数据来源：手动填写的值、授权过期后
 * 保留的旧值都在这里单独计数，界面据此说明有多少数字不是自动取到的最新值。
 */
export interface AccountOverview {
  /** 已知余额合计；一个数字都没有时为 null（显示「未知」，不是 0） */
  balanceTotal: number | null;
  knownCount: number;
  manualCount: number;
  staleCount: number;
  /** 已知累计充值合计；一个都没有时为 null */
  topupTotal: number | null;
  unknownCount: number;
  vendorCount: number;
}

/** `GET /api/accounts` 的响应体。 */
export interface AccountsPayload {
  generatedAt: number;
  overview: AccountOverview;
  rows: AccountRow[];
}

export interface AccountServiceOptions {
  config: KumaConfig;
  database: Database;
  logger: FileLogger;
  tokenStore?: OAuthTokenStore;
}

/**
 * 供应商账户取数与展示的服务层。
 *
 * 组合三件事：三档降级取数（`resolve.ts`）、余额快照落库（`account_balances`）、以及
 * OAuth 授权流程与手动填写写盘。所有对外方法都**只返回可展示的信息**，凭据不进返回值。
 */
export class AccountService {
  private readonly config: KumaConfig;
  private readonly database: Database;
  private readonly logger: FileLogger;
  private readonly tokenStore: OAuthTokenStore;
  private readonly flow = new OAuthFlow("");

  constructor(options: AccountServiceOptions) {
    this.config = options.config;
    this.database = options.database;
    this.logger = options.logger;
    this.tokenStore = options.tokenStore ?? new OAuthTokenStore();
  }

  /** 注入回调地址；端口在服务启动时才确定，见 `OAuthFlow.setRedirectUri`。 */
  setRedirectUri(redirectUri: string): void {
    this.flow.setRedirectUri(redirectUri);
  }

  /**
   * 概览与明细。
   *
   * 以**配置为准**生成行：配置里新增的供应商还没有快照，就落成「未知」；配置里删掉的
   * 供应商即使库里还有快照也不再展示。排序按余额升序，未知排最后。
   */
  getAccounts(): AccountsPayload {
    const stored = new Map(
      this.database.getAccountBalances().map((row) => [
        row.vendor,
        row,
      ]),
    );
    const rows: AccountRow[] = this.config.vendors.map((vendor) => ({
      ...(stored.get(vendor.name) ?? emptyBalance(vendor.name)),
      models: vendor.models,
    }));
    rows.sort((a, b) => balanceOrder(a.balance) - balanceOrder(b.balance));
    return {
      generatedAt: Date.now(),
      overview: summarize(rows),
      rows,
    };
  }

  /** 同步全部供应商余额；单个供应商失败不影响其他行。 */
  async syncAll(): Promise<AccountsPayload> {
    const rows = await resolveBalances(this.config.vendors, {
      previousOf: (vendor) => this.database.getAccountBalance(vendor),
      readToken: (vendor) => this.tokenStore.read(vendor),
    });
    for (const row of rows) {
      this.database.upsertAccountBalance(row);
      if (row.error) {
        // 只记供应商名与错误类别：错误文本本身来自取数层，已不含凭据
        this.logger.info(`余额取数未成功：${row.vendor}（${row.error}）`);
      }
    }
    return this.getAccounts();
  }

  /** 发起授权，返回应交给用户的授权地址。 */
  authorize(vendorName: string): {
    url: string;
  } {
    const vendor = this.findVendor(vendorName);
    if (!vendor.oauth) {
      throw new Error(`${vendorName} 未配置 OAuth 授权`);
    }
    return {
      url: this.flow.begin(vendor).url,
    };
  }

  /**
   * 处理授权回调：校验 state → 换令牌 → 落盘。
   *
   * state 与本次发起的授权一一对应且一次性，命中即作废；未命中一律拒绝，不换令牌。
   */
  async completeAuthorization(state: string, code: string): Promise<string> {
    const vendorName = this.flow.consume(state);
    if (vendorName === null) {
      throw new Error("授权 state 校验失败");
    }
    const vendor = this.findVendor(vendorName);
    const token = await this.flow.exchange(vendor, code);
    this.tokenStore.write(vendorName, token);
    this.logger.info(`已完成 ${vendorName} 的 OAuth 授权`);
    return vendorName;
  }

  /** 手动填写余额：写回配置文件，并更新内存配置与快照。 */
  writeManual(vendorName: string, input: ManualBalanceInput): AccountsPayload {
    const vendor = this.findVendor(vendorName);
    writeManualBalance(vendorName, input);
    const topup = input.topup ?? vendor.balance?.topup ?? null;
    vendor.balance = {
      ...vendor.balance,
      manual: input.balance,
      topup: input.topup ?? vendor.balance?.topup,
    };
    this.database.upsertAccountBalance({
      balance: input.balance,
      currency: "CNY",
      error: null,
      source: "manual",
      stale: false,
      syncedAt: Date.now(),
      topup,
      vendor: vendorName,
    });
    return this.getAccounts();
  }

  private findVendor(vendorName: string): VendorConfig {
    const vendor = this.config.vendors.find((item) => item.name === vendorName);
    if (!vendor) {
      throw new Error(`未配置供应商 ${vendorName}`);
    }
    return vendor;
  }
}

/** 未知余额排到最后：升序列表里「不知道」不该排在最前当最小值。 */
function balanceOrder(balance: number | null): number {
  return balance === null ? Number.POSITIVE_INFINITY : balance;
}

function emptyBalance(vendor: string): AccountBalance {
  return {
    balance: null,
    currency: "CNY",
    error: null,
    source: null,
    stale: false,
    syncedAt: null,
    topup: null,
    vendor,
  };
}

function summarize(rows: AccountRow[]): AccountOverview {
  let balanceTotal = 0;
  let topupTotal = 0;
  let knownCount = 0;
  let topupKnown = 0;
  let manualCount = 0;
  let staleCount = 0;
  for (const row of rows) {
    if (row.balance !== null) {
      balanceTotal += row.balance;
      knownCount += 1;
    }
    if (row.topup !== null) {
      topupTotal += row.topup;
      topupKnown += 1;
    }
    if (row.source === "manual") {
      manualCount += 1;
    }
    if (row.stale) {
      staleCount += 1;
    }
  }
  return {
    // 一个数字都没有时给 null 而不是 0：界面要显示「未知」，不能显示 ¥0.00
    balanceTotal: knownCount === 0 ? null : balanceTotal,
    knownCount,
    manualCount,
    staleCount,
    topupTotal: topupKnown === 0 ? null : topupTotal,
    unknownCount: rows.length - knownCount,
    vendorCount: rows.length,
  };
}
