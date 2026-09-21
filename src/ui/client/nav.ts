/**
 * 站内导航片段：给页面里的站内链接补上凭据 fragment。
 *
 * 页面外壳是静态的，服务端在生成外壳时并不知道本次询问的凭据，因此链接的 `href`
 * 由页内脚本在拿到 token 后补全成 `<path>#<token>`。
 *
 * 用 fragment 而不是查询串：fragment 不会进入 HTTP 请求、访问日志，也不会出现在
 * 第三方资源的 Referer 里 —— 见 `dashboard-ui` spec 的「浏览器地址不泄露密钥」。
 */
export function navFragment(): string {
  return `
      /** 给所有 [data-kuma-nav] 链接补上本次服务的凭据 fragment。 */
      function wireNav() {
        var links = document.querySelectorAll("[data-kuma-nav]");
        Array.prototype.forEach.call(links, function (link) {
          var target = link.getAttribute("data-kuma-nav");
          if (!target || !token) { return; }
          link.setAttribute("href", target + "#" + token);
        });
      }

      /**
       * 标签页：点击或方向键切换面板，一次只显示一个。
       *
       * 面板全部预先渲染，切换只改 hidden 属性，因此不触发重新请求、也不重建 DOM。
       * 键盘交互按 WAI-ARIA Tabs 模式：只有当前标签在 tab 序里（roving tabindex），
       * 左右键循环，Home / End 跳首尾。没有标签的页面（子页）安静跳过。
       */
      function wireTabs() {
        var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
        if (tabs.length === 0) { return; }
        tabs.forEach(function (tab, index) {
          tab.addEventListener("click", function () { selectTab(tab, tabs); });
          tab.addEventListener("keydown", function (event) {
            var key = event.key;
            var next = null;
            if (key === "ArrowRight") { next = tabs[(index + 1) % tabs.length]; }
            if (key === "ArrowLeft") { next = tabs[(index - 1 + tabs.length) % tabs.length]; }
            if (key === "Home") { next = tabs[0]; }
            if (key === "End") { next = tabs[tabs.length - 1]; }
            if (!next) { return; }
            event.preventDefault();
            selectTab(next, tabs);
            next.focus();
          });
        });
      }

      /** 选中一个标签：同步 roving tabindex、aria-selected 与各面板的 hidden。 */
      function selectTab(tab, tabs) {
        tabs.forEach(function (item) {
          var selected = item === tab;
          item.setAttribute("aria-selected", String(selected));
          item.setAttribute("tabindex", selected ? "0" : "-1");
        });
        var panels = document.querySelectorAll("[data-tab-panel]");
        Array.prototype.forEach.call(panels, function (panel) {
          panel.hidden = panel.getAttribute("data-tab-panel") !== tab.getAttribute("data-tab");
        });
      }
`;
}
