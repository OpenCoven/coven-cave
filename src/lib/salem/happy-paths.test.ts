// @ts-nocheck
import assert from "node:assert/strict";
import { HAPPY_PATHS, getPath, REGISTRY_VERSION, validateRegistry } from "./happy-paths.ts";

const ALLOWED_SURFACE = new Set(["setup", "home", "both"]);
const ALLOWED_MATURITY = new Set(["experimental", "beta", "stable-ish"]);
const ALLOWED_TARGET_KIND = new Set(["cave-route", "repo", "product", "external-link"]);
const ALLOWED_ACTION_KIND = new Set([
  "cave-route",
  "copy-command",
  "run-doctor",
  "save-board-checklist",
  "external-link",
]);

// Registry shape
assert.ok(typeof REGISTRY_VERSION === "string" && REGISTRY_VERSION.length > 0, "registry has a version");
assert.equal(HAPPY_PATHS.length, 5, "v0 registry has exactly five canonical paths");

const EXPECTED_IDS = [
  "first-familiar-cave",
  "castcodes-workspace",
  "coven-code-terminal",
  "coven-runtime-builder",
  "familiar-contract-spec",
];
assert.deepEqual(
  HAPPY_PATHS.map((p) => p.id).sort(),
  [...EXPECTED_IDS].sort(),
  "registry exposes the five canonical v0 path ids",
);

// Per-path invariants
const seen = new Set();
for (const p of HAPPY_PATHS) {
  assert.ok(!seen.has(p.id), `path id ${p.id} is unique`);
  seen.add(p.id);
  assert.ok(p.title && p.summary && p.successMoment, `${p.id} has title/summary/successMoment`);
  assert.ok(Array.isArray(p.audiences) && Array.isArray(p.intents) && p.intents.length > 0, `${p.id} has intents`);
  assert.ok(ALLOWED_SURFACE.has(p.surface), `${p.id} surface is valid`);
  assert.ok(ALLOWED_MATURITY.has(p.maturity), `${p.id} maturity is valid`);
  assert.ok(p.primaryTarget && ALLOWED_TARGET_KIND.has(p.primaryTarget.kind), `${p.id} primaryTarget kind valid`);
  assert.ok(Array.isArray(p.steps) && p.steps.length >= 1, `${p.id} has at least one step`);
  for (const s of p.steps) {
    assert.ok(s.id && s.title && s.body, `${p.id} step ${s.id} has id/title/body`);
    if (s.caveAction) assert.ok(ALLOWED_ACTION_KIND.has(s.caveAction.kind), `${p.id} step action kind valid`);
  }
  for (const l of p.links ?? []) assert.ok(l.label && /^https?:\/\//.test(l.url), `${p.id} link is http(s)`);
  for (const b of p.blockers ?? []) assert.ok(b.label && b.suggestion, `${p.id} blocker has label+suggestion`);
}

// getPath
assert.equal(getPath("first-familiar-cave")?.id, "first-familiar-cave", "getPath resolves a known id");
assert.equal(getPath("nope"), undefined, "getPath returns undefined for an unknown id");

// validateRegistry rejects malformed data
assert.throws(() => validateRegistry({ version: "x", paths: [{ id: "broken" }] }), "validateRegistry rejects a path missing required keys");
assert.doesNotThrow(() => validateRegistry({ version: REGISTRY_VERSION, paths: HAPPY_PATHS }), "validateRegistry accepts the real registry");

console.log("happy-paths.test.ts OK");
