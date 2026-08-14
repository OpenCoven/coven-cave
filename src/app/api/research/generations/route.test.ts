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

test("media queue recovery starts once without delaying generation reads", () => {
  assert.match(route, /void startResearchMediaJobs\(\)\.catch/);
  assert.doesNotMatch(route, /recoverInterruptedResearchMediaJobs/);
  assert.doesNotMatch(route, /await startResearchMediaJobs/);
});

test("create validates input and drafts synchronously via the server store", () => {
  assert.match(route, /validateCreateResearchGenerationInput/);
  assert.match(route, /createResearchGenerationFromMission/);
});

test("a mission with nothing to draft from maps to 409, not a fake queued record", () => {
  assert.match(route, /"no-artifact" \? 409/);
  assert.match(route, /"mission-not-found" \? 404/);
  assert.match(route, /createResearchMediaGenerationFromMission/);
  assert.doesNotMatch(route, /enqueueResearchMediaJob/, "creation leaves media in reviewable draft state");
});

test("media readiness failures remain an explicit conflict until the runner is available", () => {
  assert.match(route, /"media-not-ready" \? 409/);
  assert.match(route, /"capacity" \? 409/);
  assert.match(route, /getResearchMediaReadiness/);
  assert.match(route, /validateResearchMediaSelection/);
  assert.match(route, /validated\.value\.renderConfig/);
});

test("an unreadable (symlinked/oversized/escaping) artifact maps to 422, never 500 (cave-v73d)", () => {
  assert.match(route, /"artifact-unreadable" \? 422/);
});

test("delete is atomic against active media and removes the record before its files", () => {
  assert.match(route, /removeResearchGenerationIfInactive/);
  assert.match(route, /cancel the render before deleting/i);
  assert.match(route, /generation not found/);
  assert.match(route, /\? 409 : 404/);
  const storeFailureIndex = route.lastIndexOf(
    "failed to write the research-generations store",
  );
  const mediaCleanupIndex = route.lastIndexOf(
    "await removeResearchGenerationMedia(",
  );
  const successIndex = route.lastIndexOf(
    "return NextResponse.json({ ok: true });",
  );
  assert.ok(
    route.indexOf("removeResearchGenerationIfInactive(") <
      route.indexOf("removeResearchGenerationMedia("),
    "the durable record is removed before best-effort media cleanup",
  );
  assert.ok(
    storeFailureIndex < mediaCleanupIndex && mediaCleanupIndex < successIndex,
    "media cleanup runs after record-store errors are handled and before success",
  );
  assert.match(
    route.slice(mediaCleanupIndex, successIndex),
    /catch \(error\) \{\s*console\.warn\("\[research-generations\] failed to remove media files:", error\);\s*\}/,
    "media cleanup failures are logged without converting a completed deletion into a 500",
  );
});
