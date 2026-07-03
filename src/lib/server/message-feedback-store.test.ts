// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Local feedback store — isolated to a temp COVEN_HOME so it never touches the
// real ~/.coven/cave-message-feedback.json.
const tmpHome = await mkdtemp(path.join(tmpdir(), "msg-fb-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const fb = await import("./message-feedback-store.ts");

// SAFETY GATE — never write outside the temp home.
assert.ok(
  fb.MESSAGE_FEEDBACK_PATH.startsWith(tmpHome),
  `refusing: MESSAGE_FEEDBACK_PATH ${fb.MESSAGE_FEEDBACK_PATH} not under temp home`,
);

// sanitizeMessageFeedback: whitelist only; drops arbitrary keys; stamps `at`.
{
  const dirty = {
    messageId: "  turn-42  ",
    vote: "up",
    cleared: false,
    familiarId: "sage",
    content: "the raw prompt text",
    secretToken: "abc",
  };
  const clean = fb.sanitizeMessageFeedback(dirty, "2026-07-03T00:00:00Z");
  assert.equal(clean.messageId, "turn-42", "trims the message id");
  assert.equal(clean.vote, "up");
  assert.equal(clean.cleared, false);
  assert.equal(clean.familiarId, "sage");
  assert.equal(clean.at, "2026-07-03T00:00:00Z");
  assert.ok(
    !("content" in clean) && !("secretToken" in clean),
    "drops non-whitelisted keys (no content/secret leakage)",
  );
}
assert.equal(fb.sanitizeMessageFeedback({ messageId: "x" }, "t"), null, "no vote → rejected");
assert.equal(fb.sanitizeMessageFeedback({ vote: "up" }, "t"), null, "no messageId → rejected");
assert.equal(fb.sanitizeMessageFeedback({ messageId: "x", vote: "sideways" }, "t"), null, "bad vote → rejected");

// recordMessageFeedback persists; familiarId only when provided; cleared flag survives.
const a = await fb.recordMessageFeedback({ messageId: "m1", vote: "down", familiarId: "sage" });
assert.equal(a.vote, "down");
assert.equal(a.familiarId, "sage");
const b = await fb.recordMessageFeedback({ messageId: "m2", vote: "up", cleared: true });
assert.equal(b.cleared, true, "toggle-off is recorded");
assert.equal(b.familiarId, undefined, "no familiarId unless supplied");

const all = await fb.loadMessageFeedback();
assert.equal(all.length, 2, "both entries persisted");
assert.equal(all[0].messageId, "m1");
assert.equal(all[1].messageId, "m2");

assert.equal(await fb.recordMessageFeedback({ messageId: "m3" }), null, "invalid input is not recorded");

await rm(tmpHome, { recursive: true, force: true });
console.log("message-feedback-store.test.ts OK");
