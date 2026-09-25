/**
 * 供应商账户页片段：概览、明细表与同步/授权/填写动作。
 *
 * 依赖前序片段提供 token / api / setStatus / text / money / wireNav；
 * 数据只来自 `/api/accounts`，与主面板共用一套凭据与轮询。
 */
export function accountsPageFragment(): string {
  return `
      /** 数据来源标记；授权过期时连同「旧值」一起标出来。 */
      function sourceLabel(row) {
        if (row.source === "api") { return t("source.api"); }
        if (row.source === "oauth") { return row.stale ? t("source.oauthStale") : t("source.oauth"); }
        if (row.source === "manual") { return t("source.manual"); }
        return t("common.unknown");
      }

      function currencyPrefix(currency) {
        if (currency === "USD") { return "$"; }
        if (currency === "CNY" || !currency) { return "¥"; }
        return currency + " ";
      }

      /** 余额文案：取不到值就是「未知」，绝不显示 ¥0.00。 */
      function amountText(value, currency) {
        if (typeof value !== "number" || !isFinite(value)) { return t("common.unknown"); }
        return currencyPrefix(currency) + group(value, 2);
      }

      function topupText(row) {
        if (typeof row.topup !== "number" || !isFinite(row.topup)) { return t("common.unknown"); }
        return currencyPrefix(row.currency) + group(row.topup, 2);
      }

      function syncText(row) {
        return row.syncedAt
          ? new Date(row.syncedAt).toLocaleString(dateLocale())
          : t("common.never");
      }

      /** 该行可做的下一步：授权过期的给「重新授权」，没有数字的给「授权」或「填写」。 */
      function actionLabel(row) {
        if (row.source === "oauth" && row.stale) { return t("action.reauthorize"); }
        if (typeof row.balance !== "number") {
          return row.error && row.error.indexOf("授权") !== -1 ? t("action.authorize") : t("action.fill");
        }
        return "";
      }

      /** 不可信说明：多少是手工值、多少是过期旧值，一眼看清。 */
      function trustNote(overview) {
        var parts = [];
        if (overview.knownCount === 0) {
          parts.push(t("accounts.trustNoNumbers"));
        }
        if (overview.manualCount > 0) {
          parts.push(count(overview.manualCount) + t("accounts.trustManualSuffix"));
        }
        if (overview.staleCount > 0) {
          parts.push(count(overview.staleCount) + t("accounts.trustStaleSuffix"));
        }
        if (parts.length === 0) {
          parts.push(t("accounts.trustAllFresh"));
        }
        parts.push(t("accounts.trustFx"));
        return parts.join(t("common.separator")) + t("common.sentenceEnd");
      }

      function renderAccountsOverview(overview) {
        var host = el("kuma-accounts");
        if (!host) { return; }
        host.textContent = "";
        var box = document.createElement("dl");
        box.className = "kuma-overview";
        [
// data-semantic-id="accounts.summary.topup"
// data-semantic-id="accounts.summary.balance"
[t("accounts.topupTotal"), amountText(overview.topupTotal, "CNY"), "accounts.summary.topup"],
[t("accounts.balanceTotal"), amountText(overview.balanceTotal, "CNY"), "accounts.summary.balance"]
        ].forEach(function (pair) {
          var card = document.createElement("div");
          card.className = "kuma-metric";
          if (pair[2]) { card.setAttribute("data-semantic-id", pair[2]); }
          card.appendChild(text("dt", "", pair[0]));
          card.appendChild(text("dd", "", pair[1]));
          box.appendChild(card);
        });
        host.appendChild(box);
        var note = text("p", "kuma-generated", trustNote(overview));
        host.appendChild(note);
      }

      function buildActionCell(row) {
        var cell = document.createElement("td");
        var label = actionLabel(row);
        if (!label) { return cell; }
        var btn = text("button", "", label);
        btn.type = "button";
// data-semantic-id="accounts.list.grant" / data-semantic-id="accounts.list.manual"
btn.setAttribute("data-semantic-id", label === "填写" ? "accounts.list.manual" : "accounts.list.grant");
        btn.setAttribute("aria-label", label + t("common.colon") + row.vendor);
        btn.addEventListener("click", function () {
          if (label === "填写") { fillManual(row.vendor); return; }
          authorizeVendor(row.vendor, btn);
        });
        cell.appendChild(btn);
        return cell;
      }

      function renderAccountRows(rows) {
        var host = el("kuma-account-rows");
        if (!host) { return; }
        host.textContent = "";
        var notice = el("kuma-accounts-notice");

        if (rows.length === 0) {
          // 未配置任何供应商：不渲染明细表，直接给出可操作提示
          if (notice) {
            notice.className = "kuma-empty";
            notice.textContent = t("vendor.noVendor");
            notice.hidden = false;
          }
          return;
        }
        if (notice) {
          notice.hidden = true;
          notice.textContent = "";
        }

        var box = document.createElement("div");
        box.className = "kuma-scroll";
        var table = document.createElement("table");
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        ACCOUNT_COLUMNS.forEach(function (name) {
            headRow.appendChild(text("th", "", t(name)));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        rows.forEach(function (row) {
          var tr = document.createElement("tr");
          tr.appendChild(text("td", "", row.vendor + " · " + (row.models || []).join(t("common.separator"))));
          tr.appendChild(text("td", "kuma-source", sourceLabel(row)));
          tr.appendChild(text("td", typeof row.balance === "number" ? "kuma-total" : "", amountText(row.balance, row.currency)));
          tr.appendChild(text("td", "", topupText(row)));
          tr.appendChild(text("td", "", syncText(row)));
          tr.appendChild(buildActionCell(row));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        box.appendChild(table);
        host.appendChild(box);
      }

      function renderAccounts(payload) {
        var overview = payload.overview || {};
        renderAccountsOverview(overview);
        renderAccountRows(payload.rows || []);
        setStatus(t("common.updatedAt") + " " + new Date().toLocaleTimeString(dateLocale()));
      }

      function loadAccounts() {
        return api("/api/accounts").then(renderAccounts);
      }

      /** 轮询与主面板同一套可见性逻辑：这里只把「刷新」指向账户数据。 */
      function refresh() {
        return loadAccounts().then(
          function () { return true; },
          function (error) { showAccountError(error); return false; }
        );
      }

      function showAccountError(error) {
        var message = error && error.message ? error.message : String(error);
        setStatus(failureStatus(message));
      }

      function authorizeVendor(vendor, btn) {
        btn.disabled = true;
        api("/api/accounts/authorize", "POST", { vendor: vendor }).then(
          function (result) {
            btn.disabled = false;
            if (result && result.url) { window.open(result.url, "_blank"); }
          },
          function (error) { btn.disabled = false; showAccountError(error); }
        );
      }

      function fillManual(vendor) {
        var input = window.prompt(t("accounts.promptPrefix") + vendor + t("accounts.promptSuffix"));
        if (input === null) { return; }
        var value = Number(input);
        if (!isFinite(value)) { setStatus(t("common.notANumber")); return; }
        api("/api/accounts/manual", "POST", { vendor: vendor, balance: value }).then(renderAccounts, showAccountError);
      }

      function wireAccountSync() {
        var btn = el("kuma-sync");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
          if (busy) { return; }
          busy = true;
          btn.disabled = true;
          btn.textContent = t("page.accounts.syncing");
          api("/api/accounts/sync", "POST").then(
            function (payload) {
              busy = false;
              btn.disabled = false;
              btn.textContent = t("page.accounts.syncAll");
              renderAccounts(payload);
            },
            function (error) {
              busy = false;
              btn.disabled = false;
              btn.textContent = t("page.accounts.syncAll");
              showAccountError(error);
            }
          );
        });
      }

      /** 明细表列：词条键 + 取值函数；表头经 t() 取词。 */
      var ACCOUNT_COLUMNS = [
        "accounts.col.vendorModel",
        "accounts.col.source",
        "accounts.col.balance",
        "accounts.col.topup",
        "accounts.col.syncedAt",
        "accounts.col.action"
      ];

      if (!token) {
        setStatus(t("common.missingToken"));
        return;
      }

      wireNav();
      wireLanguage();
      wireAccountSync();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
  `;
}
