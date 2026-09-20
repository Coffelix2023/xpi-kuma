import { sharedClientScript } from "../dashboard-client.ts";
import { type PageOptions, pageShell } from "../shell.ts";

/**
 * 配置体检页外壳。
 *
 * 只读诊断：摊开 `config.yaml` 的真实解析结果、逐供应商检查项与全局存储项。
 * 本页**不产生任何写盘操作**；页面是静态外壳，不含任何数据与凭据。
 */
export function generateSettingsHTML(options: PageOptions = {}): string {
  return pageShell({
    body: `  <header>
    <div>
      <h1>配置体检</h1>
      <div class="kuma-generated">只读检查：不改动任何文件，只把解析结果摊开</div>
    </div>
    <div class="kuma-actions">
      <a class="kuma-link" data-kuma-nav="/" href="/">返回主面板</a>
    </div>
  </header>

  <section aria-labelledby="kuma-diagnostics-title">
    <h2 id="kuma-diagnostics-title">配置与存储</h2>
    <div id="kuma-diagnostics"></div>
  </section>
`,
    nonce: options.nonce,
    script: sharedClientScript(),
    title: "xpi-kuma · 配置体检",
  });
}
