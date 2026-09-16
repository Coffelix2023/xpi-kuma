/**
 * `glimpseui` 未随包发布类型声明，这里只声明本扩展用到的部分。
 *
 * 上游源码：`node_modules/glimpseui/src/glimpse.mjs`。
 */
declare module "glimpseui" {
  import type { EventEmitter } from "node:events";

  export interface GlimpseOpenOptions {
    autoClose?: boolean;
    clickThrough?: boolean;
    floating?: boolean;
    frameless?: boolean;
    height?: number;
    hidden?: boolean;
    noDock?: boolean;
    openLinks?: boolean;
    title?: string;
    transparent?: boolean;
    width?: number;
    x?: number;
    y?: number;
  }

  export interface GlimpseWindow extends EventEmitter {
    close(): void;
    /** 加载本地 HTML 文件。 */
    loadFile(path: string): void;
    /** 在页面上下文中执行 JS。 */
    send(js: string): void;
    /** 替换页面内容。 */
    setHTML(html: string): void;
    /** 显示窗口（创建时若用了 hidden）。 */
    show(options?: { title?: string }): void;
  }

  export function open(html: string, options?: GlimpseOpenOptions): GlimpseWindow;

  export const prompt: (
    html: string,
    options?: GlimpseOpenOptions & {
      timeout?: number;
    },
  ) => Promise<unknown>;

  export function getNativeHostInfo(): {
    path: string;
    platform: string;
    buildHint: string;
  };
}
