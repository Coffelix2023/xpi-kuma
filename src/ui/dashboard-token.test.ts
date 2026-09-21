import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dashboardTokenPath, loadDashboardToken } from "./dashboard-token.ts";

const cleanups: (() => void)[] = [];

/** 合法凭据的形状；与实现里的 `TOKEN_PATTERN` 一致。 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** 切到新的临时 agent 目录：凭据文件从全局目录读写，隔离靠它。 */
function tempAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xpi-kuma-token-"));
  cleanups.push(() =>
    rmSync(dir, {
      force: true,
      recursive: true,
    }),
  );
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

function writeTokenFile(content: string): void {
  const path = dashboardTokenPath();
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, content);
}

/** 文件权限位（去掉类型位）。 */
function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("持久访问凭据", () => {
  it("文件不存在时生成 43 字符凭据并落盘，权限 0600", () => {
    tempAgentDir();
    const path = dashboardTokenPath();

    const token = loadDashboardToken();

    expect(token).toMatch(TOKEN_SHAPE);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      token,
    });
    expect(modeOf(path)).toBe(0o600);
  });

  it("文件存在时复用同一凭据", () => {
    tempAgentDir();

    const first = loadDashboardToken();
    const second = loadDashboardToken();

    expect(second).toBe(first);
  });

  it("内容非法时重新生成，不沿用坏值", () => {
    for (const broken of [
      "not json",
      "{}",
      '{"token": "short"}',
      '{"token": 42}',
      "[]",
    ]) {
      tempAgentDir();
      writeTokenFile(broken);

      const token = loadDashboardToken();

      expect(token, broken).toMatch(TOKEN_SHAPE);
      expect(token, broken).not.toBe("short");
      expect(modeOf(dashboardTokenPath()), broken).toBe(0o600);
    }
  });

  it("已有文件权限过宽时收敛到 0600", () => {
    tempAgentDir();
    const path = dashboardTokenPath();
    writeTokenFile(
      JSON.stringify({
        token: "a".repeat(43),
      }),
    );
    writeFileSync(
      path,
      JSON.stringify({
        token: "a".repeat(43),
      }),
      {
        mode: 0o644,
      },
    );

    loadDashboardToken();

    expect(modeOf(path)).toBe(0o600);
  });

  it("删除文件即轮换", () => {
    tempAgentDir();
    const first = loadDashboardToken();
    rmSync(dashboardTokenPath());

    expect(loadDashboardToken()).not.toBe(first);
  });
});
