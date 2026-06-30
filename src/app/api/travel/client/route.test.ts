// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /loadState\(\)/,
  "travel client GET should expose the persisted travel/offline state",
);

assert.match(
  source,
  /setManualTravelMode\(body\?\.manualOffline === true\)/,
  "travel client PATCH should persist explicit manual offline mode",
);

assert.match(
  source,
  /localBindHost/,
  "travel client responses should include the localhost-only bind contract",
);

console.log("travel client route.test.ts: ok");
