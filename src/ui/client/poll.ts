/**
 * 轮询片段：5 秒间隔、页面隐藏暂停、恢复可见立即刷新再恢复轮询。
 *
 * in-flight 去重由页面片段的 withBusy 承担（busy 置位后重复触发被丢弃，
 * 既不排队也不重试），这里只负责定时器与可见性。
 */
export function pollFragment(): string {
  return `
      function stopPolling() {
        if (timer === null) { return; }
        window.clearInterval(timer);
        timer = null;
      }

      function startPolling() {
        if (timer !== null) { return; }
        timer = window.setInterval(function () {
          if (document.hidden) { return; }
          refresh();
        }, POLL_MS);
      }

      function onVisibilityChange() {
        if (document.hidden) { stopPolling(); return; }
        // 恢复可见时先立即刷新一次，再恢复轮询
        refresh();
        startPolling();
      }

  `;
}
