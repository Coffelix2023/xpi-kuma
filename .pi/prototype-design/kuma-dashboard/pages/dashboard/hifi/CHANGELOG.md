# CHANGELOG — hifi

> 最新迭代在最上方，倒序排列。每轮产出后由 `prototype_snapshot` 追加一条。

<!-- ENTRIES -->

## 2026-09-16 08:53 · v5
- 变更：供应商健康块头新增「配置体检」入口（P1-1-B4）
- 原因：新增的只读体检页需要入口；与「账户详情」并列放在同一个块头。
- 文件：`current/screens/01-dashboard.html`
- 回滚到 v4：cp -R .pi/prototype-design/kuma-dashboard/dashboard/hifi/v4/. .pi/prototype-design/kuma-dashboard/dashboard/hifi/current/

## 2026-09-16 08:42 · v4
- 变更：修正印刷家族下标题带内控件的文字色（原用 --primary-foreground，暗色下与带底同色不可见）
- 原因：themes-01 的 .dark --primary 是橙色、--primary-foreground 是深藏青，压在藏青标题带上对比度约 1.1:1。
- 文件：`current/screens/01-dashboard.html`, `current/screens/02-empty.html`
- 回滚到 v3：cp -R .pi/prototype-design/kuma-dashboard/dashboard/hifi/v3/. .pi/prototype-design/kuma-dashboard/dashboard/hifi/current/

## 2026-09-16 08:41 · v3
- 变更：Atlas 家族换成 themes-01 复古印刷配色；新增方格纸底、藏青标题带、卡片强调线、右侧索引轨
- 原因：用户反馈 Atlas 亮色版缺蓝；按 themes-01 的复古印刷风重做，并对齐参考截图。
- 文件：`current/screens/01-dashboard.html`, `current/screens/02-empty.html`
- 回滚到 v2：cp -R .pi/prototype-design/kuma-dashboard/dashboard/hifi/v2/. .pi/prototype-design/kuma-dashboard/dashboard/hifi/current/

## 2026-09-16 08:23 · v2
- 变更：THEMES.md 新增 Atlas-Themes 家族；三页接入家族切换（data-family 隔离 + 页内按钮 + 持久化）
- 原因：Atlas 与 Default 同名变量值不同（--accent/--radius），必须隔离；Atlas 的 0 圆角与低对比 accent 已在页面侧兜住。
- 文件：`current/screens/01-dashboard.html`, `current/screens/02-empty.html`
- 回滚到 v1：cp -R .pi/prototype-design/kuma-dashboard/dashboard/hifi/v1/. .pi/prototype-design/kuma-dashboard/dashboard/hifi/current/

## 2026-09-16 08:05 · v1
- 变更：首版高保真：主面板与空态；内联 SVG 趋势图、主题与语言切换、状态指示灯上色
- 原因：线框 v2 已确认，进入视觉落地；Chart.js CDN 换内联 SVG 以满足 hifi 零外部请求硬规则。
- 文件：`current/screens/01-dashboard.html`, `current/screens/02-empty.html`
