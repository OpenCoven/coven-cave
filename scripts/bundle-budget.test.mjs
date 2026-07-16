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

console.log("bundle-budget.test.mjs: ok");
