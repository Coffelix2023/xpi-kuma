/**
 * HTML 生成辅助：DESIGN.md 要求所有动态插值必须转义后再进入原生窗口模板。
 */

/** 转义插入到 HTML 文本或属性中的动态字符串。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 把数据序列化成可安全内联到 `<script type="application/json">` 的 JSON。
 *
 * `<` 被转为 `\u003c`，避免数据中的 `</script>` 提前关闭脚本块。
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * 把数据序列化成可安全内联到 `<script>` 语句中的 JSON 字面量。
 *
 * 同时处理 U+2028/U+2029：它们在旧解析器里会被当成换行而截断语句。
 */
export function jsLiteral(value: unknown): string {
  return jsonForScript(value);
}

/** 状态图标；未知状态用空心圆，避免与 down 混淆。 */
export function statusIcon(status: string): string {
  if (status === "up") {
    return "🟢";
  }
  if (status === "down" || status === "degraded") {
    return "🔴";
  }
  return "⚪";
}
