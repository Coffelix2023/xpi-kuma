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
        if (row.source === "api") { return "接口查询"; }
        if (row.source === "oauth") { return row.stale ? "OAuth 授权（旧值）" : "OAuth 授权"; }
        if (row.source === "manual") { return "手动填写"; }
        return "未知";
      }

      function currencyPrefix(currency) {
        if (currency === "USD") { return "$"; }
        if (currency === "CNY" || !currency) { return "¥"; }
        return currency + " ";
      }

      /** 余额文案：取不到值就是「未知」，绝不显示 ¥0.00。 */
      function amountText(value, currency) {
        if (typeof value !== "number" || !isFinite(value)) { return "未知"; }
        return currencyPrefix(currency) + value.toFixed(2);
      }

      function topupText(row) {
        if (typeof row.topup !== "number" || !isFinite(row.topup)) { return "未知"; }
        return currencyPrefix(row.currency) + row.topup.toFixed(2);
      }

      function syncText(row) {
        return row.syncedAt ? new Date(row.syncedAt).toLocaleString() : "从未";
      }

      /** 该行可做的下一步：授权过期的给「重新授权」，没有数字的给「授权」或「填写」。 */
      function actionLabel(row) {
        if (row.source === "oauth" && row.stale) { return "重新授权"; }
        if (typeof row.balance !== "number") {
          return row.error && row.error.indexOf("授权") !== -1 ? "授权" : "填写";
        }
        return "";
      }

      /** 不可信说明：多少是手工值、多少是过期旧值，一眼看清。 */
      function trustNote(overview) {
        var parts = [];
        if (overview.knownCount === 0) {
          parts.push("还没有取到任何余额数字");
        }
        if (overview.manualCount > 0) {
          parts.push(overview.manualCount + " 项为手动填写");
        }
        if (overview.staleCount > 0) {
          parts.push(overview.staleCount + " 项为授权过期后保留的旧值");
        }
        if (parts.length === 0) {
          parts.push("全部为自动获取的最新值");
        }
        parts.push("合计按各供应商上报币种原值累加，未做汇率换算");
        return parts.join("；") + "。";
      }

      function renderAccountsOverview(overview) {
        var host = el("kuma-accounts");
        if (!host) { return; }
        host.textContent = "";
        var box = document.createElement("dl");
        box.className = "kuma-overview";
        [
          ["累计充值", amountText(overview.topupTotal, "CNY")],
          ["当前余额", amountText(overview.balanceTotal, "CNY")]
        ].forEach(function (pair) {
          var card = document.createElement("div");
          card.className = "kuma-metric";
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
        btn.setAttribute("aria-label", label + "：" + row.vendor);
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
            notice.textContent = NO_VENDOR;
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
          headRow.appendChild(text("th", "", name));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        rows.forEach(function (row) {
          var tr = document.createElement("tr");
          tr.appendChild(text("td", "", row.vendor + " · " + row.model));
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
        setStatus("更新于 " + new Date().toLocaleTimeString());
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
        setStatus("连接失败（" + message + "），请重新执行 /xpi-kuma");
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
        var input = window.prompt("请输入 " + vendor + " 的当前余额（写回 .pi/xpi-kuma/config.yaml）");
        if (input === null) { return; }
        var value = Number(input);
        if (!isFinite(value)) { setStatus("余额必须是数字"); return; }
        api("/api/accounts/manual", "POST", { vendor: vendor, balance: value }).then(renderAccounts, showAccountError);
      }

      function wireAccountSync() {
        var btn = el("kuma-sync");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
          if (busy) { return; }
          busy = true;
          btn.disabled = true;
          btn.textContent = "同步中…";
          api("/api/accounts/sync", "POST").then(
            function (payload) {
              busy = false;
              btn.disabled = false;
              btn.textContent = "同步全部余额";
              renderAccounts(payload);
            },
            function (error) {
              busy = false;
              btn.disabled = false;
              btn.textContent = "同步全部余额";
              showAccountError(error);
            }
          );
        });
      }

      var ACCOUNT_COLUMNS = ["供应商 · 模型", "数据来源", "余额", "累计充值", "最近同步", "动作"];

      if (!token) {
        setStatus("缺少访问凭据，请重新执行 /xpi-kuma");
        return;
      }

      wireNav();
      wireAccountSync();
      document.addEventListener("visibilitychange", onVisibilityChange);
      startPolling();
      refresh();
  `;
}
