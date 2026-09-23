/**
 * 配置体检页片段：只读地把解析结果、逐供应商检查与全局存储摊开。
 *
 * 依赖前序片段提供 token / api / poll / text / setStatus；数据只来自 `/api/diagnostics`。
 * 页面不产生任何写盘操作，也不提供"自动修复"入口 —— 修复永远由用户改配置文件完成。
 */
export function settingsPageFragment(): string {
  return `
      /** 五项检查的显示名；键与服务端 VendorCheckKey 一致（见 diagnostics/inspect.ts）。 */
      var CHECK_LABELS = {
        apiKey: "check.apiKey",
        endpoint: "check.endpoint",
        models: "check.models",
        probe: "check.probe",
        required: "check.required"
      };

      function showSection(id, visible) {
        var node = el(id);
        if (node) { node.hidden = !visible; }
      }

      function kvRow(dl, label, value) {
        dl.appendChild(text("dt", "", label));
        dl.appendChild(text("dd", "", value));
      }

      function kvList() {
        var dl = document.createElement("dl");
        dl.className = "kuma-kv kuma-kv-wide";
        return dl;
      }

      function formatBytes(bytes) {
        if (typeof bytes !== "number" || !isFinite(bytes)) { return t("common.unknown"); }
        if (bytes < 1024) { return bytes + " B"; }
        return group(bytes / 1024, 1) + " KB";
      }

      /** 配置明细：路径、来源、文件状态、解析结果与修改时间。 */
      function renderConfigDetail(payload) {
        var host = el("kuma-diagnostics");
        if (!host) { return; }
        host.textContent = "";
        var dl = kvList();
        kvRow(dl, t("settings.row.path"), payload.configPath);
        kvRow(dl, t("settings.row.source"), t("settings.sourceNote"));
        kvRow(dl, t("settings.row.fileState"), payload.configExists ? t("settings.fileExists") : t("settings.fileMissing"));
        kvRow(dl, t("settings.row.parseResult"), payload.error ? t("settings.parseFail") : t("settings.parseOk"));
        kvRow(dl, t("settings.row.modifiedAt"), payload.configModifiedAt
          ? new Date(payload.configModifiedAt).toLocaleString(dateLocale())
          : t("common.unknown"));
        host.appendChild(dl);
      }

      /** 解析失败替代卡：只讲原因、行号与文件，不给"修复后"的假数据。 */
      function renderDiagnosticsError(payload) {
        var host = el("kuma-diagnostics-error");
        if (!host) { return; }
        host.textContent = "";
        var box = document.createElement("div");
        box.className = "kuma-empty";
        var lines = [payload.error];
        if (payload.errorLine) { lines.push(t("settings.errorLinePrefix") + payload.errorLine + t("settings.errorLineSuffix")); }
        lines.push(t("settings.errorFilePrefix") + payload.configPath);
        lines.push(t("settings.errorHint"));
        lines.forEach(function (line) {
          box.appendChild(text("p", "", line));
        });
        host.appendChild(box);
      }

      /**
       * 摘要条：供应商数 / 检查项总数 / 未通过数 / 解析状态。
       *
       * 四项都是计数或状态，不给结论性判断 —— 结论由每张体检卡的 pill 表达。
       */
      function renderSummary(payload, vendorCount) {
        var host = el("kuma-issues");
        if (!host) { return; }
        host.textContent = "";
        var checks = 0;
        (payload.vendors || []).forEach(function (vendor) {
          checks += vendor.checks.length;
        });
        [
          [t("settings.summary.vendors"), count(vendorCount)],
          [t("settings.summary.checks"), count(checks)],
          [t("settings.summary.issues"), count(payload.issueCount || 0)],
          [
            t("settings.summary.parse"),
            payload.error ? t("settings.parseFail") : t("settings.parseOk")
          ]
        ].forEach(function (pair) {
          var item = document.createElement("span");
          item.className = "kuma-summary-item";
          item.appendChild(text("span", "kuma-summary-label", pair[0]));
          item.appendChild(text("span", "kuma-summary-value", pair[1]));
          host.appendChild(item);
        });
      }

      /** 通过 / 未通过 pill。 */
      function checkPill(ok) {
        return text("span", "kuma-pill " + (ok ? "kuma-pill-ok" : "kuma-pill-fail"), ok ? t("settings.pass") : t("settings.fail"));
      }

      /**
       * 每供应商一张体检卡：卡头是名字、endpoint 与整体结论，卡内逐项检查。
       *
       * 原来是「供应商名 rowspan + 五行表格」，把供应商与检查项两个层级压平；
       * 分卡之后一眼能看出是哪一家出了问题。
       */
      function renderVendorChecks(vendors) {
        var host = el("kuma-diagnostics-vendors");
        if (!host) { return; }
        host.textContent = "";
        if (vendors.length === 0) {
          host.appendChild(text("div", "kuma-empty", t("settings.noVendor")));
          return;
        }

        vendors.forEach(function (vendor) {
          var card = document.createElement("article");
          card.className = "kuma-vendor-check" + (vendor.issueCount > 0 ? " kuma-vendor-check-fail" : "");

          var head = document.createElement("div");
          head.className = "kuma-vendor-check-head";
          head.appendChild(text("span", "kuma-card-name", vendor.name));
          head.appendChild(text("span", "kuma-card-model", vendor.endpoint));
          head.appendChild(
            text(
              "span",
              "kuma-pill " + (vendor.issueCount > 0 ? "kuma-pill-fail" : "kuma-pill-ok"),
              vendor.issueCount > 0 ? t("settings.fail") : t("settings.pass")
            )
          );
          card.appendChild(head);

          var list = document.createElement("ul");
          list.className = "kuma-check-list";
          vendor.checks.forEach(function (check) {
            var item = document.createElement("li");
            item.className = "kuma-check-item" + (check.ok ? "" : " kuma-check-item-fail");
            item.appendChild(text("span", "kuma-check-name", t(CHECK_LABELS[check.key] || check.key)));
            item.appendChild(checkPill(check.ok));
            item.appendChild(text("span", "kuma-check-detail", check.detail));
            if (!check.ok && check.action) {
              item.appendChild(text("span", "kuma-check-action", t("settings.col.action") + t("common.colon") + check.action));
            }
            list.appendChild(item);
          });
          card.appendChild(list);
          host.appendChild(card);
        });
      }

      /** 全局与存储项；文件不存在时明确写「不存在」。 */
      function renderGlobal(global) {
        var host = el("kuma-diagnostics-global");
        if (!host) { return; }
        host.textContent = "";
        var dl = kvList();
        kvRow(dl, t("global.retention"),
          global.retentionDays + t("unit.day") + (global.retentionIsDefault ? t("global.defaultValue") : t("global.configuredValue")));
        kvRow(dl, t("global.databasePath"), global.databasePath);
        kvRow(dl, t("global.databaseState"),
          global.databaseExists ? t("global.bytesPrefix") + formatBytes(global.databaseBytes) + t("global.bytesSuffix") : t("settings.fileMissing"));
        kvRow(dl, t("global.probeDefaults"),
          t("global.probeSummaryPrefix") + global.probeInterval + t("global.probeSummaryMiddle") + global.probeTimeoutMs + t("global.probeSummarySuffix"));
        kvRow(dl, t("global.cwd"), global.cwd);
        host.appendChild(dl);
      }

      function renderDiagnostics(payload) {
        renderConfigDetail(payload);

        if (payload.error) {
          // fail-closed：不展示供应商卡与全局卡，避免半截数据误导判断
          showSection("section-diagnostics-vendors", false);
          showSection("section-diagnostics-global", false);
          renderSummary(payload, 0);
          renderDiagnosticsError(payload);
          showSection("section-diagnostics-error", true);
          setStatus(t("common.updatedAt") + " " + new Date().toLocaleTimeString(dateLocale()));
          return;
        }

        var vendors = payload.vendors || [];
        showSection("section-diagnostics-error", false);
        renderSummary(payload, vendors.length);
        renderVendorChecks(vendors);
        renderGlobal(payload.global || {});
        showSection("section-diagnostics-vendors", true);
        showSection("section-diagnostics-global", true);
        setStatus(t("common.updatedAt") + " " + new Date().toLocaleTimeString(dateLocale()));
      }

      function loadDiagnostics() {
        return api("/api/diagnostics").then(renderDiagnostics);
      }

      /** 轮询与其它页面共用同一套「可见性感知」逻辑。 */
      function refresh() {
        return loadDiagnostics().then(
          function () { return true; },
          function (error) { showDiagnosticsError(error); return false; }
        );
      }

      function showDiagnosticsError(error) {
        var message = error && error.message ? error.message : String(error);
        setStatus(failureStatus(message));
      }

      function wireReload() {
        var btn = el("kuma-reload");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
          if (busy) { return; }
          busy = true;
          btn.disabled = true;
          loadDiagnostics().then(
            function () { busy = false; btn.disabled = false; },
            function (error) { busy = false; btn.disabled = false; showDiagnosticsError(error); }
          );
        });
      }

      if (!token) {
        setStatus(t("common.missingToken"));
        return;
      }

      wireNav();
      wireLanguage();
      wireReload();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
  `;
}
