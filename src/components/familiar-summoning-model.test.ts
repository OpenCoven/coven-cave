import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-summoning-model.ts", import.meta.url), "utf8");

assert.match(source, /export type VesselKind = "local" \| "ssh" \| "openclaw"/, "all supported vessel contracts stay centralized");
assert.match(source, /export const STARTER_GLYPHS/, "starter glyphs belong to the summon model");
assert.match(source, /export const AURA_PRESETS/, "aura presets remain shared identity data");
assert.match(source, /export const IDENTITY_PRESETS/, "identity presets remain reviewable content data");
assert.match(source, /export type StageIndex = 0 \| 1 \| 2 \| 3/, "rite stages keep their bounded state contract");
