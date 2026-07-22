import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /spawn\(binary, \["--no-auto-update", "models"\]/,
  "the harness catalog probe must not trigger Grok's automatic updater on routine UI refreshes",
);

console.log("harness route tests passed");
