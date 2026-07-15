// Regression pins for the React Compiler rollout (cave-n9a8).
//
// The compiler auto-memoizes every component and hook at build time — the
// perf win this repo needs most in its giant stateful surfaces (chat-view,
// workspace, github-view) where hand-memoization can't keep up. These pins
// keep the flag and its build dependency from being dropped accidentally
// (e.g. by a config refactor or a dependency prune): losing either silently
// reverts the whole app to unmemoized re-render cascades with zero test
// failures, because source-level unit tests never see compiled output.
//
// Verified at introduction (2026-07-12): `pnpm build` with the flag emits
// `react.memo_cache_sentinel` markers across client chunks, shell stayed at
// 447 KB (budget 650 KB), and the full e2e suite passes on the compiled app.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig = readFileSync(path.join(root, "next.config.ts"), "utf8");
assert.match(
  nextConfig,
  /^\s*reactCompiler: true,$/m,
  "next.config.ts must keep reactCompiler enabled — dropping it silently reverts every component to unmemoized renders",
);

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.ok(
  pkg.devDependencies?.["babel-plugin-react-compiler"],
  "babel-plugin-react-compiler must stay in devDependencies — the reactCompiler flag needs it at build time",
);

console.log("react-compiler-config.test.mjs: ok");
