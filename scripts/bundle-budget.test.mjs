import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./bundle-budget.mjs", import.meta.url), "utf8");

assert.match(
  source,
  /diagnostics["'\),\s]+route-bundle-stats\.json/,
  "bundle gate reads Next's generated route bundle diagnostic",
);
assert.match(
  source,
  /routeStats\.find\(\(entry\) => entry\.route === "\/"\)/,
  "bundle gate selects the real home route",
);
assert.match(
  source,
  /homeRoute\.firstLoadUncompressedJsBytes/,
  "bundle gate measures the full first-load graph",
);
assert.match(
  source,
  /BUNDLE_MAX_HOME_KB/,
  "the home-route budget has an explicit experimental override",
);
assert.match(
  source,
  /if \(homeBytes > MAX_HOME_BYTES\)/,
  "an over-budget home route fails the postbuild gate",
);

// ── CSS budgets (#3264) ──────────────────────────────────────────────────────
// Root CSS is measured from the minimal _not-found route (root layout only);
// home CSS from the / page manifest. Both fail the same postbuild gate.
assert.match(
  source,
  /_not-found[\s\S]{0,80}page_client-reference-manifest\.js/,
  "css gate measures root CSS via the layout-only _not-found route",
);
assert.match(
  source,
  /BUNDLE_MAX_ROOT_CSS_KB/,
  "the root CSS budget has an explicit experimental override",
);
assert.match(
  source,
  /BUNDLE_MAX_HOME_CSS_KB/,
  "the home CSS budget has an explicit experimental override",
);
assert.match(
  source,
  /rootCss\.bytes > MAX_ROOT_CSS_BYTES/,
  "an over-budget root stylesheet fails the postbuild gate",
);
assert.match(
  source,
  /homeCss\.bytes > MAX_HOME_CSS_BYTES/,
  "an over-budget home stylesheet set fails the postbuild gate",
);

console.log("bundle-budget.test.mjs: ok");

// ── Headroom reporting (cave-7fd41) ─────────────────────────────────────────
// The budgets used to print only a total and a cap, so accretion was invisible
// until a PR crossed the line and ate the failure — the home CSS set reached
// 0.04% of margin over a single day before anyone noticed. These pin the
// reporting itself, because a silent regression here restores that blindness
// without failing anything.

assert.match(
  source,
  /const THIN_HEADROOM_PCT = \d+;/,
  "the thin-budget threshold is an explicit named constant, not a magic number",
);
assert.match(
  source,
  /function headroom\(label, bytes, budget\)/,
  "one shared helper reports headroom, so every budget reports it the same way",
);
assert.match(
  source,
  /if \(left < 0\) return;/,
  "headroom() defers to the caller's failure branch when a budget is already blown",
);
assert.match(
  source,
  /THIN — the next change of any size may fail this gate/,
  "a thin budget warns in the words the next author needs",
);
assert.match(
  source,
  /within budget, but thin on \$\{thin\.join\(", "\)\}/,
  "the summary names which budgets are thin",
);

// Every budget reports headroom — a budget that reports a total but no margin
// is exactly the blind spot this change exists to close.
for (const [label, bytes, budget] of [
  ["first-load JS", "homeBytes", "MAX_HOME_BYTES"],
  ["always-loaded shell", "shellBytes", "MAX_SHELL_BYTES"],
  ["root-layout CSS", "rootCss.bytes", "MAX_ROOT_CSS_BYTES"],
  ["initial / route CSS", "homeCss.bytes", "MAX_HOME_CSS_BYTES"],
]) {
  assert.match(
    source,
    new RegExp(`headroom\\("${label.replace(/[/]/g, "\\/")}", ${bytes.replace(".", "\\.")}, ${budget}\\)`),
    `${label} reports its remaining headroom`,
  );
}

// Reporting must not become a gate: this is signal for the next author, not a
// new failure mode for the current one.
assert.doesNotMatch(
  source,
  /function headroom\([\s\S]{0,400}?failed = true/,
  "headroom() reports without failing the build",
);
