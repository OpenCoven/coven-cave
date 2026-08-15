import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

import designSystemPlugin from "./scripts/eslint/design-system-plugin.mjs";

// This focused gate does not enable the repo's unrelated legacy lint rules.
// Stubs let their existing disable comments coexist without pulling in plugins.
//
// react-hooks is the ONE exception: it is the real plugin, because
// rules-of-hooks is enabled below. Its other rules still do not run — a
// registered rule only fires when `rules` turns it on — so existing
// `eslint-disable react-hooks/exhaustive-deps` comments keep resolving
// against a rule that stays silent, exactly as the stub did (cave-hmltt).
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
  // The design-system rules are authored against component JSX and stay scoped
  // to it. rules-of-hooks is not — hooks live in src/lib (use-inline-slash-
  // menus.ts, cave-familiar-images.ts, use-surface-history.tsx) and in route
  // components under src/app, and a hook-order crash there is identical to one
  // in a component. Measured at 0 violations across those paths when the rule
  // was turned on, so the wider gate costs nothing today and holds the line
  // going forward.
  {
    files: [
      "src/lib/**/*.ts",
      "src/lib/**/*.tsx",
      "src/app/**/*.ts",
      "src/app/**/*.tsx",
      "src/components/**/*.ts",
      "src/components/**/*.tsx",
    ],
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
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Every hook must run on every render, in the same order. Nothing in CI
      // checked this before: react-hooks was a stub, so a hook placed after an
      // early return shipped clean and crashed the surface at runtime with
      // "Rendered more hooks than during the previous render" (cave-qxq4l took
      // down the whole Relations graph that way).
      "react-hooks/rules-of-hooks": "error",
    },
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
      "react-hooks": reactHooks,
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
