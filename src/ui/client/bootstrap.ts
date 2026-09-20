/**
 * 页内脚本的开场片段：初始化状态、读取凭据并立即从地址栏清除。
 *
 * 必须最先拼装：后续片段（请求、轮询、页面）都依赖这里声明的状态变量
 * （token / period / lastTrend / busy / timer）与 el / readToken / setStatus。
 */
import { ATLAS_FAMILY, FAMILY_KEY, THEME_KEY } from "./constants.ts";
import { LANGUAGE_KEY } from "./i18n.ts";

/**
 * 首帧前应用主题与家族偏好。
 *
 * 这段脚本必须放在 `<head>` 里、在任何可见内容之前**同步**执行：否则浏览器会先按
 * HTML 上的默认外观绘制一帧，再跳到用户偏好，出现可见闪烁。
 *
 * localStorage 在隐私模式或禁用存储时可能抛错，因此整体包在 try 里；取不到偏好
 * 就保持 HTML 的默认值（暗色 + 默认家族）。
 */
export function preferenceBootstrapScript(): string {
  return `(function () {
  try {
    var theme = localStorage.getItem("${THEME_KEY}");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    if (localStorage.getItem("${FAMILY_KEY}") === "${ATLAS_FAMILY}") {
      document.documentElement.setAttribute("data-family", "${ATLAS_FAMILY}");
    }
    // 语言只需要先定 <html lang>：正文由 body 末尾的双语片段按同一偏好替换
    var lang = localStorage.getItem("${LANGUAGE_KEY}");
    if (lang === "en" || lang === "zh") {
      document.documentElement.setAttribute("lang", lang === "en" ? "en" : "zh-CN");
    }
  } catch (error) {
    // 存储不可用时按默认外观继续，不阻断页面
  }
})();`;
}

export function bootstrapFragment(): string {
  return `
      var token = readToken();
      var period = DEFAULT_PERIOD;
      var lastTrend = [];
      var busy = false;
      var timer = null;

      function el(id) { return document.getElementById(id); }

      /** 读取凭据并立刻抹掉地址栏 fragment：不留在历史记录，也不进 Referer。 */
      function readToken() {
        var hash = window.location.hash || "";
        var value = hash.charAt(0) === "#" ? hash.slice(1) : hash;
        window.history.replaceState(null, "", window.location.pathname);
        return value;
      }

      function setStatus(message) {
        var stamp = el("kuma-updated");
        if (stamp) { stamp.textContent = message; }
      }

  `;
}
