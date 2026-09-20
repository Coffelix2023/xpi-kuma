/**
 * 配置体检页片段：只读地把解析结果、逐供应商检查与全局存储摊开。
 *
 * 依赖前序片段提供 token / api / poll / text / setStatus；数据只来自 `/api/diagnostics`。
 * 页面不产生任何写盘操作，也不提供"自动修复"入口 —— 修复永远由用户改配置文件完成。
 */
export function settingsPageFragment(): string {
  return `
      /** 六项检查的显示名；键与服务端 VendorCheckKey 一致（见 diagnostics/inspect.ts）。 */
      var CHECK_LABELS = {
        apiKey: "check.apiKey",
        endpoint: "check.endpoint",
        model: "check.model",
        price: "check.price",
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
        return (bytes / 1024).toFixed(1) + " KB";
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

      /** 供应商体检表：每行一项检查，未通过的行带下一步动作。 */
      function renderVendorChecks(vendors, issueCount) {
        var issues = el("kuma-issues");
        if (issues) {
          issues.textContent = issueCount > 0
            ? t("settings.issuesPrefix") + issueCount + t("settings.issuesSuffix")
            : t("settings.allPass");
        }

        var host = el("kuma-diagnostics-vendors");
        if (!host) { return; }
        host.textContent = "";
        if (vendors.length === 0) {
          host.appendChild(text("div", "kuma-empty", t("settings.noVendor")));
          return;
        }

        var box = document.createElement("div");
        box.className = "kuma-scroll";
        var table = document.createElement("table");
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        [
          "settings.col.vendor",
          "settings.col.check",
          "settings.col.result",
          "settings.col.detail",
          "settings.col.action"
        ].forEach(function (key) {
          headRow.appendChild(text("th", "", t(key)));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        vendors.forEach(function (vendor) {
          var tbody = document.createElement("tbody");
          vendor.checks.forEach(function (check, index) {
            var tr = document.createElement("tr");
            if (index === 0) {
              var nameCell = text("td", "", vendor.name);
              // 供应商名纵向合并，表格才不会被同一个名字刷屏
              nameCell.setAttribute("rowspan", String(vendor.checks.length));
              tr.appendChild(nameCell);
            }
            tr.appendChild(text("td", "", t(CHECK_LABELS[check.key] || check.key)));
            tr.appendChild(text("td", check.ok ? "" : "kuma-check-fail", check.ok ? t("settings.pass") : t("settings.fail")));
            tr.appendChild(text("td", "kuma-note", check.detail));
            tr.appendChild(text("td", "kuma-note", check.action || t("settings.actionNone")));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
        });
        box.appendChild(table);
        host.appendChild(box);
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
          // fail-closed：不展示供应商表与全局项，避免半截数据误导判断
          showSection("section-diagnostics-vendors", false);
          showSection("section-diagnostics-global", false);
          var issues = el("kuma-issues");
          if (issues) { issues.textContent = ""; }
          renderDiagnosticsError(payload);
          showSection("section-diagnostics-error", true);
          setStatus(t("common.updatedAt") + " " + new Date().toLocaleTimeString(dateLocale()));
          return;
        }

        showSection("section-diagnostics-error", false);
        renderVendorChecks(payload.vendors || [], payload.issueCount || 0);
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
