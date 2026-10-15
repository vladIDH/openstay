import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "packages/fairguest-relay/public/**", "packages/fairguest-relay/assets/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "error",
    },
  },
  {
    files: ["**/bin/*.js"],
    languageOptions: { globals: { process: "readonly", URL: "readonly" } },
  },
  {
    // The build scripts of the relay's page run in Node.
    files: ["packages/fairguest-relay/scripts/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", URL: "readonly", Buffer: "readonly", fetch: "readonly", console: "readonly", Request: "readonly", Response: "readonly", structuredClone: "readonly" },
    },
  },
  {
    files: ["scripts/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    files: ["installa/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", URL: "readonly", Buffer: "readonly" } },
  },
);
