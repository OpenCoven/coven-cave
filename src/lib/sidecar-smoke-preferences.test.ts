// @ts-nocheck
// Guards the representative preference set in `scripts/sidecar-runtime-smoke.mjs`
// against schema drift.
//
// That smoke test PATCHes a preference set through one sidecar port, restarts on
// another, and asserts the restored `appearance.reading` deep-equals what it
// sent. The server merges a patch over defaults, so any canonical reading key
// the fixture omits comes back as its default and fails that deep-equal — on
// every OS at once. #4736 added `appearance.reading.size` without updating the
// fixture, which failed all three legs of "Validate release runtime" and skipped
// the iOS/TestFlight job for the v0.3.8 cut.
//
// A `.mjs` smoke script cannot import the TypeScript schema, so the coupling is
// checked from this side instead.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  applyPreferencesPatch,
  createDefaultPreferences,
  validatePreferencesPatch,
} from "./preferences-schema.ts";

const SMOKE_PATH = path.join(import.meta.dirname, "..", "..", "scripts", "sidecar-runtime-smoke.mjs");
const source = readFileSync(SMOKE_PATH, "utf8");

const block = /\n {8}reading: \{([\s\S]*?)\n {8}\},/.exec(source);
assert.ok(block, "could not locate the reading fixture in sidecar-runtime-smoke.mjs");

const fixture = {};
for (const [, key, value] of block[1].matchAll(/^\s*(\w+): "([^"]+)",/gm)) fixture[key] = value;
for (const [, key, value] of block[1].matchAll(/^\s*(\w+): (\d+),/gm)) fixture[key] = Number(value);

assert.deepEqual(
  Object.keys(fixture).sort(),
  Object.keys(createDefaultPreferences().appearance.reading).sort(),
  "sidecar-runtime-smoke.mjs must patch every canonical appearance.reading key",
);

// The exact server path the smoke test exercises: validate the patch, merge it
// over stored preferences, and require the result to match what was sent.
const restored = applyPreferencesPatch(
  createDefaultPreferences(true),
  validatePreferencesPatch({ appearance: { reading: fixture } }),
);
assert.deepEqual(
  restored.appearance.reading,
  fixture,
  "the smoke fixture must round-trip unchanged through the preferences patch path",
);

console.log("sidecar-smoke-preferences ok");
