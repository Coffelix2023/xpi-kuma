import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { browserCommand, openInBrowser } from "./open-browser.ts";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

class FakeChild extends EventEmitter {
  unref = vi.fn();
}

const URL_UNDER_TEST = "http://127.0.0.1:4321/#token";

describe("browserCommand 平台选择", () => {
  it("macOS 用 open", () => {
    expect(browserCommand(URL_UNDER_TEST, "darwin")).toEqual({
      command: "open",
      args: [
        URL_UNDER_TEST,
      ],
    });
  });

  it("Linux 用 xdg-open", () => {
    expect(browserCommand(URL_UNDER_TEST, "linux")).toEqual({
      command: "xdg-open",
      args: [
        URL_UNDER_TEST,
      ],
    });
  });

  it("Windows 用 cmd /c start，并留出标题占位参数", () => {
    expect(browserCommand(URL_UNDER_TEST, "win32")).toEqual({
      command: "cmd",
      args: [
        "/c",
        "start",
        "",
        URL_UNDER_TEST,
      ],
    });
  });

  it("URL 始终作为独立参数传入，不拼接进 shell 字符串", () => {
    for (const platform of [
      "darwin",
      "linux",
      "win32",
    ] as const) {
      const { args } = browserCommand(URL_UNDER_TEST, platform);
      expect(args).toContain(URL_UNDER_TEST);
    }
  });
});

describe("openInBrowser", () => {
  it("stderr 与 stdout 都不继承终端", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const pending = openInBrowser(URL_UNDER_TEST, "darwin");
    child.emit("spawn");

    await expect(pending).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      "open",
      [
        URL_UNDER_TEST,
      ],
      {
        stdio: "ignore",
      },
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it("命令缺失时 reject，调用方据此降级为通知 URL", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const pending = openInBrowser(URL_UNDER_TEST, "linux");
    child.emit("error", new Error("spawn xdg-open ENOENT"));

    await expect(pending).rejects.toThrow("ENOENT");
  });
});
