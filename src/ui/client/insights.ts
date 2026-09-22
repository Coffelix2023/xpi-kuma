/**
 * 洞察与效率片段。
 *
 * 两种数据态都按文字区分，不靠颜色：洞察不可用（`insights === null`，即服务端效率或
 * 洞察计算失败）、暂无建议（空数组）、暂无真实效率数据（效率排行为空）、样本不足
 * （`sufficient === false`，行内标注）、真实结果。
 *
 * 卡片只渲染服务端给的结论与依据，不提供任何按钮：建议是解释层，不触发配置写入、
 * 模型切换或探测请求。
 */
export function insightsFragment(): string {
  return `
      /** 建议卡片：结论在上，其下依次是依据、样本数、时间范围、置信度。 */
      function renderInsights(insights) {
        var host = el("kuma-insights");
        if (!host) { return; }
        host.textContent = "";
        if (insights === null || insights === undefined) {
          host.appendChild(mutedLine(t("insight.unavailable")));
          return;
        }
        if (insights.length === 0) {
          host.appendChild(mutedLine(t("insight.empty")));
          return;
        }
        var list = document.createElement("div");
        list.className = "kuma-insight-list";
        insights.forEach(function (insight) {
          var card = document.createElement("article");
          card.className = "kuma-insight-card";
          card.appendChild(text(
            "p",
            "kuma-insight-conclusion",
            t("insight.dimension." + insight.dimension) + t("common.colon") + insight.statement
          ));
          var meta = document.createElement("dl");
          meta.className = "kuma-insight-meta";
          [
            [t("insight.evidence"), insight.evidence],
            [t("insight.sample"), count(insight.sampleSize)],
            [t("insight.period"), periodLabel(insight.period)],
            [t("insight.confidenceLabel"), t("insight.confidence." + insight.confidence)]
          ].forEach(function (pair) {
            meta.appendChild(text("dt", "", pair[0]));
            meta.appendChild(text("dd", "", pair[1]));
          });
          card.appendChild(meta);
          list.appendChild(card);
        });
        host.appendChild(list);
      }

      /**
       * 效率排行：只展示真实调用时间点聚合出来的结果。
       *
       * 未达样本门槛的组合照样列出（用户能看到它的存在与样本数），但在样本列后写明
       * 「样本不足」；p50/p95 为 null 时显示破折号，不使用 probe 或估算值替代。
       */
      function renderEfficiencyRank(efficiency, insights) {
        var host = el("kuma-rank-efficiency");
        if (!host) { return; }
        host.textContent = "";
        host.appendChild(text("h3", "kuma-rank-title", t("overview.rankEfficiency")));
        if (insights === null || insights === undefined) {
          host.appendChild(mutedLine(t("insight.unavailable")));
          return;
        }
        if (efficiency.length === 0) {
          host.appendChild(mutedLine(t("efficiency.noData")));
          return;
        }
        var rows = efficiency.map(function (row) {
          var samples = count(row.sampleSize);
          if (!row.sufficient) { samples += t("common.separator") + t("efficiency.insufficient"); }
          return [
            row.provider + " · " + row.model,
            ms(row.p50TotalMs),
            ms(row.p95TtftMs),
            samples,
            percent(row.successRate)
          ];
        });
        host.appendChild(dataTable([
          ["rank.combination", false],
          ["efficiency.p50Total", true],
          ["efficiency.p95Ttft", true],
          ["efficiency.samples", true],
          ["efficiency.successRate", true]
        ], rows));
      }
  `;
}
