/**
 * 渲染片段：状态样式、格式化与供应商卡片、统计表、提示的 DOM 渲染。
 *
 * 所有面向用户的固定文案都经 `t()` 取词（见 `client/i18n.ts`），因此切换语言后
 * 重新渲染即得到对应语言；数字与路径一律不进字典。
 */
export function renderFragment(): string {
  return `
      function cssVar(style, name) {
        var value = style.getPropertyValue(name);
        return value && value.trim() ? value.trim() : "#808080";
      }

      function statusClass(status) {
        if (status === "up") { return "kuma-up"; }
        if (status === "down") { return "kuma-down"; }
        if (status === "degraded") { return "kuma-degraded"; }
        return "kuma-unknown";
      }

      function statusIcon(status) {
        if (status === "up") { return "🟢"; }
        if (status === "down" || status === "degraded") { return "🔴"; }
        return "⚪";
      }

      /**
       * 千分位分组：固定小数位，locale 跟随界面语言（zh-CN 与 en-US 都用逗号分组）。
       *
       * 非数值输入返回破折号，让表格能降级显示而不是把 NaN 摆到用户面前。
       */
      function group(n, digits) {
        if (typeof n !== "number" || !isFinite(n)) { return "—"; }
        return n.toLocaleString(dateLocale(), {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        });
      }

      /**
       * 数量显示：不足百万用整数千分位，百万级用 M、亿级用亿（两位小数，去掉尾随 0）。
       *
       * 先判亿再判 M：1,234,567 读作 1.23M 比读七位数字快，但 1,234 仍要精确成 1,234。
       */
      function count(n) {
        if (typeof n !== "number" || !isFinite(n)) { return "—"; }
        var abs = Math.abs(n);
        if (abs >= 1e8) { return trimZeros((n / 1e8).toFixed(2)) + "亿"; }
        if (abs >= 1e6) { return trimZeros((n / 1e6).toFixed(2)) + "M"; }
        return group(Math.round(n), 0);
      }

      /** 去掉定点小数的尾随 0：1.20 → 1.2、2.00 → 2。 */
      function trimZeros(text) {
        // 片段是模板字符串：正则里的反斜杠要写两次，才原样进入页内脚本
        return text.indexOf(".") === -1 ? text : text.replace(/0+$/, "").replace(/\\.$/, "");
      }

      function money(n) {
        if (typeof n !== "number" || !isFinite(n)) { return "¥-"; }
        return "¥" + group(n, 2);
      }

      /**
       * 占比：分母为 0 时给 0.0% 而不是破折号 —— 0 是已知值，破折号留给未知。
       */
      function share(value, total) {
        if (!total) { return "0.0%"; }
        return ((value / total) * 100).toFixed(1) + "%";
      }

      function ms(n) {
        if (typeof n !== "number" || !isFinite(n)) { return "—"; }
        return group(Math.round(n), 0) + " ms";
      }

      function price(p) {
        if (!p) { return t("chart.missingPrice"); }
        return "¥" + p.input + " / ¥" + p.output;
      }

      function text(tag, className, content) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        node.textContent = content;
        return node;
      }

      function renderVendors(vendors) {
        var host = el("kuma-vendors");
        if (!host) { return; }
        host.textContent = "";
        var grid = document.createElement("div");
        grid.className = "kuma-grid";

        vendors.forEach(function (v) {
          var card = document.createElement("article");
          card.className = "kuma-card";

          var head = document.createElement("div");
          head.className = "kuma-card-head";
          head.appendChild(text("span", "", statusIcon(v.status)));
          head.appendChild(text("span", "kuma-card-name", v.name));
          head.appendChild(text("span", "kuma-card-model", v.model));
          card.appendChild(head);

          card.appendChild(text("span", "kuma-badge " + statusClass(v.status), v.status));

          var dl = document.createElement("dl");
          dl.className = "kuma-kv";
          [
            [t("vendor.pricePerK"), price(v.price)],
            [t("vendor.ttft"), ms(v.ttft)],
            [t("vendor.responseTime"), ms(v.totalTime)],
            [
              t("vendor.lastProbe"),
              v.lastProbeTime
                ? new Date(v.lastProbeTime).toLocaleTimeString(dateLocale())
                : t("common.never")
            ]
          ].forEach(function (pair) {
            dl.appendChild(text("dt", "", pair[0]));
            dl.appendChild(text("dd", "", pair[1]));
          });
          card.appendChild(dl);

          var foot = document.createElement("div");
          foot.className = "kuma-card-foot";
          var btn = text("button", "", t("common.refresh"));
          btn.type = "button";
          btn.setAttribute("aria-label", t("vendor.probeNow") + " " + v.name);
          btn.addEventListener("click", function () {
            btn.disabled = true;
            btn.textContent = t("common.probing");
            probe(v.name);
          });
          foot.appendChild(btn);
          card.appendChild(foot);

          grid.appendChild(card);
        });

        host.appendChild(grid);
      }

      /** 无供应商时给出可操作提示，而不是让用户面对空白页。 */
      function renderNotice(vendors) {
        var notice = el("kuma-notice");
        if (!notice) { return; }
        if (vendors.length > 0) {
          notice.hidden = true;
          notice.textContent = "";
          return;
        }
        notice.className = "kuma-empty";
        notice.textContent = t("vendor.noVendor");
        notice.hidden = false;
      }

      /**
       * 统计表列：表头词条键 + 取值函数。
       *
       * 每个 token 类目拆成两列（tokens 与对应费用），与既有的「数量 + 费用」扫读习惯
       * 一致；列序即需求给定的顺序，占比两列由 renderStats 追加（要先有全表合计）。
       */
      var COLUMNS = [
        ["stats.provider", function (r) { return r.provider; }],
        ["stats.model", function (r) { return r.model; }],
        ["stats.requests", function (r) { return count(r.requestCount); }],
        ["stats.tokensInput", function (r) { return count(r.tokensInput); }],
        ["stats.costInput", function (r) { return money(r.costInput); }],
        ["stats.tokensOutput", function (r) { return count(r.tokensOutput); }],
        ["stats.costOutput", function (r) { return money(r.costOutput); }],
        ["stats.cacheRead", function (r) { return count(r.tokensCacheRead); }],
        ["stats.costCacheRead", function (r) { return money(r.costCacheRead); }],
        ["stats.cacheWrite", function (r) { return count(r.tokensCacheWrite); }],
        ["stats.costCacheWrite", function (r) { return money(r.costCacheWrite); }],
        ["stats.toolCalls", function (r) { return count(r.toolCalls); }]
      ];

      function renderStats(rows, currentPeriod) {
        var host = el("kuma-stats");
        if (!host) { return; }
        host.textContent = "";

        var box = document.createElement("div");
        box.className = "kuma-scroll";
        var table = document.createElement("table");

        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        COLUMNS.forEach(function (col) {
          headRow.appendChild(text("th", "", t(col[0])));
        });
        // 占比按本期全表合计算：接口只返回分组结果，不为展示再做一次聚合
        var totalTokens = 0;
        var totalCost = 0;
        rows.forEach(function (r) {
          totalTokens += r.totalTokens || 0;
          totalCost += r.costTotal || 0;
        });
        [t("stats.shareTokens"), t("stats.shareCost")].forEach(function (name) {
          headRow.appendChild(text("th", "", name));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        if (rows.length === 0) {
          var emptyRow = document.createElement("tr");
          var cell = text(
            "td",
            "",
            t("common.noData") + t("common.periodOpen") + currentPeriod + t("common.periodClose"),
          );
          cell.colSpan = COLUMNS.length + 2;
          emptyRow.appendChild(cell);
          tbody.appendChild(emptyRow);
        }
        rows.forEach(function (r) {
          var tr = document.createElement("tr");
          COLUMNS.forEach(function (col) {
            tr.appendChild(text("td", "", col[1](r)));
          });
          tr.appendChild(text("td", "", share(r.totalTokens || 0, totalTokens)));
          tr.appendChild(text("td", "", share(r.costTotal || 0, totalCost)));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        box.appendChild(table);
        host.appendChild(box);
      }

      /**
       * 内联 SVG 折线图。
       *
       * 不用任何图表库：整页零外部请求，离线也完整可用。颜色取自主题 token，
       * 主题或家族切换后由 redrawChart() 重建。
       */
  `;
}
