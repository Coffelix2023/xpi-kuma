import { i18nAttr, zh } from "../client/messages.ts";
import { settingsClientScript } from "../dashboard-client.ts";
import { fontControlsHtml, type PageOptions, pageShell } from "../shell.ts";

/**
 * 配置体检页外壳。
 *
 * 信息层级：摘要条 → 配置明细卡 → 每供应商一张体检卡 → 全局与存储卡；
 * 解析失败时只留一张错误卡（fail-closed），不展示半截数据。
 *
 * 本页**只读取与校验，不写盘**；修改供应商请到主面板「供应商」标签页。
 * 页面是静态外壳，不含任何数据与凭据。
 */
export function generateSettingsHTML(options: PageOptions = {}): string {
  return pageShell({
    body: `  <header>
    <div>
      <h1${i18nAttr("page.settings.title")}>${zh("page.settings.title")}</h1>
      <div class="kuma-generated" id="kuma-updated"${i18nAttr("page.dashboard.loading")}>${zh("page.dashboard.loading")}</div>
    </div>
    <div class="kuma-actions">
      <button type="button" id="kuma-reload"${i18nAttr("settings.reload")}>${zh("settings.reload")}</button>
      <a class="kuma-link" data-kuma-nav="/" href="/"${i18nAttr("link.backToDashboard")}>${zh("link.backToDashboard")}</a>
${fontControlsHtml()}
      <button type="button" id="kuma-lang"></button>
    </div>
  </header>

  <p class="kuma-readonly"${i18nAttr("settings.readonly")}>${zh("settings.readonly")}</p>

  <div class="kuma-summary" id="kuma-issues" role="status" aria-live="polite"></div>

  <section id="section-diagnostics-error" aria-labelledby="kuma-diagnostics-error-title" hidden>
    <h2 id="kuma-diagnostics-error-title"${i18nAttr("settings.parseFailedTitle")}>${zh("settings.parseFailedTitle")}</h2>
    <div id="kuma-diagnostics-error"></div>
  </section>

  <section id="section-diagnostics" aria-labelledby="kuma-diagnostics-title">
    <h2 id="kuma-diagnostics-title"${i18nAttr("section.configDetail")}>${zh("section.configDetail")}</h2>
    <div id="kuma-diagnostics"></div>
  </section>

  <section id="section-diagnostics-vendors" aria-labelledby="kuma-diagnostics-vendors-title">
    <h2 id="kuma-diagnostics-vendors-title"${i18nAttr("section.vendorChecks")}>${zh("section.vendorChecks")}</h2>
    <div id="kuma-diagnostics-vendors"></div>
  </section>

  <section id="section-diagnostics-global" aria-labelledby="kuma-diagnostics-global-title">
    <h2 id="kuma-diagnostics-global-title"${i18nAttr("section.globalStorage")}>${zh("section.globalStorage")}</h2>
    <div id="kuma-diagnostics-global"></div>
  </section>
`,
    nonce: options.nonce,
    script: settingsClientScript(),
    titleKey: "page.settings.title",
  });
}
