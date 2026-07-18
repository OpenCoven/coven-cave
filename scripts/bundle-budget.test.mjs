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
