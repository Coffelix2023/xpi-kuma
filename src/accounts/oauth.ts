import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { VendorConfig } from "../types.ts";

/** 令牌落盘时的文件权限：只有属主可读写。 */
const TOKEN_FILE_MODE = 0o600;

/** 过期判定的安全余量：刚好卡在过期瞬间的请求按已过期处理。 */
const EXPIRY_SKEW_MS = 30_000;

/** 服务商没给 `expires_in` 时的保守默认有效期（1 小时）。 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** state 熵：128 位，一次性。 */
const STATE_BYTES = 16;

/** 访问令牌的最小留存信息：令牌与过期时间，**不含** client secret。 */
export interface OAuthToken {
  accessToken: string;
  /** 过期时间（毫秒时间戳） */
  expiresAt: number;
}

/** 本地令牌文件位置：`~/.pi/agent/data/xpi-kuma/oauth.json`。 */
export function defaultOAuthTokenPath(): string {
  return join(getAgentDir(), "data", "xpi-kuma", "oauth.json");
}

/**
 * 按供应商名读写访问令牌。
 *
 * 文件权限固定 `0600`；文件名与内容都不进日志、页面与错误响应（见 `vendor-accounts`
 * spec 的「凭据不出现在展示面」）。
 */
export class OAuthTokenStore {
  private readonly path: string;

  constructor(path: string = defaultOAuthTokenPath()) {
    this.path = path;
  }

  /** 读取该供应商的令牌；没有或文件损坏时返回 null。 */
  read(vendor: string): OAuthToken | null {
    return this.readAll()[vendor] ?? null;
  }

  /** 写入该供应商的令牌（覆盖旧值），写临时文件后原子替换。 */
  write(vendor: string, token: OAuthToken): void {
    const all = this.readAll();
    all[vendor] = token;
    mkdirSync(dirname(this.path), {
      recursive: true,
    });
    const tempPath = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tempPath, JSON.stringify(all, null, 2), {
      mode: TOKEN_FILE_MODE,
    });
    renameSync(tempPath, this.path);
    // rename 保留临时文件的权限，但 umask 可能收窄写权限，这里显式补齐 0600
    chmodSync(this.path, TOKEN_FILE_MODE);
  }

  /** 读取整个文件；缺失、不可读或结构不符一律当空表处理。 */
  private readAll(): Record<string, OAuthToken> {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isTokenMap(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

/** 过期判定；`now` 可注入以便测试。 */
export function isTokenExpired(token: OAuthToken, now: number = Date.now()): boolean {
  return token.expiresAt - EXPIRY_SKEW_MS <= now;
}

/**
 * OAuth 授权流程。
 *
 * state 保存在内存里、用后即焚：回调路径是唯一豁免 Bearer 的写路径，state 是它唯一的
 * 身份证明（design.md D12）。授权发起前先校验配置完整性，不完整直接报错、不打开浏览器。
 */
export class OAuthFlow {
  private readonly pending = new Map<string, string>();
  private redirectUri: string;

  constructor(redirectUri: string) {
    this.redirectUri = redirectUri;
  }

  /**
   * 注入回调地址。
   *
   * 端口由操作系统在服务启动时分配，构造 `OAuthFlow` 时还不知道，因此这一步与启动
   * 监听绑定在一起（见 `startDashboardServer`）。
   */
  setRedirectUri(redirectUri: string): void {
    this.redirectUri = redirectUri;
  }

  /** 生成一次性 state 与授权地址；配置不完整直接抛错。 */
  begin(vendor: VendorConfig): {
    state: string;
    url: string;
  } {
    const oauth = vendor.oauth;
    if (!oauth) {
      throw new Error("该供应商未配置 OAuth 授权");
    }
    const state = randomBytes(STATE_BYTES).toString("base64url");
    this.pending.set(state, vendor.name);
    let url: URL;
    try {
      url = new URL(oauth.authorizeUrl);
    } catch {
      throw new Error("authorize_url 不是合法的地址");
    }
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", oauth.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", oauth.scopes.join(" "));
    url.searchParams.set("state", state);
    return {
      state,
      url: url.toString(),
    };
  }

  /** 校验回调 state：命中返回供应商名并立即作废，未命中返回 null。 */
  consume(state: string): string | null {
    const vendor = this.pending.get(state);
    if (vendor === undefined) {
      return null;
    }
    this.pending.delete(state);
    return vendor;
  }

  /** 用授权码换访问令牌。 */
  async exchange(
    vendor: VendorConfig,
    code: string,
    options: {
      fetchImpl?: typeof fetch;
      now?: number;
    } = {},
  ): Promise<OAuthToken> {
    const oauth = vendor.oauth;
    if (!oauth) {
      throw new Error("该供应商未配置 OAuth 授权");
    }
    const fetcher = options.fetchImpl ?? fetch;
    const body = new URLSearchParams({
      client_id: oauth.clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });
    const response = await fetcher(oauth.tokenUrl, {
      body: body.toString(),
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    const accessToken = readStringField(payload, "access_token");
    if (accessToken === undefined) {
      throw new Error("响应里没有 access_token");
    }
    const expiresIn = readNumberField(payload, "expires_in");
    const now = options.now ?? Date.now();
    return {
      accessToken,
      expiresAt:
        expiresIn === undefined ? now + DEFAULT_TTL_MS : now + expiresIn * 1000,
    };
  }
}

/** 读取响应体里的非空字符串字段。 */
function readStringField(payload: unknown, key: string): string | undefined {
  const value = readMember(payload, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 读取响应体里的有限数字字段。 */
function readNumberField(payload: unknown, key: string): number | undefined {
  const value = readMember(payload, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 从响应体里取一个成员；非对象或不可序列化的值一律按「取不到」处理。 */
function readMember(payload: unknown, key: string): string | number | boolean | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return null;
}

function isTokenMap(value: unknown): value is Record<string, OAuthToken> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (token) =>
      typeof token === "object" &&
      token !== null &&
      typeof (token as OAuthToken).accessToken === "string" &&
      typeof (token as OAuthToken).expiresAt === "number",
  );
}
