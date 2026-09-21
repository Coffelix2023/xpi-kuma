import { ATLAS_FAMILY, FAMILY_KEY, THEME_KEY } from "../constants.ts";

/**
 * 主面板页面片段：渲染、事件绑定与初始化。
 *
 * 依赖前序片段提供 token（凭据）、api（请求）、startPolling（轮询）；
 * 函数声明在同一 IIFE 作用域内提升，因此调用顺序无关紧要。
 */
export function dashboardPageFragment(): string {
  return `
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
        renderVendors(vendors);
        renderNotice(vendors);
        renderStats(data.stats || [], period);
        lastTrend = data.trend || [];
        renderChart(lastTrend);
        setStatus(t("common.updatedAt") + " " + new Date().toLocaleTimeString(dateLocale()));
      }

      /**
       * 数据刷新结束后重新启用被置灰的按钮。
       *
       * 跳过带 data-preference 标记的偏好类按钮（主题 / 家族 / 字号档位）：它们的可用
       * 状态由自己的偏好决定，跟着刷新一起解禁会让「已到边界」的档位按钮又变成可点。
       */
      function enableButtons() {
        var buttons = document.querySelectorAll("button");
        Array.prototype.forEach.call(buttons, function (btn) {
          if (btn.getAttribute("data-preference") !== null) { return; }
          btn.disabled = false;
        });
        var all = el("kuma-refresh-all");
        if (all) { all.textContent = t("page.dashboard.refreshAll"); }
        var cardButtons = document.querySelectorAll(".kuma-card-foot button");
        Array.prototype.forEach.call(cardButtons, function (btn) {
          btn.textContent = t("common.refresh");
        });
      }

      /** 连接错误只更新状态文案，保留已渲染数据，不启动重试风暴。 */
      function showError(error) {
        var message = error && error.message ? error.message : String(error);
        setStatus(failureStatus(message));
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
        return api("/api/dashboard?period=" + encodeURIComponent(period)).then(
          render
        );
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
        btn.textContent = mode === "dark" ? t("page.dashboard.toLight") : t("page.dashboard.toDark");
      }

      /** 家族下拉：选中值就是目标家族，不需要在代码里做二态取反。 */
      function wireFamily() {
        var select = el("kuma-family");
        if (!select) { return; }
        syncFamilySelect(select);
        select.addEventListener("change", function () {
          applyFamily(select.value);
          syncFamilySelect(select);
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

      /** 把当前家族写回下拉选中值；首帧与切换后都要同步。 */
      function syncFamilySelect(select) {
        var atlas = document.documentElement.getAttribute("data-family") === "${ATLAS_FAMILY}";
        select.value = atlas ? "${ATLAS_FAMILY}" : "default";
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
        setStatus(t("common.missingToken"));
        return;
      }

      wireRanges();
      wireTabs();
      wireTheme();
      wireFamily();
      wireRefreshAll();
      wireNav();
      wireLanguage();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
  `;
}
