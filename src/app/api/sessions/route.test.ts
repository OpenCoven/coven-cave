// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /\.\.\.\(binding\.model \? \{ model: binding\.model \} : \{\}\)/,
  "direct daemon session launches omit an absent runtime-owned model",
);

assert.match(
  source,
  /runtimeOwnsModelDefault\(initialBinding\.harness\)[\s\S]{0,120}model:\s*""/,
  "unbound runtime-owned sessions defer to the daemon default instead of Cave's global model",
);

console.log("sessions route.test.ts: ok");
