// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const configEntry = config\.familiars\[f\.id\] \?\? \{\}/,
  "Familiars API should inspect the raw familiar config entry before resolving defaults",
);
assert.match(
  source,
  /defaultHarness: config\.defaults\.harness/,
  "Familiars API should expose the workspace default harness for UI copy",
);
assert.match(
  source,
  /harnessOverride: configEntry\.harness \?\? null/,
  "Familiars API should expose whether the familiar has an explicit harness override",
);

console.log("familiars route.test.ts: ok");
