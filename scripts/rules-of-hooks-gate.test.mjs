// The Rules-of-Hooks gate, pinned so it cannot quietly become a no-op again.
//
// react-hooks was registered as a STUB for a long time — a plugin object whose
// only rule did nothing — purely so existing disable comments kept resolving.
// That is indistinguishable from a working gate at a glance: `pnpm lint` was
// green, `react-hooks` appeared in the config, and nothing in CI ever checked a
// hook. cave-qxq4l shipped through it and crashed the Relations graph at
// runtime with "Rendered more hooks than during the previous render".
//
// These assertions are about the gate being REAL and REACHABLE, which is the
// pair that failed before: a rule enabled in a config the lint script never
// points at is just as silent as a stub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../eslint.config.mjs", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// ── The rule is real ─────────────────────────────────────────────────────────
assert.match(
  config,
  /import reactHooks from "eslint-plugin-react-hooks";/,
  "the real react-hooks plugin is imported, not hand-rolled",
);
assert.match(
  config,
  /"react-hooks": reactHooks/,
  "react-hooks resolves to the real plugin rather than a noop stub",
);
assert.match(
  config,
  /"react-hooks\/rules-of-hooks": "error"/,
  "rules-of-hooks is an error, not a warning the --max-warnings gate could pass",
);
// The stub shape is what silently disabled this for so long. Naming it here
// means a revert to it fails loudly instead of reading as a tidy-up.
assert.doesNotMatch(
  config,
  /"react-hooks":\s*\{\s*rules:/,
  "react-hooks is not re-stubbed with an inline rules object",
);

assert.equal(
  pkg.devDependencies["eslint-plugin-react-hooks"] !== undefined,
  true,
  "the plugin is a real devDependency so CI installs it",
);

// ── The rule is reachable ────────────────────────────────────────────────────
// eslint only lints the paths the CLI is given, so a widened `files` block in
// the config buys nothing on its own.
assert.match(
  pkg.scripts.lint,
  /pnpm lint:hooks/,
  "the top-level lint script runs the hooks gate",
);
const hooks = pkg.scripts["lint:hooks"];
assert.equal(typeof hooks, "string", "lint:hooks exists");
for (const glob of [
  "src/lib/**/*.ts",
  "src/lib/**/*.tsx",
  "src/app/**/*.tsx",
  "src/components/**/*.tsx",
]) {
  assert.ok(
    hooks.includes(glob),
    `lint:hooks covers ${glob} — hooks live outside src/components too`,
  );
}
assert.match(
  hooks,
  /--max-warnings=0/,
  "lint:hooks fails the build rather than printing warnings",
);

console.log("rules-of-hooks-gate.test.mjs: ok");
