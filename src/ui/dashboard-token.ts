import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** 访问凭据熵：256 位随机数，base64url 编码后 43 个字符。 */
const TOKEN_BYTES = 32;

/** 合法凭据的形状；不符即视为文件被改坏，重新生成。 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 凭据文件位置：`~/.pi/agent/data/xpi-kuma/dashboard.json`。 */
export function dashboardTokenPath(): string {
  return join(getAgentDir(), "data", "xpi-kuma", "dashboard.json");
}

/**
 * 读取持久访问凭据；文件缺失或内容非法就生成新的并落盘。
 *
 * 固定端口 + 常驻面板要求书签里的凭据长期有效，所以凭据落在全局 `0600` 文件里，
 * 而不是每次启动重新随机。删除该文件即可轮换（下次启动生成新凭据）。
 */
export function loadDashboardToken(): string {
  const path = dashboardTokenPath();
  const existing = readToken(path);
  if (existing !== null) {
    // 复制、备份还原都可能把权限放宽，每次启动收敛一次
    chmodSync(path, 0o600);
    return existing;
  }
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        token,
      },
      null,
      2,
    )}\n`,
    {
      mode: 0o600,
    },
  );
  // 文件已存在时 writeFileSync 不会改权限，显式收敛到 0600
  chmodSync(path, 0o600);
  return token;
}

/** 读文件里的凭据；缺失、非法 JSON 或形状不符一律返回 null。 */
function readToken(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const token = (
      parsed as {
        token?: unknown;
      }
    ).token;
    return typeof token === "string" && TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}
