import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 极简文件日志。
 *
 * Pi 独占终端，扩展禁用 `console.*` / `process.stderr.write`，
 * 因此诊断信息只落日志文件，绝不写终端。
 */
export class FileLogger {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    try {
      mkdirSync(dirname(path), {
        recursive: true,
      });
    } catch {
      // 目录不可写时退化为静默：日志失败不应影响扩展主流程
    }
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string, error?: unknown): void {
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
    this.write("ERROR", detail === "" ? message : `${message} — ${detail}`);
  }

  private write(level: string, message: string): void {
    try {
      appendFileSync(this.path, `${new Date().toISOString()} [${level}] ${message}\n`);
    } catch {
      // 同上：日志写失败不抛出
    }
  }
}
