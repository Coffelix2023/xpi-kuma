/**
 * 面板页内脚本。
 *
 * 负责凭据引导、数据拉取、时间范围切换、探测按钮、主题切换与 Chart.js 折线图。
 *
 * 访问凭据来自 URL fragment：fragment 不进入 HTTP 请求、不写访问日志、也不
 * 出现在第三方资源 Referer 中。脚本读取后立即从地址栏清除，并在 API 请求里
 * 通过 `Authorization` 头发送。
 */

/** Chart.js 版本固定，避免 CDN 漂移导致面板突然不可用。 */
export const CHART_JS_CDN =
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";

/** 可见页面的数据轮询间隔；新 usage 必须在 5 秒内反映到面板。 */
export const POLL_INTERVAL_MS = 5000;

/** 无供应商时展示的提示文案。 */
export const NO_VENDOR_NOTICE = "未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml";

export function dashboardClientScript(): string {
  return `
    (function () {
      "use strict";

      var POLL_MS = ${POLL_INTERVAL_MS};
      var DEFAULT_PERIOD = "24h";
      var NO_VENDOR = ${JSON.stringify(NO_VENDOR_NOTICE)};

      var token = readToken();
      var period = DEFAULT_PERIOD;
      var chart = null;
      var lastTrend = [];
      var busy = false;
      var timer = null;

      function el(id) { return document.getElementById(id); }

      /** 读取凭据并立刻抹掉地址栏 fragment：不留在历史记录，也不进 Referer。 */
      function readToken() {
        var hash = window.location.hash || "";
        var value = hash.charAt(0) === "#" ? hash.slice(1) : hash;
        window.history.replaceState(null, "", window.location.pathname);
        return value;
      }

      function setStatus(message) {
        var stamp = el("kuma-updated");
        if (stamp) { stamp.textContent = message; }
      }

      function api(path, method) {
        return fetch(path, {
          method: method || "GET",
          headers: { "Authorization": "Bearer " + token },
        }).then(function (response) {
          if (!response.ok) { throw new Error("HTTP " + response.status); }
          return response.json();
        });
      }

      /** 读取 CSS 变量；缺失时回退到 muted，保证图表始终有颜色。 */
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

      function money(n) {
        if (typeof n !== "number" || !isFinite(n)) { return "¥-"; }
        return "¥" + n.toFixed(2);
      }

      function ms(n) {
        if (typeof n !== "number" || !isFinite(n)) { return "—"; }
        return Math.round(n) + " ms";
      }

      function price(p) {
        if (!p) { return "未配置"; }
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
            ["价格/千tok", price(v.price)],
            ["TTFT", ms(v.ttft)],
            ["响应时间", ms(v.totalTime)],
            ["最近探测", v.lastProbeTime ? new Date(v.lastProbeTime).toLocaleTimeString() : "从未"],
          ].forEach(function (pair) {
            dl.appendChild(text("dt", "", pair[0]));
            dl.appendChild(text("dd", "", pair[1]));
          });
          card.appendChild(dl);

          var foot = document.createElement("div");
          foot.className = "kuma-card-foot";
          var btn = text("button", "", "刷新");
          btn.type = "button";
          btn.setAttribute("aria-label", "立即探测 " + v.name);
          btn.addEventListener("click", function () {
            btn.disabled = true;
            btn.textContent = "探测中…";
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
        notice.textContent = NO_VENDOR;
        notice.hidden = false;
      }

      var COLUMNS = [
        ["供应商 / 模型", function (r) { return [r.provider + " · " + r.model]; }],
        ["输入 tok", function (r) { return [r.tokensInput, money(r.costInput)]; }],
        ["输出 tok", function (r) { return [r.tokensOutput, money(r.costOutput)]; }],
        ["缓存读", function (r) { return [r.tokensCacheRead, money(r.costCacheRead)]; }],
        ["缓存写", function (r) { return [r.tokensCacheWrite, money(r.costCacheWrite)]; }],
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
          headRow.appendChild(text("th", "", col[0]));
        });
        ["总费用", "请求数"].forEach(function (name) {
          headRow.appendChild(text("th", "", name));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        if (rows.length === 0) {
          var emptyRow = document.createElement("tr");
          var cell = text("td", "", "暂无数据（" + currentPeriod + "）");
          cell.colSpan = COLUMNS.length + 2;
          emptyRow.appendChild(cell);
          tbody.appendChild(emptyRow);
        }
        rows.forEach(function (r) {
          var tr = document.createElement("tr");
          COLUMNS.forEach(function (col) {
            var pair = col[1](r);
            tr.appendChild(text("td", "", String(pair[0])));
            tr.appendChild(text("td", "", pair[1]));
          });
          tr.appendChild(text("td", "kuma-total", money(r.costTotal)));
          tr.appendChild(text("td", "", String(r.requestCount)));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        box.appendChild(table);
        host.appendChild(box);
      }

      function renderChart(trend) {
        var canvas = el("kuma-chart");
        if (!canvas || typeof Chart === "undefined") { return; }

        var providers = [];
        trend.forEach(function (point) {
          Object.keys(point.byProvider).forEach(function (name) {
            if (providers.indexOf(name) === -1) { providers.push(name); }
          });
        });

        var labels = trend.map(function (point) {
          return new Date(point.bucketStart).toLocaleString(undefined, {
            day: "2-digit", hour: "2-digit", minute: "2-digit",
          });
        });

        // 数据点很少时把点画出来，否则单桶数据看起来是一片空白
        var pointRadius = trend.length <= 2 ? 3 : 0;
        // 从 CSS 变量取色，保证主题切换后图表随之换色
        var style = getComputedStyle(document.documentElement);
        var palette = [
          cssVar(style, "--kuma-primary"),
          cssVar(style, "--kuma-success"),
          cssVar(style, "--kuma-warning"),
          cssVar(style, "--kuma-accent"),
          cssVar(style, "--kuma-error"),
          cssVar(style, "--kuma-muted"),
        ];
        var datasets = providers.map(function (name, index) {
          var color = palette[index % palette.length];
          return {
            label: name,
            data: trend.map(function (point) { return point.byProvider[name] || 0; }),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: pointRadius,
            tension: 0.25,
          };
        });

        datasets.push({
          label: "Token 总量",
          data: trend.map(function (point) { return point.tokens; }),
          borderColor: cssVar(style, "--kuma-muted"),
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: pointRadius,
          yAxisID: "tokens",
          tension: 0.25,
        });

        if (chart) { chart.destroy(); }
        chart = new Chart(canvas.getContext("2d"), {
          type: "line",
          data: { labels: labels, datasets: datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { labels: { color: "#808080", boxWidth: 10, font: { size: 10 } } },
              tooltip: { callbacks: {
                label: function (ctx) {
                  return ctx.dataset.label + ": " +
                    (ctx.dataset.yAxisID === "tokens" ? ctx.parsed.y : "¥" + ctx.parsed.y.toFixed(4));
                },
              } },
            },
            scales: {
              x: { ticks: { color: "#808080", maxTicksLimit: 8 }, grid: { color: "#3C3C3C" } },
              y: { ticks: { color: "#808080" }, grid: { color: "#3C3C3C" }, beginAtZero: true },
              tokens: { position: "right", ticks: { color: "#3C3C3C" }, grid: { display: false }, beginAtZero: true },
            },
          },
        });
      }

      function markRangeButtons(current) {
        var buttons = document.querySelectorAll("[data-range]");
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.setAttribute("aria-pressed", String(btn.getAttribute("data-range") === current));
        });
      }

      function render(data) {
        var vendors = data.vendors || [];
        if (data.period) { period = data.period; }
        markRangeButtons(period);
        renderVendors(vendors);
        renderNotice(vendors);
        renderStats(data.stats || [], period);
        lastTrend = data.trend || [];
        renderChart(lastTrend);
        setStatus("更新于 " + new Date().toLocaleTimeString());
      }

      function enableButtons() {
        var buttons = document.querySelectorAll("button");
        Array.prototype.forEach.call(buttons, function (btn) {
          if (btn.id === "kuma-theme") { return; }
          btn.disabled = false;
        });
        var all = el("kuma-refresh-all");
        if (all) { all.textContent = "全部刷新"; }
        var cardButtons = document.querySelectorAll(".kuma-card-foot button");
        Array.prototype.forEach.call(cardButtons, function (btn) {
          btn.textContent = "刷新";
        });
      }

      /** 连接错误只更新状态文案，保留已渲染数据，不启动重试风暴。 */
      function showError(error) {
        var message = error && error.message ? error.message : String(error);
        setStatus("连接失败（" + message + "），请重新执行 /xpi-kuma");
      }

      /** 同一时刻只允许一个在途请求：重复触发被丢弃，既不排队也不重试。 */
      function withBusy(task) {
        if (busy) { return Promise.resolve(false); }
        busy = true;
        return Promise.resolve()
          .then(task)
          .then(
            function () { return true; },
            function (error) { showError(error); return false; }
          )
          .then(function (ok) {
            busy = false;
            enableButtons();
            return ok;
          });
      }

      function load() {
        return api("/api/dashboard?period=" + encodeURIComponent(period)).then(render);
      }

      function refresh() {
        return withBusy(load);
      }

      function probe(vendor) {
        var path = vendor ? "/api/probes/" + encodeURIComponent(vendor) : "/api/probes";
        return withBusy(function () {
          return api(path, "POST").then(load);
        });
      }

      function stopPolling() {
        if (timer === null) { return; }
        window.clearInterval(timer);
        timer = null;
      }

      function startPolling() {
        if (timer !== null) { return; }
        timer = window.setInterval(function () {
          if (document.hidden) { return; }
          refresh();
        }, POLL_MS);
      }

      function onVisibilityChange() {
        if (document.hidden) { stopPolling(); return; }
        // 恢复可见时先立即刷新一次，再恢复轮询
        refresh();
        startPolling();
      }

      function wireRanges() {
        var buttons = document.querySelectorAll("[data-range]");
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.addEventListener("click", function () {
            period = btn.getAttribute("data-range") || period;
            markRangeButtons(period);
            refresh();
          });
        });
      }

      function wireTheme() {
        var btn = el("kuma-theme");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
          var current = document.documentElement.getAttribute("data-theme") || "dark";
          var next = current === "dark" ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", next);
          btn.setAttribute("aria-pressed", String(next === "light"));
          btn.textContent = next === "dark" ? "亮色" : "暗色";
          if (chart) {
            chart.destroy();
            chart = null;
          }
          renderChart(lastTrend);
        });
      }

      function wireRefreshAll() {
        var btn = el("kuma-refresh-all");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
          btn.disabled = true;
          probe(null);
        });
      }

      if (!token) {
        setStatus("缺少访问凭据，请重新执行 /xpi-kuma");
        return;
      }

      wireRanges();
      wireTheme();
      wireRefreshAll();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
    })();
  `;
}
