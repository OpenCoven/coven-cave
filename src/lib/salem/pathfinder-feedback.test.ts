// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Local feedback store — isolated to a temp COVEN_HOME so it never touches the
// real ~/.coven/cave-salem-pathfinder.json.
const tmpHome = await mkdtemp(path.join(tmpdir(), "salem-fb-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const fb = await import("./pathfinder-feedback.ts");

// SAFETY GATE — never write outside the temp home.
assert.ok(fb.FEEDBACK_PATH.startsWith(tmpHome), `refusing: FEEDBACK_PATH ${fb.FEEDBACK_PATH} not under temp home`);

// sanitizeFeedback: whitelist only; drops arbitrary keys; stamps version/at.
{
  const dirty = { pathId: "first-familiar-cave", mode: "home", helpful: true, secretToken: "abc", note: "x", correctionNote: "  prefer terminal  " };
  const clean = fb.sanitizeFeedback(dirty, "2026-06-15T00:00:00Z");
  assert.equal(clean.pathId, "first-familiar-cave");
  assert.equal(clean.helpful, true);
  assert.equal(clean.correctionNote, "prefer terminal", "trims the correction note");
  assert.equal(clean.registryVersion.length > 0, true, "stamps the registry version");
  assert.equal(clean.at, "2026-06-15T00:00:00Z");
  assert.ok(!("secretToken" in clean) && !("note" in clean), "drops non-whitelisted keys (no secret leakage)");
}
assert.equal(fb.sanitizeFeedback({ mode: "home" }, "t"), null, "no pathId → rejected");

// recordFeedback persists; correction only when explicitly provided.
const a = await fb.recordFeedback({ pathId: "coven-code-terminal", mode: "home", helpful: false, correctionNote: "I'm on Windows" });
assert.equal(a.pathId, "coven-code-terminal");
const b = await fb.recordFeedback({ pathId: "first-familiar-cave", mode: "setup", savedToBoard: true });
assert.equal(b.savedToBoard, true);
assert.equal(b.correctionNote, undefined, "no correction note unless submitted");

const all = await fb.loadFeedback();
assert.equal(all.length, 2, "both entries persisted");
assert.equal(all[1].registryVersion, b.registryVersion, "entries carry the registry version");

assert.equal(await fb.recordFeedback({ helpful: true }), null, "invalid input is not recorded");

await rm(tmpHome, { recursive: true, force: true });
console.log("pathfinder-feedback.test.ts OK");
