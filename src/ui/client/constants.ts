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

/** 无供应商时展示的提示文案。 */
export const NO_VENDOR_NOTICE = "未配置任何供应商，请编辑 .pi/xpi-kuma/config.yaml";

/** 可见页面的数据轮询间隔；新 usage 必须在 5 秒内反映到面板。 */
export const POLL_INTERVAL_MS = 5000;
