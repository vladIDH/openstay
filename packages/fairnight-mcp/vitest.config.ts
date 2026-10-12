import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Test against the sources of the other packages, so nothing needs to be built first.
    alias: [
      { find: /^fairnight-cli$/, replacement: src("../fairnight-cli/src/index.ts") },
      { find: /^fairnight$/, replacement: src("../fairnight/src/engine/index.ts") },
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
