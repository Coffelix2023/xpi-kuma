/**
 * 零数据引导页片段：判定"没配供应商"还是"有供应商但没记录"，并给出对应路径。
 *
 * 依赖前序片段提供 token / api / poll / setStatus；数据来自主面板同一份接口，
 * 因此不需要新的后端接口。
 */
export function emptyPageFragment(): string {
  return `
      function showSection(id, visible) {
        var node = el(id);
        if (node) { node.hidden = !visible; }
      }

      /**
       * 两条分支：
       *
       * - 配置里没有供应商 → 只讲怎么加第一个供应商；
       * - 有供应商 → 列产生数据的三条路径，并按有没有记录给出下一步。
       */
      function renderGuide(payload) {
        var vendors = payload.vendors || [];
        var overview = payload.overview || {};
        var hasVendors = vendors.length > 0;

        showSection("section-guide-vendors", !hasVendors);
        showSection("section-guide-data", hasVendors);

        var status = el("kuma-guide-status");
        if (!status) { return; }
        if (!hasVendors) {
          status.textContent = "";
          return;
        }
        status.textContent = overview.requestCount
          ? t("guide.hasRecordsPrefix") + overview.requestCount + t("guide.hasRecordsMiddle") + (payload.period || "") + t("guide.hasRecordsSuffix")
          : t("guide.noRecords");
      }

      /** 判断空态用的时间窗：取面板支持的最大范围，避免"更早的记录"被漏看。 */
      var GUIDE_PERIOD = "30d";

      function loadGuide() {
        return api(
          "/api/dashboard?period=" + encodeURIComponent(GUIDE_PERIOD) +
            "&dimension=project"
        ).then(function (payload) {
          renderGuide(payload);
          setStatus(t("common.updatedAt") + " " + new Date().toLocaleTimeString(dateLocale()));
        });
      }

      /** 轮询与其它页面共用同一套「可见性感知」逻辑。 */
      function refresh() {
        return loadGuide().then(
          function () { return true; },
          function (error) { showGuideError(error); return false; }
        );
      }

      function showGuideError(error) {
        var message = error && error.message ? error.message : String(error);
        setStatus(failureStatus(message));
      }

      if (!token) {
        setStatus(t("common.missingToken"));
        return;
      }

      wireNav();
      wireLanguage();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
  `;
}
