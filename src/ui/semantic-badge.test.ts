import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { SEMANTIC_BADGES } from "./client/semantic-map.ts";
import { semanticBadgeScript } from "./semantic-badge.ts";
import { generateAccountsHTML } from "./pages/accounts.ts";
import { generateDashboardHTML } from "./dashboard-html.ts";
import { generateEmptyHTML } from "./pages/empty.ts";
import { generateSettingsHTML } from "./pages/settings.ts";

const MAP_PATH = ".pi/prototype-design/kuma-dashboard/semantic-ui-map.yaml";

interface MapElement {
  short: string;
  label: string;
  status: string;
  impl?: { path?: string };
}

describe("语义徽标映射与字典同步", () => {
  const doc = YAML.parse(readFileSync(MAP_PATH, "utf8")) as {
    elements: Record<string, MapElement>;
  };

  it("字典里 locked 且登记 impl 的元素都在徽标映射里，短码与标签一致", () => {
    const promoted = Object.entries(doc.elements).filter(
      ([, el]) => el.status === "locked" && el.impl?.path,
    );
    expect(promoted.length).toBeGreaterThan(0);
    for (const [id, el] of promoted) {
      const badge = SEMANTIC_BADGES[id];
      expect(badge, `缺少徽标条目: ${id}`).toBeDefined();
      expect(badge.short).toBe(el.short);
      expect(badge.label).toBe(el.label);
    }
  });

  it("徽标映射里没有字典之外的条目", () => {
    for (const id of Object.keys(SEMANTIC_BADGES)) {
      const el = doc.elements[id];
      expect(el, `字典未登记: ${id}`).toBeDefined();
      expect(el.status).toBe("locked");
      expect(el.impl?.path).toBeTruthy();
    }
  });
});

describe("语义徽标调试层", () => {
  it("脚本自带 ?semantic=1 门槛、顶部居中默认位置与拖拽持久化", () => {
    const script = semanticBadgeScript();
    expect(script).toContain('params.get("semantic") === "1"');
    // 默认位置：顶部居中（fixed + top:8px + left:50%）
    expect(script).toContain("position: fixed");
    expect(script).toContain("top: 8px; left: 50%");
    // 拖拽位置持久化
    expect(script).toContain("kuma.semanticPos");
    // 徽标内容 = 短码 + 标签
    expect(script).toContain('entry.short + " " + entry.label');
  });

  it("四个页面都注入了徽标脚本；脚本内置全部短码映射", () => {
    for (const html of [
      generateDashboardHTML(),
      generateAccountsHTML(),
      generateSettingsHTML(),
      generateEmptyHTML(),
    ]) {
      expect(html).toContain("kuma-semantic-toggle");
      expect(html).toContain('params.get("semantic") === "1"');
    }
    const script = semanticBadgeScript();
    for (const id of Object.keys(SEMANTIC_BADGES)) {
      expect(script).toContain(`"${id}"`);
    }
  });

  it("生产源码里的 data-semantic-id 全部能查到短码", () => {
    const html = [
      generateDashboardHTML(),
      generateAccountsHTML(),
      generateSettingsHTML(),
      generateEmptyHTML(),
    ].join("\n");
    const ids = [...html.matchAll(/data-semantic-id="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      expect(SEMANTIC_BADGES[id], `徽标映射缺少: ${id}`).toBeDefined();
    }
  });
});
