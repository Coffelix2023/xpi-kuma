/**
 * 排行片段：provider/model 费用与项目费用两张小表。
 *
 * 数据来自同一次 `/api/dashboard` 响应（`stats` 与项目维度归因），因此两张表与总览、
 * 统计共用同一时间范围与同一份总花费；占比直接用 API 算好的 `costShare`，不在页面
 * 侧再聚一次，避免两处口径漂移。
 *
 * 首屏只展示前 N 行，其余组合折叠成一行汇总；分组键为空串的项目是存量记录缺 cwd 的
 * 兜底分组，显示「未知」而不是空字符串。
 */
export function rankingFragment(): string {
  return `
      /** 首屏展示的排行行数；其余折叠成一行汇总。 */
      var RANK_TOP = 5;

      /** 占比：总花费为 0 时 API 给 null，显示「未知」而不是 0%。 */
      function shareText(value) {
        if (typeof value !== "number" || !isFinite(value)) { return t("common.unknown"); }
        return percent(value);
      }

      /** 汇总行：前 N 行之外的组合相加，占比相加即为其合计占比。 */
      function foldRank(rows) {
        var visible = rows.slice(0, RANK_TOP);
        var rest = rows.slice(RANK_TOP);
        if (rest.length === 0) { return visible; }
        var costTotal = 0;
        var costShare = 0;
        rest.forEach(function (r) {
          costTotal += r.costTotal || 0;
          if (typeof r.costShare === "number") { costShare += r.costShare; }
        });
        visible.push({
          costShare: costShare,
          costTotal: costTotal,
          key: t("stats.otherPrefix") + rest.length + t("stats.otherSuffix")
        });
        return visible;
      }

      /** provider/model 费用排行。 */
      function renderModelRank(stats) {
        var host = el("kuma-rank-model");
        if (!host) { return; }
        host.textContent = "";
        host.appendChild(text("h3", "kuma-rank-title", t("overview.rankModel")));
        if (stats.length === 0) {
          host.appendChild(mutedLine(t("common.noData")));
          return;
        }
        var rows = foldRank(stats).map(function (r) {
          var name = r.key ? r.key : r.provider + " · " + r.model;
          return [
            name,
            money(r.costTotal),
            shareText(r.costShare)
          ];
        });
        host.appendChild(dataTable([
          ["rank.combination", false],
          ["rank.cost", true],
          ["stats.shareCost", true]
        ], rows));
      }

      /** 项目费用排行；未知分组显示「未知」。 */
      function renderProjectRank(rows) {
        var host = el("kuma-rank-project");
        if (!host) { return; }
        host.textContent = "";
        host.appendChild(text("h3", "kuma-rank-title", t("overview.rankProject")));
        if (rows.length === 0) {
          host.appendChild(mutedLine(t("common.noData")));
          return;
        }
        var cells = foldRank(rows).map(function (r) {
          return [
            r.key === "" ? t("common.unknown") : r.key,
            money(r.costTotal),
            shareText(r.costShare)
          ];
        });
        host.appendChild(dataTable([
          ["rank.project", false],
          ["rank.cost", true],
          ["stats.shareCost", true]
        ], cells));
      }
  `;
}
