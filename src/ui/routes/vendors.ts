import type { IncomingMessage, ServerResponse } from "node:http";
import {
  deleteVendor,
  upsertVendor,
  type VendorWriteInput,
} from "../../config-writer.ts";
import type { ApiContext, ApiRoute } from "./context.ts";
import { respond } from "./http.ts";

/** 供应商写接口请求体上限：表单字段几十条足够，16KB 拦住异常大请求。 */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * 供应商配置写接口。
 *
 * 沿用 `dashboard-ui` 既有鉴权模型：Bearer 凭据由 `dashboard.ts` 统一校验，
 * 这里补写操作要求的 `Origin` 校验；请求体 16KB 上限；非法输入回 400 且零写盘。
 * 写盘成功后调用 `ctx.reloadConfig()` 同进程热重载，接口立刻反映新配置。
 */
export const VENDOR_ROUTES: readonly ApiRoute[] = [
  {
    handle: handleVendorSave,
    match: (method, url) => method === "POST" && url.pathname === "/api/vendors/save",
  },
  {
    handle: handleVendorDelete,
    match: (method, url) => method === "POST" && url.pathname === "/api/vendors/delete",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取 JSON 请求体；超限、解析失败或不是对象一律 null，由调用方回 400。 */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") {
        resolve(null);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        resolve(isRecord(parsed) ? parsed : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/** 把失败原因压成一行：YAML 提示可能带多行。 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

function respondJson(res: ServerResponse, payload: unknown): void {
  respond(res, 200, "application/json; charset=utf-8", JSON.stringify(payload), null);
}

function respondForbidden(res: ServerResponse): void {
  respond(res, 403, "text/plain; charset=utf-8", "拒绝访问", null);
}

function respondBadRequest(res: ServerResponse, message: string): void {
  respond(res, 400, "text/plain; charset=utf-8", message, null);
}

/** 表单字符串字段：缺省/类型不符回落空串，交给下游白名单校验 fail-closed。 */
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readModels(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseWriteInput(body: Record<string, unknown>): VendorWriteInput | null {
  const name = readString(body.name);
  const endpoint = readString(body.endpoint);
  const models = readModels(body.models);
  const probeInterval = readString(body.probeInterval) || "5m";
  const probeTimeout =
    typeof body.probeTimeout === "number" && Number.isFinite(body.probeTimeout)
      ? body.probeTimeout
      : 30_000;
  const probeEnabled = body.probeEnabled !== false;
  if (name === "" || endpoint === "" || models.length === 0) {
    return null;
  }
  return {
    apiKey: readString(body.apiKey),
    endpoint,
    models,
    name,
    probeEnabled,
    probeInterval,
    probeTimeout,
  };
}

/** POST /api/vendors/save：新增或更新一个供应商，写盘后热重载。 */
function handleVendorSave(
  _url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  if (!ctx.originMatches(req)) {
    respondForbidden(res);
    return;
  }
  void readJsonBody(req).then((body) => {
    if (!body) {
      respondBadRequest(res, "请求体必须是 16KB 以内的 JSON 对象");
      return;
    }
    const input = parseWriteInput(body);
    if (!input) {
      respondBadRequest(res, "缺少 name / endpoint / models");
      return;
    }
    try {
      const result = upsertVendor(input);
      ctx.reloadConfig();
      respondJson(res, {
        backupPath: result.backupPath,
        ok: true,
      });
    } catch (error) {
      ctx.logger.error("保存供应商配置失败", error);
      respondBadRequest(res, describeError(error));
    }
  });
}

/** POST /api/vendors/delete：按 name 删除供应商，写盘后热重载。 */
function handleVendorDelete(
  _url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): void {
  if (!ctx.originMatches(req)) {
    respondForbidden(res);
    return;
  }
  void readJsonBody(req).then((body) => {
    const name = body ? readString(body.name) : "";
    if (name === "") {
      respondBadRequest(res, "缺少 name");
      return;
    }
    try {
      const result = deleteVendor(name);
      ctx.reloadConfig();
      respondJson(res, {
        backupPath: result.backupPath,
        ok: true,
      });
    } catch (error) {
      ctx.logger.error("删除供应商配置失败", error);
      respondBadRequest(res, describeError(error));
    }
  });
}
