// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /body:\s*\{[\s\S]{0,160}harness,[\s\S]{0,80}model:\s*binding\.model,/,
  "direct daemon session launches forward the resolved familiar or global model",
);

assert.match(
  source,
  /\{\s*harness:\s*requestedHarness\s*\?\?\s*"codex",\s*model:\s*config\.defaults\.model\s*\}/,
  "sessions without a familiar retain the global default model",
);

console.log("sessions route.test.ts: ok");
