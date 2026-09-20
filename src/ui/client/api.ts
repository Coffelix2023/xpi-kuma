/**
 * 数据请求片段：带访问凭据的 fetch 封装。
 *
 * 所有面板数据接口都要求 Bearer 凭据；非 2xx 一律归一为带状态码的 Error，
 * 由 withBusy 统一转成状态文案，不让具体 HTTP 语义泄漏到渲染层。
 */
export function apiFragment(): string {
  return `
      function api(path, method) {
        return fetch(path, {
          method: method || "GET",
          headers: { "Authorization": "Bearer " + token },
        }).then(function (response) {
          if (!response.ok) { throw new Error("HTTP " + response.status); }
          return response.json();
        });
      }

      /** 读取 CSS 变量；缺失时回退到 muted，保证图表始终有颜色。 */
  `;
}
