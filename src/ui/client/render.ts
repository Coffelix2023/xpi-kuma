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

      /**
       * 百分比：未知（null / 非数）显示「未知」文本，不用 0% 顶替 —— 0 是已知值。
       */
      function percent(rate) {
        if (typeof rate !== "number" || !isFinite(rate)) { return t("common.unknown"); }
        return (rate * 100).toFixed(1) + "%";
      }

      /** 缓存命中率 = cacheRead / (input + cacheRead)；分母为 0 时为 null（未知）。 */
      function cacheRate(cacheReadTokens, inputTokens) {
        var denominator = (cacheReadTokens || 0) + (inputTokens || 0);
        if (!denominator) { return null; }
        return cacheReadTokens / denominator;
      }

      /** 时间范围词条：与页头四档按钮共用一套键。 */
      function periodLabel(value) {
        if (value === "1h") { return t("range.1h"); }
        if (value === "7d") { return t("range.7d"); }
        if (value === "30d") { return t("range.30d"); }
        return t("range.24h");
      }

      /** 空态行：文字即状态，不依赖颜色传达。 */
      function mutedLine(message) {
        return text("p", "kuma-muted", message);
      }

      /**
       * 排行小表：headers 为 [词条键, 是否数字列]，rows 为字符串二维数组。
       *
       * 数字列右对齐并用等宽数字，窄视口由 .kuma-scroll 横向滚动而不是压扁列宽。
       */
      function dataTable(headers, rows) {
        var box = document.createElement("div");
        box.className = "kuma-scroll";
        var table = document.createElement("table");
        table.className = "kuma-table";
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        headers.forEach(function (head) {
          headRow.appendChild(text("th", head[1] ? "kuma-num" : "", t(head[0])));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        rows.forEach(function (row) {
          var tr = document.createElement("tr");
          row.forEach(function (cell, index) {
            tr.appendChild(text("td", headers[index][1] ? "kuma-num" : "", cell));
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        box.appendChild(table);
        return box;
      }


      function text(tag, className, content) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        node.textContent = content;
        return node;
      }

      /**
       * 按供应商分组的模型卡片。
       *
       * 接口返回的 vendors 是扁平的 (供应商, 模型) 列表；这里按 name 分组，
       * 供应商信息（endpoint / 编辑 / 删除 / 探测全部）落在分组头，卡片只讲单个模型的
       * TTFT、响应时间与最近探测 —— 卡片的存在意义是比这两个时间指标。
       */
      function renderVendors(vendors) {
        var host = el("kuma-vendors");
        if (!host) { return; }
        host.textContent = "";

        groupByVendor(vendors).forEach(function (group) {
          var section = document.createElement("section");
          section.className = "kuma-vendor-group";
          section.appendChild(vendorHead(group));

          var grid = document.createElement("div");
          grid.className = "kuma-grid";
          group.models.forEach(function (v) {
            grid.appendChild(modelCard(v));
          });
          section.appendChild(grid);
          host.appendChild(section);
        });
      }

      /** 按供应商名分组，保持接口给的顺序（分组头与卡片的相对次序都可预期）。 */
      function groupByVendor(vendors) {
        var groups = [];
        var index = {};
        vendors.forEach(function (v) {
          if (!index[v.name]) {
            index[v.name] = { models: [], name: v.name, endpoint: v.endpoint };
            groups.push(index[v.name]);
          }
          index[v.name].models.push(v);
        });
        return groups;
      }

      /** 供应商分组头：名称 / endpoint / 编辑 / 删除 / 探测全部。 */
      function vendorHead(group) {
        var head = document.createElement("div");
        head.className = "kuma-vendor-head";
        head.appendChild(text("span", "kuma-card-name", group.name));
        head.appendChild(text("span", "kuma-card-model", group.endpoint || ""));

        var actions = document.createElement("div");
        actions.className = "kuma-vendor-actions";
        var all = text("button", "", t("vendor.probeAll"));
        all.type = "button";
        all.setAttribute("aria-label", t("vendor.probeAll") + " " + group.name);
        all.addEventListener("click", function () {
          all.disabled = true;
          probe(group.name);
        });
        actions.appendChild(all);
        actions.appendChild(vendorAction(t("vendor.edit"), function () {
          openVendorForm(group);
        }));
        actions.appendChild(vendorAction(t("vendor.remove"), function () {
          askRemoveVendor(group.name);
        }));
        head.appendChild(actions);
        return head;
      }

      function vendorAction(label, onClick) {
        var btn = text("button", "", label);
        btn.type = "button";
        btn.addEventListener("click", onClick);
        return btn;
      }

      /** 单模型卡片：状态、TTFT、响应时间、最近探测与只探测该模型的按钮。 */
      function modelCard(v) {
        var card = document.createElement("article");
        card.className = "kuma-card";

        var head = document.createElement("div");
        head.className = "kuma-card-head";
        head.appendChild(text("span", "", statusIcon(v.status)));
        head.appendChild(text("span", "kuma-card-model", v.model));
        card.appendChild(head);

        card.appendChild(text("span", "kuma-badge " + statusClass(v.status), v.status));

        var dl = document.createElement("dl");
        dl.className = "kuma-kv";
        [
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
        btn.setAttribute("aria-label", t("vendor.probeNow") + " " + v.name + " " + v.model);
        btn.addEventListener("click", function () {
          btn.disabled = true;
          btn.textContent = t("common.probing");
          probe(v.name, v.model);
        });
        foot.appendChild(btn);
        card.appendChild(foot);
        return card;
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
       * 一致；末尾追加占比两列与费用占比 / 单请求成本 / 缓存命中率三列（都要先有全表
       * 合计，见 renderStats），超出首屏的行由 foldStats 折叠成一行汇总。
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
        ["stats.toolCalls", function (r) { return count(r.toolCalls); }],
        ["stats.costPerRequest", function (r) {
          if (r.requestCount > 0) { return money(r.costTotal / r.requestCount); }
          return t("common.unknown");
        }],
        ["stats.cacheHitRate", function (r) {
          return percent(cacheRate(r.tokensCacheRead, r.tokensInput));
        }]
      ];

      /** 首屏最多展示的统计行；其余组合折叠成一行汇总。 */
      var STATS_TOP = 8;

      /**
       * 折叠行：溢出组合的数值相加，占比与单请求成本按汇总值重算。
       *
       * 汇总行的第一列写明「其余 N 个组合」，与真实组合区分，避免误读成某个组合。
       */
      function foldStats(rows) {
        var visible = rows.slice(0, STATS_TOP);
        var rest = rows.slice(STATS_TOP);
        if (rest.length === 0) { return visible; }
        var sum = { provider: t("stats.otherPrefix") + rest.length + t("stats.otherSuffix"), model: "" };
        [
          "requestCount",
          "tokensInput",
          "tokensOutput",
          "tokensCacheRead",
          "tokensCacheWrite",
          "costInput",
          "costOutput",
          "costCacheRead",
          "costCacheWrite",
          "costTotal",
          "toolCalls",
          "totalTokens"
        ].forEach(function (field) {
          sum[field] = 0;
          rest.forEach(function (r) { sum[field] += r[field] || 0; });
        });
        visible.push(sum);
        return visible;
      }

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
        foldStats(rows).forEach(function (r) {
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
