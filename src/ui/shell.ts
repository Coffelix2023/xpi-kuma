import { FONT_DEC_ID, FONT_INC_ID, FONT_RESET_ID } from "./client/constants.ts";
import { i18nAria, i18nAttr, type MessageKey, zh } from "./client/messages.ts";
import { preferenceBootstrapScript } from "./dashboard-client.ts";
import { dashboardCss } from "./dashboard-css.ts";
import { escapeHtml } from "./html.ts";
import { semanticBadgeScript } from "./semantic-badge.ts";

export interface PageShellOptions {
  /** 页面正文（`<body>` 内容，不含页内脚本） */
  body: string;
  /** CSP nonce；缺省时不输出 nonce 属性（离线快照或测试） */
  nonce?: string;
  /** 页内脚本；缺省时不输出脚本块（纯静态外壳） */
  script?: string;
  /** 页面标题的词条键；`<title>` 随语言切换，标签页不留另一种语言 */
  titleKey: MessageKey;
}

/** 页面生成器共用的选项：目前只有 CSP nonce。 */
export interface PageOptions {
  /** CSP nonce；缺省时不输出 nonce 属性（离线快照或测试） */
  nonce?: string;
}

/**
 * 面板字号档位控件：`A−` / `A+` / `重置`，四个页面的 header 共用同一份结构。
 *
 * 可见文案与 aria-label 都带 `data-i18n` 键，语言切换自动跟随。点击后由页内脚本改
 * `<html data-font>`（见 `client/font.ts`），档位存 localStorage，跨页面与刷新都生效。
 * `data-preference` 标记让面板的数据刷新不去改这些按钮的可用状态 ——
 * 它们的禁用状态由当前档位决定。
 */
export function fontControlsHtml(): string {
  return `      <span class="kuma-actions" role="group"${i18nAria("font.group")}>
        <button type="button" id="${FONT_DEC_ID}" data-preference${i18nAria("font.smaller")}>A−</button>
        <button type="button" id="${FONT_INC_ID}" data-preference${i18nAria("font.larger")}>A+</button>
        <button type="button" id="${FONT_RESET_ID}" data-preference${i18nAttr("font.reset")}>${zh("font.reset")}</button>
      </span>`;
}

/**
 * 面板页面的公共外壳。
 *
 * 四个页面共用同一套 head（元信息、样式表、首帧偏好脚本）与安全策略：所有页面都是
 * **纯静态结构，不含监控数据与访问凭据** —— 凭据在 URL fragment 里，首帧请求无法
 * 携带，数据一律由页内脚本另行请求。
 *
 * 首帧默认外观是**图鉴家族 · 亮色**（`data-family="atlas"` + `data-theme="light"`），即无
 * 偏好时的兜底；head 里的同步脚本会用已保存的偏好覆盖它。主题与家族的 token 表由
 * `dashboardCss()` 输出，因此子页面不需要各自的主题按钮也能跟随主面板的偏好。
 */
export function pageShell(options: PageShellOptions): string {
  const nonce = options.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : "";
  const script = options.script
    ? `\n<script${nonce}>\n${options.script}\n</script>\n`
    : "";
  // 语义徽标调试层：脚本自带 ?semantic=1 门槛，无参数时零行为
  const badge = `\n<script${nonce}>\n${semanticBadgeScript()}\n</script>\n`;

  return `<!doctype html>
<html lang="zh-CN" data-family="atlas" data-theme="light" data-title-key="${options.titleKey}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(zh(options.titleKey))}</title>
<style${nonce}>
${dashboardCss()}
</style>
<script${nonce}>
${preferenceBootstrapScript()}
</script>
</head>
<body>
${options.body}${script}${badge}</body>
</html>`;
}
