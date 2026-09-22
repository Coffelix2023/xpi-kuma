import type {
  BeforeProviderRequestEvent,
  ExtensionAPI,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

/**
 * 2.1 事件时间点可得性核对（improve-usage-overview-analytics）
 *
 * 依据：安装副本 pi-coding-agent / pi-agent-core / pi-ai 均为 0.84.4；
 * 类型证据 dist/core/extensions/types.d.ts，运行时证据 dist/agent-loop.js
 * （message_start/update/end 派发点）与 dist/api/*.js（timestamp 赋值点）。
 *
 * | 时间点/状态    | 结论 | 来源 |
 * |----------------|------|------|
 * | 请求开始       | 可得 | ① `before_provider_request` 每个 provider 请求前派发，handler 到达时刻为直接观测；② 回退：assistant 消息 `timestamp`（provider 实现仅在 HTTP 调用前创建对象时赋值一次，见 openai-completions.js:186） |
 * | 首个响应 token | 可得 | agent-loop 对 text/thinking/toolcall 每个 chunk 派发 `message_update`；该消息首个 update 的到达时刻为直接观测（流式路径才有；无流事件则字段留空） |
 * | 完成时间       | 可得 | `message_end` 派发于 finalMessage 就绪的同一时刻，handler 到达时刻为直接观测；⚠️ `message.timestamp` 是创建时刻且运行时不更新，不能当完成时刻 |
 * | 结果状态       | 可靠 | `message_end.message.stopReason`（类型必填；联合含 stop/length/toolUse/error/aborted） |
 * | HTTP status    | 不采用 | `after_provider_response.status` 无 message 关联键，无法归到单次调用 |
 *
 * 结论：四要素可靠可得，全部来自事件链的直接观测或事件字段，
 * 不需要 probe、相邻记录或固定值估算 → 效率字段可启用。
 * 以下类型断言把字段钉在编译期（pnpm typecheck 即验证），运行时用例验证可读性。
 */

type Expect<T extends true> = T;

type AssistantMsg = Extract<
  MessageEndEvent["message"],
  {
    role: "assistant";
  }
>;

/**
 * 编译期断言集合：任一条件不成立时元素不满足 `Expect<true>`，`pnpm typecheck` 即报错。
 * 导出以声明这些断言是有意保留的公共检查，而非死类型。
 */
export type PiEventTimingAssertions = [
  // message_end 的 assistant 消息带 timestamp（创建时刻）
  Expect<
    AssistantMsg extends {
      timestamp: number;
    }
      ? true
      : false
  >,
  // stopReason 必填且含成功/失败/中止三种终态
  Expect<
    "stop" extends AssistantMsg["stopReason"]
      ? "error" extends AssistantMsg["stopReason"]
        ? "aborted" extends AssistantMsg["stopReason"]
          ? true
          : false
        : false
      : false
  >,
  // turn_start 自带 timestamp（备用开始时刻）
  Expect<
    TurnStartEvent extends {
      timestamp: number;
    }
      ? true
      : false
  >,
  // message_update 携带流事件（首字信号）与消息
  Expect<
    MessageUpdateEvent extends {
      assistantMessageEvent: {
        type: string;
      };
      message: MessageEndEvent["message"];
    }
      ? true
      : false
  >,
  // message_start 携带同一条消息（partial 也带 timestamp）
  Expect<
    MessageStartEvent extends {
      message: MessageEndEvent["message"];
    }
      ? true
      : false
  >,
];
// 四个事件都可经 ExtensionAPI.on 订阅（重载在编译期检查）
const subscribeAll = (pi: ExtensionAPI): void => {
  pi.on("before_provider_request", (_event: BeforeProviderRequestEvent) => {});
  pi.on("message_start", (event) => {
    void event.message;
  });
  pi.on("message_update", (event) => {
    void event.assistantMessageEvent;
  });
  pi.on("message_end", (event) => {
    void event.message;
  });
};
void subscribeAll;

describe("Pi 事件时间点可得性（类型核对）", () => {
  it("message_end 的结果状态与时间戳字段按类型构造并可读", () => {
    const event: MessageEndEvent = {
      type: "message_end",
      message: {
        api: "openai-completions",
        content: [],
        model: "gpt-5",
        provider: "openai",
        role: "assistant",
        stopReason: "stop",
        timestamp: 1_727_000_000_000,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 10,
          output: 5,
          totalTokens: 15,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
        },
      },
    };
    expect(event.message.role).toBe("assistant");
    if (event.message.role === "assistant") {
      expect(event.message.stopReason).toBe("stop");
      expect(typeof event.message.timestamp).toBe("number");
    }
  });
});
