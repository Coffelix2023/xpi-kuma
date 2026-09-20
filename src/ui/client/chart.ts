/**
 * 图表片段：内联 SVG 折线图（含悬停详情）。
 *
 * 颜色取自主题 token，主题或家族切换后由页面片段触发重建。
 */
export function chartFragment(): string {
  return `
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
        svg.appendChild(svgNode("title", {}, t("chart.svgTitle")));
        svg.appendChild(svgNode("desc", {}, t("chart.desc")));

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
        for (var tick = 0; tick < ticks; tick += 1) {
          var index = ticks === 1 ? 0 : Math.round((tick * (trend.length - 1)) / (ticks - 1));
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
        parts.push(t("attribution.tokens") + " " + (point.tokens || 0));
        return parts.join(" · ");
      }

  `;
}
