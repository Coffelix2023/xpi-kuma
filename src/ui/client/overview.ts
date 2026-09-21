/**
 * 概览片段。
 *
 * 主面板首屏的四个总数。渲染只用原生 DOM，数字格式复用 render 片段的
 * `money()` / `count()`，文案经 `t()` 取词。
 */
export function overviewFragment(): string {
  return `
      /** 提示条：无文案时收起；有文案时给出通往零数据引导页的入口。 */
      function setNotice(notice, message) {
        if (!notice) { return; }
        notice.textContent = "";
        if (!message) { notice.hidden = true; return; }
        notice.className = "kuma-empty";
        notice.appendChild(text("span", "", message));
        var link = text("a", "kuma-link", t("link.guide"));
        link.setAttribute("data-kuma-nav", "/empty");
        link.setAttribute("href", "/empty");
        notice.appendChild(link);
        notice.hidden = false;
        wireNav();
      }

      /** 花费概览：本期花费 / token 总量 / 请求次数 / 覆盖项目数。 */
      function renderOverview(overview, currentPeriod) {
        var host = el("kuma-overview");
        if (!host) { return; }
        var data = overview || {};
        host.textContent = "";
        var box = document.createElement("dl");
        box.className = "kuma-overview";
        [
          [t("overview.cost"), money(data.costTotal)],
          [t("overview.tokens"), count(data.totalTokens || 0)],
          [t("overview.requests"), count(data.requestCount || 0)],
          [t("overview.projects"), count(data.projectCount || 0)]
        ].forEach(function (pair) {
          var card = document.createElement("div");
          card.className = "kuma-metric";
          card.appendChild(text("dt", "", pair[0]));
          card.appendChild(text("dd", "", pair[1]));
          box.appendChild(card);
        });
        host.appendChild(box);
        setNotice(
          el("kuma-overview-notice"),
          data.requestCount
            ? ""
            : t("overview.emptyPrefix") +
              t("common.periodOpen") +
              currentPeriod +
              t("common.periodClose") +
              t("common.sentenceEnd")
        );
      }

  `;
}
