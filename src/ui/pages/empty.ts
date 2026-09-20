import { sharedClientScript } from "../dashboard-client.ts";
import { type PageOptions, pageShell } from "../shell.ts";

/**
 * 零数据引导态。
 *
 * 首次运行、没有使用量记录或未配置供应商时替代主面板：把「怎么产生第一份数据」
 * 说清楚，并留一条回主面板的路。页面是静态外壳，不含任何数据与凭据。
 */
export function generateEmptyHTML(options: PageOptions = {}): string {
  return pageShell({
    body: `  <header>
    <div>
      <h1>还没有可展示的数据</h1>
    </div>
    <div class="kuma-actions">
      <a class="kuma-link" data-kuma-nav="/" href="/">返回主面板</a>
    </div>
  </header>

  <section aria-labelledby="kuma-guide-title">
    <h2 id="kuma-guide-title">产生数据的三条路径</h2>
    <ul class="kuma-steps">
      <li>在本项目里正常使用 Pi：新的 LLM 调用会经 <code>message_end</code> 自动计入用量。</li>
      <li>在 <code>.pi/xpi-kuma/config.yaml</code> 里配置供应商，面板才能展示探测与账户信息。</li>
      <li>执行 <code>/xpi-kuma</code> 重新打开面板；数据出现后主面板会替换本页。</li>
    </ul>
  </section>
`,
    nonce: options.nonce,
    script: sharedClientScript(),
    title: "xpi-kuma · 还没有数据",
  });
}
