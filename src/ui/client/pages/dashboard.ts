import { ATLAS_FAMILY, FAMILY_KEY, THEME_KEY } from "../constants.ts";

/**
 * 主面板页面片段：渲染、事件绑定与初始化。
 *
 * 依赖前序片段提供 token（凭据）、api（请求）、startPolling（轮询）；
 * 函数声明在同一 IIFE 作用域内提升，因此调用顺序无关紧要。
 */
export function dashboardPageFragment(): string {
  return `
      /** 当前归因维度；由归因区块的按钮切换。 */
      var dimension = "project";
      function markRangeButtons(current) {
        var buttons = document.querySelectorAll("[data-range]");
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.setAttribute("aria-pressed", String(btn.getAttribute("data-range") === current));
        });
      }

      /**
       * 渲染一次刷新拿到的数据。
       *
       * 概览、归因、统计与趋势来自同一个请求、同一个时间范围与同一份总花费，所以归因
       * 各分组花费之和恒等于概览的本期花费；切换归因维度只需重查这一个请求。
       */
      function render(data) {
        var vendors = data.vendors || [];
        if (data.period) { period = data.period; }
        markRangeButtons(period);
        var overview = data.overview || {};
        renderOverview(overview, period);
        renderAttribution(data.attribution || [], dimension, overview.costTotal || 0);
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
        return api(
          "/api/dashboard?period=" + encodeURIComponent(period) +
            "&dimension=" + encodeURIComponent(dimension)
        ).then(render);
      }

      function wireDimensions() {
        var buttons = document.querySelectorAll("[data-dimension]");
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.addEventListener("click", function () {
            dimension = btn.getAttribute("data-dimension") || dimension;
            markDimensionButtons(dimension);
            refresh();
          });
        });
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
      wireDimensions();
      wireRail();
      wireTheme();
      wireFamily();
      wireRefreshAll();
      wireNav();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
  `;
}
