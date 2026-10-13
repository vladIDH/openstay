import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^fairnight$/, replacement: fileURLToPath(new URL("../fairnight/src/engine/index.ts", import.meta.url)) }],
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts"], reporter: ["text", "text-summary"] },
  },
});
