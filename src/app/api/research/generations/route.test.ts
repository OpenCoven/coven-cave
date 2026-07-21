import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("every method is local-only and bounded like the research siblings", () => {
  const guards = [...route.matchAll(/rejectNonLocalRequest\(req\)/g)];
  assert.equal(guards.length, 3, "GET, POST, and DELETE each guard origin");
  assert.match(route, /readJsonBody</);
  assert.match(route, /MAX_BODY_BYTES/);
});

test("list requires a validated familiar id", () => {
  assert.match(route, /familiarId required/);
  assert.match(route, /isValidResearchGenerationFamiliarId/);
});

test("create validates input and drafts synchronously via the server store", () => {
  assert.match(route, /validateCreateResearchGenerationInput/);
  assert.match(route, /createResearchGenerationFromMission/);
});

test("a mission with nothing to draft from maps to 409, not a fake queued record", () => {
  assert.match(route, /"no-artifact" \? 409/);
  assert.match(route, /"mission-not-found" \? 404/);
  assert.doesNotMatch(route, /queued|drafting|progress/i, "no synthetic progress states");
});

test("delete is by id + familiar and reports misses as 404", () => {
  assert.match(route, /removeResearchGeneration/);
  assert.match(route, /generation not found/);
  assert.match(route, /status: 404/);
});
