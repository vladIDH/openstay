import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // The browser part of fairguest, from its sources: nothing needs to be built first.
    alias: [{ find: /^fairguest\/browser$/, replacement: src("../fairguest/src/browser.ts") }],
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts"] },
  },
});
