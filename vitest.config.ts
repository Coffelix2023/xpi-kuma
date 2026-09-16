import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 只跑本扩展源码；docs/references/ 下的上游克隆材料不参与。
    include: [
      "src/**/*.test.ts",
    ],
  },
});
