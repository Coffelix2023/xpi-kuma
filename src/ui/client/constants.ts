/**
 * 面板页内脚本的共享常量。
 *
 * 这些值同时被多个脚本片段引用：拼装时经 `${...}` 插值进生成的 JS，因此独立成模块，
 * 避免页面装配层与片段层互相 import 造成循环依赖。
 */

import type { StatsPeriod } from "../../types.ts";

/** 面板默认时间范围；主面板脚本与子页脚本共用同一个默认值。 */
export const DEFAULT_PERIOD: StatsPeriod = "24h";

/** Atlas 家族标识；取值与 `theme.ts` 的 `ThemeFamily` 一致。 */
export const ATLAS_FAMILY = "atlas";

/** 主题与家族偏好的 localStorage 键；与 THEMES.md 约定的键名一致。 */
export const FAMILY_KEY = "kuma.family";
export const THEME_KEY = "kuma.theme";

/**
 * 访问凭据的标签页缓存键（sessionStorage）。
 *
 * 凭据读完立即从地址栏 fragment 抹掉，刷新后地址栏已无凭据；按标签页缓存一份兜底，
 * 标签页关闭即失效，且不写进 localStorage（不跨标签页长期留存）。
 */
export const TOKEN_KEY = "kuma.token";

/**
 * 面板字号档位偏好。
 *
 * 档位与 `dashboard-css.ts` 的 `data-font` 规则一一对应：每档只改 `--kuma-font-scale`，
 * 字号 token 由它派生，间距与圆角不参与缩放。档位 3 即 scale 1，不写 CSS 规则。
 */
export const FONT_KEY = "kuma.font";
export const FONT_MIN_LEVEL = 1;
export const FONT_MAX_LEVEL = 5;
export const FONT_DEFAULT_LEVEL = 3;

/** 字号档位控件的元素 id；HTML 外壳与页内脚本共用一份，避免拼错。 */
export const FONT_DEC_ID = "kuma-font-dec";
export const FONT_INC_ID = "kuma-font-inc";
export const FONT_RESET_ID = "kuma-font-reset";

/** 可见页面的数据轮询间隔；新 usage 必须在 5 秒内反映到面板。 */
export const POLL_INTERVAL_MS = 5000;
