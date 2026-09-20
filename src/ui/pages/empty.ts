import { i18nAttr, zh } from "../client/messages.ts";
import { emptyClientScript } from "../dashboard-client.ts";
import { type PageOptions, pageShell } from "../shell.ts";

/**
 * 零数据引导态。
 *
 * 首次运行、没有使用量记录或未配置供应商时替代主面板：把「怎么产生第一份数据」
 * 说清楚，并留一条回主面板的路。页面是静态外壳，不含任何数据与凭据；
 * 两个分支容器由页内脚本按当前配置与记录数显隐。
 */
export function generateEmptyHTML(options: PageOptions = {}): string {
  return pageShell({
    body: `  <header>
    <div>
      <h1${i18nAttr("page.empty.title")}>${zh("page.empty.title")}</h1>
      <div class="kuma-generated" id="kuma-updated"${i18nAttr("page.empty.subtitle")}>${zh("page.empty.subtitle")}</div>
    </div>
    <div class="kuma-actions">
      <a class="kuma-link" data-kuma-nav="/" href="/"${i18nAttr("link.backToDashboard")}>${zh("link.backToDashboard")}</a>
      <button type="button" id="kuma-lang"></button>
    </div>
  </header>

  <section id="section-guide-vendors" aria-labelledby="kuma-guide-vendors-title" hidden>
    <h2 id="kuma-guide-vendors-title"${i18nAttr("section.guideVendors")}>${zh("section.guideVendors")}</h2>
    <p${i18nAttr("guide.vendorsIntro")}>${zh("guide.vendorsIntro")}</p>
    <ul class="kuma-steps">
      <li${i18nAttr("guide.vendorsStep1")}>${zh("guide.vendorsStep1")}</li>
      <li${i18nAttr("guide.vendorsStep2")}>${zh("guide.vendorsStep2")}</li>
      <li${i18nAttr("guide.vendorsStep3")}>${zh("guide.vendorsStep3")}</li>
    </ul>
  </section>

  <section id="section-guide-data" aria-labelledby="kuma-guide-data-title">
    <h2 id="kuma-guide-data-title"${i18nAttr("section.guideData")}>${zh("section.guideData")}</h2>
    <ul class="kuma-steps">
      <li${i18nAttr("guide.dataPath1")}>${zh("guide.dataPath1")}</li>
      <li${i18nAttr("guide.dataPath2")}>${zh("guide.dataPath2")}</li>
      <li${i18nAttr("guide.dataPath3")}>${zh("guide.dataPath3")}</li>
    </ul>
    <p class="kuma-generated" id="kuma-guide-status"></p>
  </section>
`,
    nonce: options.nonce,
    script: emptyClientScript(),
    title: zh("page.empty.title"),
  });
}
