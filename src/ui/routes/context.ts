import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountService } from "../../accounts/service.ts";
import type { UsageCollector } from "../../collectors/usage-collector.ts";
import type { FileLogger } from "../../lib/log.ts";
import type { VendorMonitor } from "../../monitors/vendor-monitor.ts";

/**
 * API 处理函数在运行时拿到的依赖集合。
 *
 * 独立成模块是为了让各张路由表（`api.ts` / `accounts.ts`）共用同一份上下文定义，
 * 而不必互相 import 造成循环依赖。
 */
export interface ApiContext {
  /** 账户服务；未启用时为 null，账户接口据此回 503 */
  accounts: AccountService | null;
  logger: FileLogger;
  /** 校验请求 Origin 与当前服务一致；由服务端按监听地址构造。 */
  originMatches: (req: IncomingMessage) => boolean;
  usageCollector: UsageCollector;
  vendorMonitor: VendorMonitor;
}

/** 一条 API 路由：命中判断与处理函数。 */
export interface ApiRoute {
  /** 处理命中请求；只负责自身业务，不写 404。 */
  handle: (
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
    ctx: ApiContext,
  ) => void;
  /** 判断该方法与路径是否命中本路由。 */
  match: (method: string, url: URL) => boolean;
}
