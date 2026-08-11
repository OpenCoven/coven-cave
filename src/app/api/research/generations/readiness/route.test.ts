import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const readiness = readFileSync(
  new URL("../../../../../lib/server/research-media-readiness.ts", import.meta.url),
  "utf8",
);

test("readiness is a local-only dynamic GET with actionable media hints", () => {
  assert.match(route, /rejectNonLocalRequest/);
  assert.match(route, /getResearchMediaReadiness/);
  assert.match(route, /research-media-readiness/);
});

test("readiness describes provider choices and never selects a via provider", () => {
  assert.match(readiness, /providers/);
  assert.match(readiness, /defaultVoiceId/);
  assert.match(readiness, /ffprobe/);
  assert.doesNotMatch(readiness, /\bvia\b/);
});
