import tsParser from "@typescript-eslint/parser";

import designSystemPlugin from "./scripts/eslint/design-system-plugin.mjs";

// This focused gate does not enable the repo's unrelated legacy lint rules.
// Stubs let their existing disable comments coexist without pulling in plugins.
const noopRule = {
  meta: { type: "problem", schema: [] },
  create() {
    return {};
  },
};

export default [
  {
    ignores: [".next/**", ".worktrees/**", "node_modules/**"],
  },
  {
    files: ["src/components/**/*.tsx"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "coven-design": designSystemPlugin,
      "react-hooks": { rules: { "exhaustive-deps": noopRule } },
      "@next/next": { rules: { "no-img-element": noopRule } },
      react: { rules: { "no-danger": noopRule } },
      "jsx-a11y": {
        rules: { "no-interactive-element-to-noninteractive-role": noopRule },
      },
    },
    rules: {
      "coven-design/no-raw-px-text": "error",
      "coven-design/no-static-inline-style": "error",
      "coven-design/no-render-hex-color": "error",
    },
  },
];
