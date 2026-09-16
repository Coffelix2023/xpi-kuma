/** Token 与费用的展示格式化，footer 状态栏与面板共用。 */

/**
 * 把 token 数格式化为紧凑字符串。
 *
 * 999 → "999"、1234 → "1.2K"、1234567 → "1.2M"
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "-";
  }
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * 把费用格式化为 `¥` 前缀、两位小数的字符串。
 *
 * 非数值输入返回 "-"，让 footer 能降级显示而不抛错。
 */
export function formatCost(n: number): string {
  if (!Number.isFinite(n)) {
    return "-";
  }
  return `¥${n.toFixed(2)}`;
}

/** footer 状态文本：`💰 ¥0.05 | 📊 1.2K` */
export function formatStatus(totals: {
  totalCost: number;
  totalTokens: number;
}): string {
  return `${formatCostBadge(totals.totalCost)} | ${formatTokensBadge(totals.totalTokens)}`;
}

function formatCostBadge(totalCost: number): string {
  const value = formatCost(totalCost);
  return `💰 ${value === "-" ? "-" : value}`;
}

function formatTokensBadge(totalTokens: number): string {
  return `📊 ${formatTokens(totalTokens)}`;
}
