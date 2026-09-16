import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { open } from "glimpseui";
import type { UsageCollector } from "../collectors/usage-collector.ts";
import { FileLogger } from "../lib/log.ts";
import type { VendorMonitor } from "../monitors/vendor-monitor.ts";
import type { StatsPeriod } from "../types.ts";
import { type DashboardData, generateDashboardHTML } from "./dashboard-html.ts";
import { installHostStderrGuard } from "./glimpse-host.ts";

/** 面板窗口尺寸，见 dashboard-ui spec。 */
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const WINDOW_TITLE = "xpi-kuma 监控面板";

const VALID_PERIODS: StatsPeriod[] = [
  "1h",
  "24h",
  "7d",
  "30d",
];

/** 页内脚本暴露的桥接方法前缀。 */
const BRIDGE = "__kuma";

/** 页面向 Node 侧发来的消息。 */
interface ClientMessage {
  period?: string;
  type?: string;
  vendor?: string;
}

let logger: FileLogger | null = null;

function getLogger(): FileLogger {
  logger ??= new FileLogger(`${getAgentDir()}/data/xpi-kuma/xpi-kuma.log`);
  return logger;
}

function isPeriod(value: unknown): value is StatsPeriod {
  return typeof value === "string" && (VALID_PERIODS as string[]).includes(value);
}

/** 汇总面板当前需要的全部数据。 */
function collectData(
  usageCollector: UsageCollector,
  vendorMonitor: VendorMonitor,
  period: StatsPeriod,
): DashboardData {
  return {
    generatedAt: Date.now(),
    period,
    stats: usageCollector.getStats(period),
    trend: usageCollector.getTrend(period),
    vendors: vendorMonitor.getVendorStatus(),
  };
}

export interface OpenDashboardOptions {
  /** 是否加载 Chart.js CDN，默认加载 */
  chartCdn?: string | null;
  /** 初始时间范围，默认 24h */
  period?: StatsPeriod;
}

/**
 * 打开监控面板。
 *
 * 页面通过 `window.glimpse.send()` 请求刷新或切换时间范围；
 * Node 侧用 `win.send("__kuma.render(...)")` 回灌新数据。
 *
 * @returns 窗口关闭时 resolve；无供应商时仍会打开面板并显示提示。
 */
export async function openDashboard(
  usageCollector: UsageCollector,
  vendorMonitor: VendorMonitor,
  options: OpenDashboardOptions = {},
): Promise<void> {
  let period: StatsPeriod = options.period ?? "24h";
  const guard = installHostStderrGuard(join(getAgentDir(), "data", "xpi-kuma"));

  try {
    const html = generateDashboardHTML(
      collectData(usageCollector, vendorMonitor, period),
      {
        chartCdn: options.chartCdn,
      },
    );

    const win = open(html, {
      height: WINDOW_HEIGHT,
      title: WINDOW_TITLE,
      width: WINDOW_WIDTH,
    });

    await new Promise<void>((resolve) => {
      win.on("message", (raw) => {
        void handleMessage(raw as ClientMessage);
      });
      win.on("error", (error: Error) => {
        getLogger().error("Glimpse 窗口错误", error);
      });
      win.on("closed", () => {
        resolve();
      });
    });

    async function handleMessage(message: ClientMessage): Promise<void> {
      try {
        if (message.type === "range" && isPeriod(message.period)) {
          period = message.period;
          push(collectData(usageCollector, vendorMonitor, period));
          return;
        }
        if (message.type === "refresh") {
          if (message.vendor) {
            await vendorMonitor.triggerProbe(message.vendor);
          } else {
            await vendorMonitor.triggerAllProbes();
          }
          push(collectData(usageCollector, vendorMonitor, period));
          return;
        }
      } catch (error) {
        getLogger().error("面板请求处理失败", error);
        win.send(`${BRIDGE}.error(${JSON.stringify(String(error))})`);
      }
    }

    function push(data: DashboardData): void {
      win.send(`${BRIDGE}.render(${JSON.stringify(data)})`);
      win.send(`${BRIDGE}.clearBusy()`);
    }
  } finally {
    guard.restore();
  }
}
