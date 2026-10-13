import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Test against the sources of the other packages, so nothing needs to be built first.
    alias: [
      { find: /^fairnight$/, replacement: src("../fairnight/src/engine/index.ts") },
      { find: /^fairnight-beds24$/, replacement: src("../fairnight-beds24/src/index.ts") },
      { find: /^fairnight-smoobu$/, replacement: src("../fairnight-smoobu/src/index.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      reporter: ["text", "text-summary"],
    },
  },
});
