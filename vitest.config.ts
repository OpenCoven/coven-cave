import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
