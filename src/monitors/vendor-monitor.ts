import type { Database } from "../storage/database.ts";
import type { KumaConfig, ProbeResult, VendorConfig, VendorStatus } from "../types.ts";

/** 探测请求体：最小 prompt + max_tokens=1，单次成本控制在 5 token 以内。 */
const PROBE_PROMPT = "hi";
const PROBE_MAX_TOKENS = 1;

const INTERVAL_PATTERN = /^(\d+)(ms|s|m|h)$/;
const UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  m: 60_000,
  ms: 1,
  s: 1000,
};
const TRAILING_SLASH = /\/$/;

/** 把 `"5m"` / `"1h"` 解析成毫秒。 */
export function parseInterval(value: string): number {
  const match = INTERVAL_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`无法解析探测间隔 "${value}"，支持 5m / 30s / 1h 等格式`);
  }
  return Number(match[1]) * UNIT_MS[match[2]];
}

/** 只保留诊断所需信息，避免把响应体或密钥写进数据库。 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "timeout" : error.message;
  }
  return String(error);
}
/**
 * 供应商性能探测器：按配置间隔发送最小测试请求，测量 TTFT 与总响应时间。
 *
 * 定时器与在途请求的生命周期由 `start()` / `stop()` 成对管理。
 */
export class VendorMonitor {
  private readonly database: Database;
  private readonly config: KumaConfig;
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly inFlight = new Set<AbortController>();

  constructor(database: Database, config: KumaConfig) {
    this.database = database;
    this.config = config;
  }

  /**
   * 为每个启用探测的供应商启动定时任务。
   *
   * 首次探测在第一个间隔之后触发，面板在此之前显示 `unknown`。
   */
  start(): void {
    for (const vendor of this.config.vendors) {
      if (!vendor.probe.enabled) {
        continue;
      }
      const interval = parseInterval(vendor.probe.interval);
      const timer = setInterval(() => {
        void this.runProbe(vendor);
      }, interval);
      // 定时器不阻止 Pi 退出；stop() 仍是主清理路径
      timer.unref?.();
      this.timers.add(timer);
    }
  }

  /** 清除所有定时器并取消在途探测。 */
  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    for (const controller of this.inFlight) {
      controller.abort();
    }
    this.inFlight.clear();
  }

  /** 当前受管的定时器数量，用于自检与测试。 */
  get activeTimerCount(): number {
    return this.timers.size;
  }

  /** 执行一次探测并落库。 */
  private async runProbe(vendor: VendorConfig): Promise<void> {
    const result = await this.probeVendor(vendor);
    this.database.insertProbeRecord(result);
  }

  /**
   * 对单个供应商执行一次探测。
   *
   * 永远返回结果而不抛错：超时、HTTP 错误、网络错误统一记为 `down`。
   */
  async probeVendor(vendor: VendorConfig): Promise<ProbeResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    this.inFlight.add(controller);
    const timer = setTimeout(() => controller.abort(), vendor.probe.timeout);

    try {
      const response = await fetch(
        `${vendor.endpoint.replace(TRAILING_SLASH, "")}/chat/completions`,
        {
          body: JSON.stringify({
            max_tokens: PROBE_MAX_TOKENS,
            model: vendor.model,
            stream: true,
            messages: [
              {
                content: PROBE_PROMPT,
                role: "user",
              },
            ],
          }),
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(vendor.apiKey
              ? {
                  authorization: `Bearer ${vendor.apiKey}`,
                }
              : {}),
          },
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const { ttft, tokensInput, tokensOutput } = await this.readStream(
        response,
        startedAt,
      );
      return {
        error: null,
        model: vendor.model,
        status: "up",
        timestamp: startedAt,
        tokensInput,
        tokensOutput,
        totalTime: Date.now() - startedAt,
        ttft,
        vendor: vendor.name,
      };
    } catch (error) {
      return {
        error: describeError(error),
        model: vendor.model,
        status: "down",
        timestamp: startedAt,
        tokensInput: 0,
        tokensOutput: 0,
        totalTime: null,
        ttft: null,
        vendor: vendor.name,
      };
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(controller);
    }
  }

  /** 消费 SSE 流，返回首字延迟与（若供应商上报）token 用量。 */
  private async readStream(
    response: Response,
    startedAt: number,
  ): Promise<{
    ttft: number | null;
    tokensInput: number;
    tokensOutput: number;
  }> {
    if (!response.body) {
      throw new Error("响应缺少 body");
    }
    let ttft: number | null = null;
    let tokensInput = 0;
    let tokensOutput = 0;

    for await (const line of readLines(response.body)) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") {
        continue;
      }
      let chunk: unknown;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      // 部分 OpenAI-compatible 供应商把首字放在 reasoning_content（如 DeepSeek），
      // 只认 content 会把正常响应误判成空流。
      const { content, reasoningContent } = readDelta(chunk);
      if (ttft === null && (content || reasoningContent)) {
        ttft = Date.now() - startedAt;
      }
      const usage = (
        chunk as {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
          };
        }
      ).usage;
      if (usage) {
        tokensInput = usage.prompt_tokens ?? tokensInput;
        tokensOutput = usage.completion_tokens ?? tokensOutput;
      }
    }

    if (ttft === null) {
      throw new Error("流结束但未收到任何内容块");
    }
    return {
      tokensInput,
      tokensOutput,
      ttft,
    };
  }

  /**
   * 立即对指定供应商执行一次探测并落库。
   *
   * 供应商未配置或未启用探测时返回 null。
   */
  async triggerProbe(vendorName: string): Promise<ProbeResult | null> {
    const vendor = this.config.vendors.find((v) => v.name === vendorName);
    if (!vendor) {
      return null;
    }
    const result = await this.probeVendor(vendor);
    this.database.insertProbeRecord(result);
    return result;
  }

  /** 立即探测所有供应商，用于面板的「全部刷新」。 */
  async triggerAllProbes(): Promise<ProbeResult[]> {
    const results = await Promise.all(
      this.config.vendors.map(async (vendor) => this.probeVendor(vendor)),
    );
    for (const result of results) {
      this.database.insertProbeRecord(result);
    }
    return results;
  }

  /**
   * 汇总所有已配置供应商的当前状态。
   *
   * 状态取最近一条探测记录；TTFT 与总响应时间取最近一次成功探测的值，
   * 这样单次抖动不会把性能指标清空。
   */
  getVendorStatus(): VendorStatus[] {
    return this.config.vendors.map((vendor) => {
      const [latest] = this.database.getProbeHistory(vendor.name, 1);
      const [latestOk] = this.database.getProbeHistory(vendor.name, 1, "up");
      return {
        lastProbeTime: latest?.timestamp ?? null,
        model: vendor.model,
        name: vendor.name,
        price: vendor.price ?? null,
        status: (latest?.status as VendorStatus["status"]) ?? "unknown",
        totalTime: latestOk?.total_time ?? null,
        ttft: latestOk?.ttft ?? null,
      };
    });
  }
}

/** 从 SSE chunk 中取出首字候选文本；兼容 `content` 与 `reasoning_content`。 */
function readDelta(chunk: unknown): {
  content?: string;
  reasoningContent?: string;
} {
  const delta = (
    chunk as {
      choices?: {
        delta?: {
          content?: string;
          reasoning_content?: string;
        };
      }[];
    }
  ).choices?.[0]?.delta;
  return {
    content: delta?.content ?? undefined,
    reasoningContent: delta?.reasoning_content ?? undefined,
  };
}
/** 把 SSE 字节流按行切分，不依赖 `TextDecoderStream` 的平台可用性。 */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, {
      stream: true,
    });
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      yield buffer.slice(0, index).trimEnd();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() !== "") {
    yield buffer.trimEnd();
  }
}
