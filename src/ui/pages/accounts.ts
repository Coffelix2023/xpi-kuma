import { accountsClientScript } from "../dashboard-client.ts";
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
      <div class="kuma-generated" id="kuma-updated">正在加载…</div>
    </div>
    <div class="kuma-actions">
      <button type="button" id="kuma-sync">同步全部余额</button>
      <a class="kuma-link" data-kuma-nav="/" href="/">返回主面板</a>
    </div>
  </header>

  <section aria-labelledby="kuma-accounts-title">
    <h2 id="kuma-accounts-title">账户概览</h2>
    <div id="kuma-accounts"></div>
    <div id="kuma-accounts-notice" hidden></div>
  </section>

  <section aria-labelledby="kuma-account-rows-title">
    <h2 id="kuma-account-rows-title">账户明细</h2>
    <div id="kuma-account-rows"></div>
    <p class="kuma-generated">来源图例：接口查询 / OAuth 授权 / 手动填写；「未知」表示取不到值，不是 0。</p>
  </section>
`,
    nonce: options.nonce,
    script: accountsClientScript(),
    title: "xpi-kuma · 供应商账户",
  });
}
