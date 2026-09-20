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
       * 分区索引轨：点击滚动到目标区块，并把它标为当前项。
       *
       * 轨只在 Atlas 家族下可见（样式负责），但事件绑定对所有家族都做 —— 切换家族时
       * 不需要重建 DOM。
       */
      function wireRail() {
        var links = document.querySelectorAll("[data-rail-target]");
        Array.prototype.forEach.call(links, function (link) {
          link.addEventListener("click", function (event) {
            var id = link.getAttribute("data-rail-target");
            var target = id ? document.getElementById(id) : null;
            if (!target) { return; }
            event.preventDefault();
            target.scrollIntoView({ block: "start" });
            setRailCurrent(id);
          });
        });
      }

      /** 把当前区块写进轨的 aria-current，其余项清除。 */
      function setRailCurrent(id) {
        var links = document.querySelectorAll("[data-rail-target]");
        Array.prototype.forEach.call(links, function (link) {
          if (link.getAttribute("data-rail-target") === id) {
            link.setAttribute("aria-current", "location");
          } else {
            link.removeAttribute("aria-current");
          }
        });
      }
`;
}
