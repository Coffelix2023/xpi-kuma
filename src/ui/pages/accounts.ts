import { i18nAttr, zh } from "../client/messages.ts";
import { accountsClientScript } from "../dashboard-client.ts";
import { fontControlsHtml, type PageOptions, pageShell } from "../shell.ts";

/**
 * 供应商账户页外壳。
 *
 * 承载余额与充值视图。余额按三档降级取数（接口 → 授权 → 手动），数据由页内脚本
 * 另行请求；本页是静态外壳，不含任何数据与凭据。可见文案都带 `data-i18n` 键。
 */
export function generateAccountsHTML(options: PageOptions = {}): string {
  return pageShell({
    body: `  <header data-semantic-id="accounts.header">
    <div>
      <h1${i18nAttr("page.accounts.title")}>${zh("page.accounts.title")}</h1>
      <div class="kuma-generated" id="kuma-updated"${i18nAttr("page.dashboard.loading")}>${zh("page.dashboard.loading")}</div>
    </div>
    <div class="kuma-actions">
      <button type="button" id="kuma-sync" data-semantic-id="accounts.header.sync-all"${i18nAttr("page.accounts.syncAll")}>${zh("page.accounts.syncAll")}</button>
      <a class="kuma-link" data-kuma-nav="/" href="/" data-semantic-id="accounts.header.back"${i18nAttr("link.backToDashboard")}>${zh("link.backToDashboard")}</a>
${fontControlsHtml()}
      <button type="button" id="kuma-lang"></button>
    </div>
  </header>

  <section aria-labelledby="kuma-accounts-title" data-semantic-id="accounts.summary">
    <h2 id="kuma-accounts-title"${i18nAttr("section.accountsOverview")}>${zh("section.accountsOverview")}</h2>
    <div id="kuma-accounts"></div>
    <div id="kuma-accounts-notice" hidden data-semantic-id="accounts.empty"></div>
  </section>

  <section aria-labelledby="kuma-account-rows-title" data-semantic-id="accounts.list">
    <h2 id="kuma-account-rows-title"${i18nAttr("section.accountRows")}>${zh("section.accountRows")}</h2>
    <div id="kuma-account-rows" data-semantic-id="accounts.list.table"></div>
    <p class="kuma-generated" data-semantic-id="accounts.empty.steps"${i18nAttr("accounts.legend")}>${zh("accounts.legend")}</p>
  </section>
`,
    nonce: options.nonce,
    script: accountsClientScript(),
    titleKey: "page.accounts.title",
  });
}
