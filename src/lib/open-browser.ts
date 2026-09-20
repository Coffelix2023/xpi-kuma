import { spawn } from "node:child_process";

export interface BrowserCommand {
  args: string[];
  command: string;
}

/**
 * 选择打开默认浏览器的平台原生命令。
 *
 * 参数以数组形式交给 `spawn`，不经过 shell 拼接；URL 里的 `#` 不会被当作
 * 注释或重定向处理。凭据只出现在 fragment 中，因此也不会进入命令历史。
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserCommand {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [
        url,
      ],
    };
  }
  if (platform === "win32") {
    // `start` 的第一个参数是窗口标题占位，留空以免把 URL 当标题
    return {
      command: "cmd",
      args: [
        "/c",
        "start",
        "",
        url,
      ],
    };
  }
  return {
    command: "xdg-open",
    args: [
      url,
    ],
  };
}

/**
 * 用系统默认浏览器打开 URL。
 *
 * stdio 全部 `ignore`：Pi 独占宿主终端，子进程既不能继承 stdout 也不能继承
 * stderr（AGENTS.md §4）。命令只要成功派生就算打开成功，不等待浏览器退出，
 * 否则在 `xdg-open` 阻塞式实现下会拖住命令处理器。
 */
export function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const { args, command } = browserCommand(url, platform);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
