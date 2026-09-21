import {
  FONT_DEC_ID,
  FONT_DEFAULT_LEVEL,
  FONT_INC_ID,
  FONT_KEY,
  FONT_MAX_LEVEL,
  FONT_MIN_LEVEL,
  FONT_RESET_ID,
} from "./constants.ts";

/**
 * 字号档位片段：四个页面 header 共用的 `A−` / `A+` / `重置` 控件。
 *
 * 档位存在 localStorage（`kuma.font`），与主题、家族、语言偏好并列；首帧由
 * `bootstrap.ts` 的 head 脚本应用，避免正文闪一下再跳字号。
 *
 * 控件属于外壳级偏好，不依赖数据凭据，所以片段末尾直接自接通：页面片段在缺少凭据时
 * 提前返回，也不影响字号可调。真正的字号换算在 `dashboard-css.ts` 的
 * `--kuma-font-*`，这里只负责改 `data-font`。
 */
export function fontScaleFragment(): string {
  return `
      var FONT_KEY = "${FONT_KEY}";

      /** 当前档位：属性缺失或越界都回到默认档。 */
      function currentFontLevel() {
        var level = Math.round(Number(document.documentElement.getAttribute("data-font")));
        if (!isFinite(level) || level < ${FONT_MIN_LEVEL} || level > ${FONT_MAX_LEVEL}) {
          return ${FONT_DEFAULT_LEVEL};
        }
        return level;
      }

      /** 应用档位并持久化；存储不可用时只本次会话生效，不打断面板。 */
      function applyFontLevel(level) {
        var clamped = Math.min(${FONT_MAX_LEVEL}, Math.max(${FONT_MIN_LEVEL}, level));
        document.documentElement.setAttribute("data-font", String(clamped));
        try {
          localStorage.setItem(FONT_KEY, String(clamped));
        } catch (error) {
          // 写入失败不影响本次会话
        }
        syncFontButtons();
      }

      /** 到边界就禁用对应方向：让"已经到顶/到底"可见，而不是点了没反应。 */
      function syncFontButtons() {
        var level = currentFontLevel();
        var dec = el("${FONT_DEC_ID}");
        var inc = el("${FONT_INC_ID}");
        if (dec) { dec.disabled = level <= ${FONT_MIN_LEVEL}; }
        if (inc) { inc.disabled = level >= ${FONT_MAX_LEVEL}; }
      }

      /** 绑定三个按钮；页面外壳没有这套控件时安静跳过。 */
      function wireFontScale() {
        var dec = el("${FONT_DEC_ID}");
        var inc = el("${FONT_INC_ID}");
        var reset = el("${FONT_RESET_ID}");
        if (!dec || !inc || !reset) { return; }
        syncFontButtons();
        dec.addEventListener("click", function () { applyFontLevel(currentFontLevel() - 1); });
        inc.addEventListener("click", function () { applyFontLevel(currentFontLevel() + 1); });
        reset.addEventListener("click", function () { applyFontLevel(${FONT_DEFAULT_LEVEL}); });
      }

      wireFontScale();
  `;
}
