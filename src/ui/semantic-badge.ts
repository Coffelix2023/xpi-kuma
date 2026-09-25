import { SEMANTIC_BADGES } from "./client/semantic-map.ts";

/**
 * 语义徽标调试层：`?semantic=1` 打开后，页面上每个带 `data-semantic-id` 的元素
 * 显示「短码 + 中文标签」徽标；悬浮开关默认页面顶部居中、可拖拽，
 * 位置存 localStorage，开关状态存 sessionStorage（站内跳页不丢）。
 *
 * 仅调试用途：普通访问（无参数）零注入、零样式、零行为。
 */
export function semanticBadgeScript(): string {
  return `(function () {
  var KEY_STATE = "kuma.semantic";
  var KEY_POS = "kuma.semanticPos";
  var MAP = ${JSON.stringify(SEMANTIC_BADGES)};
  var params = new URLSearchParams(window.location.search);
  var active = params.get("semantic") === "1" || window.sessionStorage.getItem(KEY_STATE) === "1";
  if (!active) { return; }
  try { window.sessionStorage.setItem(KEY_STATE, "1"); } catch (e) { /* 忽略 */ }

  // 注入的 <style> 不带 nonce 会被 CSP 的 style-src 整个拦掉，徽标样式全部失效
  var NONCE = (function () {
    var current = document.currentScript;
    if (current && current.nonce) { return current.nonce; }
    var scripts = document.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].nonce) { return scripts[i].nonce; }
    }
    return "";
  })();
  var style = document.createElement("style");
  if (NONCE) { style.setAttribute("nonce", NONCE); }
  style.textContent = [
    "html[data-semantic-on] [data-semantic-badge] { position: relative; outline: 1px dashed var(--muted-foreground); outline-offset: 1px; }",
    "html[data-semantic-on] [data-semantic-badge]::after {",
    "  content: attr(data-semantic-badge);",
    "  position: absolute; left: 0; top: 0; transform: translateY(-100%);",
    "  background: var(--foreground); color: var(--background);",
    "  font-size: var(--kuma-font-sm); line-height: 1.4; white-space: nowrap;",
    "  padding: 0 var(--kuma-space-1); border-radius: 3px; pointer-events: none; z-index: 99999;",
    "}",
    "#kuma-semantic-toggle { position: fixed; z-index: 100000; top: 8px; left: 50%; transform: translateX(-50%);",
    "  background: var(--background); color: var(--foreground); border: 1px solid var(--border);",
    "  border-radius: 999px; padding: 2px var(--kuma-space-2); font-size: var(--kuma-font-sm);",
    "  cursor: grab; user-select: none; touch-action: none; box-shadow: 0 1px 4px rgba(0,0,0,.2); }",
    "#kuma-semantic-toggle[aria-pressed=\\"true\\"] { background: var(--foreground); color: var(--background); }"
  ].join("\\n");
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.type = "button";
  btn.id = "kuma-semantic-toggle";
  btn.setAttribute("aria-pressed", "false");
  btn.textContent = "语义标签";
  document.body.appendChild(btn);

  var saved = null;
  try { saved = JSON.parse(window.localStorage.getItem(KEY_POS) || "null"); } catch (e) { /* 忽略 */ }
  if (saved && isFinite(saved.x) && isFinite(saved.y)) {
    btn.style.left = saved.x + "px";
    btn.style.top = saved.y + "px";
    btn.style.transform = "none";
  }

  var on = false;
  function apply() {
    var nodes = document.querySelectorAll("[data-semantic-id]");
    Array.prototype.forEach.call(nodes, function (node) {
      var id = node.getAttribute("data-semantic-id");
      var entry = MAP[id];
      if (!entry) { return; }
      node.setAttribute("data-semantic-badge", entry.short + " " + entry.label);
    });
  }
  function clear() {
    var nodes = document.querySelectorAll("[data-semantic-badge]");
    Array.prototype.forEach.call(nodes, function (node) {
      node.removeAttribute("data-semantic-badge");
    });
  }
  function setOn(next) {
    on = next;
    btn.setAttribute("aria-pressed", String(on));
    if (on) {
      document.documentElement.setAttribute("data-semantic-on", "1");
      apply();
    } else {
      document.documentElement.removeAttribute("data-semantic-on");
      clear();
    }
  }

  // 页内脚本轮询会重建动态区块，重渲染后徽标跟着补回去
  var pending = 0;
  var observer = new MutationObserver(function () {
    if (!on || pending) { return; }
    pending = window.requestAnimationFrame(function () { pending = 0; apply(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 拖拽：pointer 事件 + 4px 阈值区分点击与拖动；位置存 localStorage
  var dragging = null;
  btn.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) { return; }
    var rect = btn.getBoundingClientRect();
    dragging = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false };
    btn.setPointerCapture(event.pointerId);
    btn.style.cursor = "grabbing";
  });
  btn.addEventListener("pointermove", function (event) {
    if (!dragging) { return; }
    var x = event.clientX - dragging.dx;
    var y = event.clientY - dragging.dy;
    if (!dragging.moved && Math.abs(x - btn.offsetLeft) < 4 && Math.abs(y - btn.offsetTop) < 4) { return; }
    dragging.moved = true;
    var maxX = window.innerWidth - btn.offsetWidth;
    var maxY = window.innerHeight - btn.offsetHeight;
    btn.style.left = Math.min(Math.max(0, x), maxX) + "px";
    btn.style.top = Math.min(Math.max(0, y), maxY) + "px";
    btn.style.transform = "none";
  });
  btn.addEventListener("pointerup", function (event) {
    if (!dragging) { return; }
    btn.style.cursor = "grab";
    btn.releasePointerCapture(event.pointerId);
    if (dragging.moved) {
      try {
        window.localStorage.setItem(KEY_POS, JSON.stringify({ x: btn.offsetLeft, y: btn.offsetTop }));
      } catch (e) { /* 忽略 */ }
    } else {
      setOn(!on);
    }
    dragging = null;
  });

  setOn(true);
})();
`;
}
