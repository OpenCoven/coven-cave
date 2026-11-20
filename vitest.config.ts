import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { researchPackageConfig } from "./scripts/research-package-config.mjs";

const researchAliases = Object.fromEntries(Object.entries(researchPackageConfig().aliases).map(([key, value]) => [
  key, value.startsWith("./") ? fileURLToPath(new URL(value, import.meta.url)) : value,
]));

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: [
      "**/.next/**",
      "**/.worktrees/**",
      "**/node_modules/**",
      "**/*.spec.ts",
      "**/src-tauri/gen/**",
      "**/src-tauri/target/**",
    ],
  },
  resolve: {
    alias: {
      ...researchAliases,
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
