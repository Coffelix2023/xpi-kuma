import { MESSAGES } from "./messages.ts";

/** 语言偏好的 localStorage 键；与主题、家族偏好并列。 */
export const LANGUAGE_KEY = "kuma.lang";

/**
 * 双语片段：字典注入、取词、应用与切换。
 *
 * 必须排在任何页面片段之前（页面片段的 `wireLanguage()` 依赖这里的函数），且排在
 * bootstrap 之后（用到 `el` 与 `document.documentElement`）。
 *
 * 首帧策略：HTML 由服务端按中文渲染并写 `data-i18n`，本片段在 body 末尾同步执行，
 * 立刻按已保存偏好替换文本与 `aria-label`，同一帧内完成，看不到中文闪现。
 */
export function i18nFragment(): string {
  return `
      var LANG_KEY = "${LANGUAGE_KEY}";
      var MESSAGES = ${JSON.stringify(MESSAGES)};

      /** 本次会话生效的语言；null 表示还没定过，首帧从存储读。 */
      var activeLanguage = null;

      /**
       * 当前界面语言。
       *
       * 内存优先于 localStorage：切换后即使存储写不进去（隐私模式），本次会话也已生效，
       * 且取词函数立刻按新语言返回。
       */
      function currentLanguage() {
        if (activeLanguage !== null) { return activeLanguage; }
        try {
          activeLanguage = localStorage.getItem(LANG_KEY) === "en" ? "en" : "zh";
        } catch (error) {
          activeLanguage = "zh";
        }
        return activeLanguage;
      }

      /** 取词条；缺词条时回落到键名，便于定位漏配。 */
      function t(key) {
        var entry = MESSAGES[key];
        if (!entry) { return key; }
        var value = currentLanguage() === "en" ? entry.en : entry.zh;
        return typeof value === "string" ? value : entry.zh;
      }

      /**
       * 应用语言：正文、aria-label 与 <html lang> 一起更新，并持久化偏好。
       *
       * 只替换 [data-i18n] 元素的文本内容 —— 这些元素在模板里都是纯文本叶子节点，
       * 带内嵌子节点的容器不写该属性（见 messages.ts 的约定）。
       */
      function applyLanguage(lang) {
        activeLanguage = lang === "en" ? "en" : "zh";
        document.documentElement.setAttribute("lang", activeLanguage === "en" ? "en" : "zh-CN");
        var texts = document.querySelectorAll("[data-i18n]");
        Array.prototype.forEach.call(texts, function (node) {
          node.textContent = t(node.getAttribute("data-i18n"));
        });
        var labelled = document.querySelectorAll("[data-i18n-aria]");
        Array.prototype.forEach.call(labelled, function (node) {
          node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria")));
        });
        try {
          localStorage.setItem(LANG_KEY, activeLanguage);
        } catch (error) {
          // 写入失败不影响本次会话
        }
        syncLanguageButton();
      }

      /** 按钮文案是"切过去的那门语言"，所以不写 data-i18n，由这里动态给。 */
      function syncLanguageButton() {
        var btn = el("kuma-lang");
        if (!btn) { return; }
        btn.textContent = currentLanguage() === "en" ? t("lang.toChinese") : t("lang.toEnglish");
        btn.setAttribute("aria-label", t("lang.ariaSwitch"));
      }

      /** 语言按钮：切完重新拉一次数据，让脚本生成的文本也换语言。 */
      function wireLanguage() {
        var btn = el("kuma-lang");
        if (!btn) { return; }
        syncLanguageButton();
        btn.addEventListener("click", function () {
          applyLanguage(currentLanguage() === "en" ? "zh" : "en");
          refresh();
        });
      }

      applyLanguage(currentLanguage());
  `;
}
