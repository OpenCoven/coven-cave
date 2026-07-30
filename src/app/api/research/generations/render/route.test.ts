import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("render is local-only, review-gated, and delegates to the persistent runner", () => {
  assert.match(route, /rejectNonLocalRequest/);
  assert.match(route, /generation\.status !== "draft"/);
  assert.match(route, /getResearchMediaReadiness/);
  assert.match(route, /validateResearchMediaSelection/);
  assert.match(route, /generation\.renderConfig/);
  assert.doesNotMatch(route, /readiness\.podcast\.via/);
  assert.match(route, /queueResearchMediaGeneration/);
  assert.doesNotMatch(route, /createPodcastMediaJobDefinition/);
  assert.doesNotMatch(route, /createShortVideoMediaJobDefinition/);
  assert.doesNotMatch(route, /enqueueResearchMediaJob/);
  assert.match(route, /generation not found/);
});
