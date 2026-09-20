/**
 * 概览与归因片段。
 *
 * 两块都是主面板首屏数据：概览给四个总数，归因按维度摊开明细。渲染只用原生 DOM，
 * 数字格式复用 render 片段的 `money()` / `text()`，文案经 `t()` 取词。
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
          [t("overview.tokens"), String(data.totalTokens || 0)],
          [t("overview.requests"), String(data.requestCount || 0)],
          [t("overview.projects"), String(data.projectCount || 0)]
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

      function markDimensionButtons(current) {
        var buttons = document.querySelectorAll("[data-dimension]");
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.setAttribute("aria-pressed", String(btn.getAttribute("data-dimension") === current));
        });
      }

      /**
       * 归因行的标识文案。
       *
       * 空键来自存量记录（宿主没有 cwd / sessionId），显示「未知」而不是丢弃；
       * 会话维度只显示标识的短前缀，完整 sessionId 读起来没有意义。
       */
      function attributionLabel(key, dimension) {
        if (!key) { return t("common.unknown"); }
        if (dimension === "session") { return key.slice(0, 8); }
        return key;
      }

      /** 归因明细表：维度 / 花费 / Token / 请求数 / 占比；行序由接口按花费倒序给出。 */
      function renderAttribution(rows, dimension, totalCost) {
        var host = el("kuma-attribution");
        if (!host) { return; }
        host.textContent = "";
        if (!rows || rows.length === 0) {
          // 无记录时不留一张空表：给一条通往零数据引导页的路
          var empty = text("div", "kuma-empty", t("common.noData"));
          var guide = text("a", "kuma-link", t("link.guide"));
          guide.setAttribute("data-kuma-nav", "/empty");
          guide.setAttribute("href", "/empty");
          empty.appendChild(guide);
          host.appendChild(empty);
          wireNav();
          return;
        }
        var box = document.createElement("div");
        box.className = "kuma-scroll";
        var table = document.createElement("table");
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        [
          t("attribution.dimension"),
          t("attribution.cost"),
          t("attribution.tokens"),
          t("stats.requests"),
          t("attribution.share")
        ].forEach(function (name) {
          headRow.appendChild(text("th", "", name));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        rows.forEach(function (row) {
          // 占比在 UI 侧算：接口只返回分组结果，不为了展示再做一次全表聚合
          var share = totalCost > 0 ? (row.costTotal / totalCost) * 100 : 0;
          var tr = document.createElement("tr");
          tr.appendChild(text("td", "", attributionLabel(row.key, dimension)));
          tr.appendChild(text("td", "kuma-total", money(row.costTotal)));
          tr.appendChild(text("td", "", String(row.tokens)));
          tr.appendChild(text("td", "", String(row.requestCount)));
          tr.appendChild(text("td", "", share.toFixed(1) + "%"));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        box.appendChild(table);
        host.appendChild(box);
      }
  `;
}
