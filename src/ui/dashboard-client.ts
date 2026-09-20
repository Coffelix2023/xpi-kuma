/**
 * 面板页内脚本。
 *
 * 负责凭据引导、数据拉取、时间范围切换、探测按钮、主题与家族切换，以及内联 SVG 折线图。
 *
 * 访问凭据来自 URL fragment：fragment 不进入 HTTP 请求、不写访问日志、也不
 * 出现在第三方资源 Referer 中。脚本读取后立即从地址栏清除，并在 API 请求里
 * 通过 `Authorization` 头发送。
 */

/** 可见页面的数据轮询间隔；新 usage 必须在 5 秒内反映到面板。 */
export const POLL_INTERVAL_MS = 5000;

/** 无供应商时展示的提示文案。 */
export const NO_VENDOR_NOTICE = "未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml";

/** 主题与家族偏好的 localStorage 键；与 THEMES.md 约定的键名一致。 */
export const THEME_KEY = "kuma.theme";
export const FAMILY_KEY = "kuma.family";

/** Atlas 家族标识；取值与 `theme.ts` 的 `ThemeFamily` 一致。 */
export const ATLAS_FAMILY = "atlas";

/**
 * 首帧前应用主题与家族偏好。
 *
 * 这段脚本必须放在 `<head>` 里、在任何可见内容之前**同步**执行：否则浏览器会先按
 * HTML 上的默认外观绘制一帧，再跳到用户偏好，出现可见闪烁。
 *
 * localStorage 在隐私模式或禁用存储时可能抛错，因此整体包在 try 里；取不到偏好
 * 就保持 HTML 的默认值（暗色 + 默认家族）。
 */
export function preferenceBootstrapScript(): string {
  return `(function () {
  try {
    var theme = localStorage.getItem("${THEME_KEY}");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    if (localStorage.getItem("${FAMILY_KEY}") === "${ATLAS_FAMILY}") {
      document.documentElement.setAttribute("data-family", "${ATLAS_FAMILY}");
    }
  } catch (error) {
    // 存储不可用时按默认外观继续，不阻断页面
  }
})();`;
}

export function dashboardClientScript(): string {
  return `
    (function () {
      "use strict";

      var POLL_MS = ${POLL_INTERVAL_MS};
      var DEFAULT_PERIOD = "24h";
      var NO_VENDOR = ${JSON.stringify(NO_VENDOR_NOTICE)};

      var token = readToken();
      var period = DEFAULT_PERIOD;
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

      /**
       * 内联 SVG 折线图。
       *
       * 不用任何图表库：整页零外部请求，离线也完整可用。颜色取自主题 token，
       * 主题或家族切换后由 redrawChart() 重建。
       */
      function renderChart(trend) {
        var host = el("kuma-chart");
        if (!host) { return; }
        host.textContent = "";
        if (!trend || trend.length === 0) { return; }

        var style = getComputedStyle(document.documentElement);
        var palette = [
          cssVar(style, "--chart-1"),
          cssVar(style, "--chart-2"),
          cssVar(style, "--chart-3"),
          cssVar(style, "--chart-4"),
          cssVar(style, "--chart-5"),
        ];
        var ink = cssVar(style, "--muted-foreground");
        var rule = cssVar(style, "--border");

        var providers = [];
        trend.forEach(function (point) {
          Object.keys(point.byProvider || {}).forEach(function (name) {
            if (providers.indexOf(name) === -1) { providers.push(name); }
          });
        });

        var width = host.clientWidth || 720;
        var height = 260;
        var padTop = 28;
        var padRight = 56;
        var padBottom = 28;
        var padLeft = 56;
        var plotW = Math.max(1, width - padLeft - padRight);
        var plotH = Math.max(1, height - padTop - padBottom);

        var maxCost = 0;
        var maxTokens = 0;
        trend.forEach(function (point) {
          providers.forEach(function (name) {
            maxCost = Math.max(maxCost, point.byProvider[name] || 0);
          });
          maxTokens = Math.max(maxTokens, point.tokens || 0);
        });
        if (maxCost <= 0) { maxCost = 1; }
        if (maxTokens <= 0) { maxTokens = 1; }

        var step = trend.length > 1 ? plotW / (trend.length - 1) : 0;
        function xAt(index) {
          return padLeft + (trend.length > 1 ? index * step : plotW / 2);
        }
        function yCost(value) { return padTop + plotH - (value / maxCost) * plotH; }
        function yTokens(value) { return padTop + plotH - (value / maxTokens) * plotH; }

        var svg = svgNode("svg", {
          height: String(height),
          viewBox: "0 0 " + width + " " + height,
          width: "100%",
        });
        svg.appendChild(svgNode("title", {}, "费用与 token 趋势"));
        svg.appendChild(svgNode("desc", {}, "按时间的费用折线（左轴）与 token 总量虚线（右轴），每个供应商一条折线；悬停某一时间点可看该点明细。"));

        // 横向网格与左轴费用刻度
        var gridLines = 4;
        for (var g = 0; g <= gridLines; g += 1) {
          var gridValue = (maxCost * g) / gridLines;
          var gridY = yCost(gridValue);
          svg.appendChild(svgNode("line", {
            stroke: rule,
            "stroke-width": 1,
            x1: padLeft, x2: padLeft + plotW, y1: gridY, y2: gridY,
          }));
          svg.appendChild(svgLabel(padLeft - 8, gridY + 3, "¥" + gridValue.toFixed(4), ink, "end"));
        }

        // 横轴时间标签，最多 6 个
        var ticks = Math.min(6, trend.length);
        for (var t = 0; t < ticks; t += 1) {
          var index = ticks === 1 ? 0 : Math.round((t * (trend.length - 1)) / (ticks - 1));
          var when = new Date(trend[index].bucketStart).toLocaleString(undefined, {
            day: "2-digit", hour: "2-digit", minute: "2-digit",
          });
          svg.appendChild(svgLabel(xAt(index), height - 8, when, ink, "middle"));
        }

        // 图例
        var legendX = padLeft;
        providers.forEach(function (name, index) {
          svg.appendChild(svgNode("rect", {
            fill: palette[index % palette.length],
            height: 8, width: 8, x: legendX, y: 4,
          }));
          svg.appendChild(svgLabel(legendX + 12, 12, name, ink, "start"));
          legendX += 20 + name.length * 7;
        });

        // 每个供应商一条费用折线
        providers.forEach(function (name, index) {
          svg.appendChild(svgNode("polyline", {
            fill: "none",
            points: trend.map(function (point, i) {
              return xAt(i) + "," + yCost(point.byProvider[name] || 0);
            }).join(" "),
            stroke: palette[index % palette.length],
            "stroke-linejoin": "round",
            "stroke-width": 2,
          }));
        });

        // token 总量虚线（右轴）
        svg.appendChild(svgNode("polyline", {
          fill: "none",
          points: trend.map(function (point, i) {
            return xAt(i) + "," + yTokens(point.tokens || 0);
          }).join(" "),
          stroke: ink,
          "stroke-dasharray": "4 4",
          "stroke-width": 1,
        }));

        // 数据点很少时画出点，否则单桶数据看起来是一片空白
        if (trend.length <= 2) {
          providers.forEach(function (name, index) {
            trend.forEach(function (point, i) {
              svg.appendChild(svgNode("circle", {
                cx: xAt(i), cy: yCost(point.byProvider[name] || 0), r: 3,
                fill: palette[index % palette.length],
              }));
            });
          });
        }

        // 每个时间桶一个透明悬停带：用 SVG 原生 title 显示该点明细
        trend.forEach(function (point, i) {
          var bandWidth = trend.length > 1 ? step : plotW;
          var band = svgNode("rect", {
            fill: "transparent",
            height: plotH,
            width: bandWidth,
            x: xAt(i) - bandWidth / 2,
            y: padTop,
          });
          band.appendChild(svgNode("title", {}, pointSummary(point)));
          svg.appendChild(band);
        });

        host.appendChild(svg);
      }

      /** 建一个 SVG 命名空间元素；属性值为 null/undefined 时跳过。 */
      function svgNode(name, attrs, text) {
        var node = document.createElementNS("http://www.w3.org/2000/svg", name);
        Object.keys(attrs).forEach(function (key) {
          if (attrs[key] !== null && attrs[key] !== undefined) {
            node.setAttribute(key, String(attrs[key]));
          }
        });
        if (text !== undefined) { node.textContent = text; }
        return node;
      }

      /** SVG 文本：统一字号与锚点，颜色跟随主题 token。 */
      function svgLabel(x, y, value, color, anchor) {
        return svgNode("text", {
          fill: color,
          "font-size": 10,
          "text-anchor": anchor,
          x: x,
          y: y,
        }, value);
      }

      /** 悬停详情：时间点 + 各供应商费用 + token 总量。 */
      function pointSummary(point) {
        var parts = [new Date(point.bucketStart).toLocaleString()];
        Object.keys(point.byProvider || {}).forEach(function (name) {
          parts.push(name + " ¥" + (point.byProvider[name] || 0).toFixed(4));
        });
        parts.push("Token " + (point.tokens || 0));
        return parts.join(" · ");
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
          if (btn.id === "kuma-theme" || btn.id === "kuma-family") { return; }
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
        syncThemeButton(btn);
        btn.addEventListener("click", function () {
          var current = document.documentElement.getAttribute("data-theme") || "dark";
          applyTheme(current === "dark" ? "light" : "dark");
          syncThemeButton(btn);
          redrawChart();
        });
      }

      /** 应用明暗模式并持久化；存储不可用时只应用不持久化。 */
      function applyTheme(mode) {
        document.documentElement.setAttribute("data-theme", mode);
        try {
          localStorage.setItem("${THEME_KEY}", mode);
        } catch (error) {
          // 隐私模式下写入失败，本次会话内仍然生效
        }
      }

      function syncThemeButton(btn) {
        var mode = document.documentElement.getAttribute("data-theme") || "dark";
        btn.setAttribute("aria-pressed", String(mode === "light"));
        btn.textContent = mode === "dark" ? "亮色" : "暗色";
      }

      function wireFamily() {
        var btn = el("kuma-family");
        if (!btn) { return; }
        syncFamilyButton(btn);
        btn.addEventListener("click", function () {
          var current = document.documentElement.getAttribute("data-family") || "default";
          applyFamily(current === "${ATLAS_FAMILY}" ? "default" : "${ATLAS_FAMILY}");
          syncFamilyButton(btn);
          redrawChart();
        });
      }

      /** 应用主题家族并持久化；默认家族移除属性，让 :root 的默认块生效。 */
      function applyFamily(family) {
        if (family === "${ATLAS_FAMILY}") {
          document.documentElement.setAttribute("data-family", "${ATLAS_FAMILY}");
        } else {
          document.documentElement.removeAttribute("data-family");
        }
        try {
          localStorage.setItem("${FAMILY_KEY}", family);
        } catch (error) {
          // 同上：写入失败不影响本次会话
        }
      }

      function syncFamilyButton(btn) {
        var atlas = document.documentElement.getAttribute("data-family") === "${ATLAS_FAMILY}";
        btn.setAttribute("aria-pressed", String(atlas));
        btn.textContent = atlas ? "默认风" : "图鉴风";
      }

      /** 主题或家族变化后重建图表：颜色取自 CSS 变量，必须重建才能换色。 */
      function redrawChart() {
        renderChart(lastTrend);
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
      wireFamily();
      wireRefreshAll();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
    })();
  `;
}
