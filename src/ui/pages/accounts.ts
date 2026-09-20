import { sharedClientScript } from "../dashboard-client.ts";
import { type PageOptions, pageShell } from "../shell.ts";

/**
 * 供应商账户页外壳。
 *
 * 承载余额与充值视图。余额按三档降级取数（接口 → 授权 → 手动），数据由页内脚本
 * 另行请求；本页是静态外壳，不含任何数据与凭据。
 */
export function generateAccountsHTML(options: PageOptions = {}): string {
  return pageShell({
    body: `  <header>
    <div>
      <h1>供应商账户</h1>
      <div class="kuma-generated">余额单位与供应商计费币种一致</div>
    </div>
    <div class="kuma-actions">
      <a class="kuma-link" data-kuma-nav="/" href="/">返回主面板</a>
    </div>
  </header>

  <section aria-labelledby="kuma-accounts-title">
    <h2 id="kuma-accounts-title">账户概览</h2>
    <div id="kuma-accounts"></div>
    <div id="kuma-accounts-notice" hidden></div>
  </section>
`,
    nonce: options.nonce,
    script: sharedClientScript(),
    title: "xpi-kuma · 供应商账户",
  });
}
