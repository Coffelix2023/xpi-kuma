import { preferenceBootstrapScript } from "./dashboard-client.ts";
import { dashboardCss } from "./dashboard-css.ts";
import { escapeHtml } from "./html.ts";

export interface PageShellOptions {
  /** 页面正文（`<body>` 内容，不含页内脚本） */
  body: string;
  /** CSP nonce；缺省时不输出 nonce 属性（离线快照或测试） */
  nonce?: string;
  /** 页内脚本；缺省时不输出脚本块（纯静态外壳） */
  script?: string;
  /** 页面标题，用于 `<title>` */
  title: string;
}

/** 页面生成器共用的选项：目前只有 CSP nonce。 */
export interface PageOptions {
  /** CSP nonce；缺省时不输出 nonce 属性（离线快照或测试） */
  nonce?: string;
}
/**
 * 面板页面的公共外壳。
 *
 * 四个页面共用同一套 head（元信息、样式表、首帧偏好脚本）与安全策略：所有页面都是
 * **纯静态结构，不含监控数据与访问凭据** —— 凭据在 URL fragment 里，首帧请求无法
 * 携带，数据一律由页内脚本另行请求。
 *
 * 主题与家族的 token 表由 `dashboardCss()` 输出，首帧偏好由 head 里的同步脚本应用，
 * 因此子页面不需要各自的主题按钮也能跟随主面板的偏好。
 */
export function pageShell(options: PageShellOptions): string {
  const nonce = options.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : "";
  const script = options.script
    ? `\n<script${nonce}>\n${options.script}\n</script>\n`
    : "";

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(options.title)}</title>
<style${nonce}>
${dashboardCss()}
</style>
<script${nonce}>
${preferenceBootstrapScript()}
</script>
</head>
<body>
${options.body}${script}</body>
</html>`;
}
