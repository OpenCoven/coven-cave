// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Local feedback store — isolated to a temp COVEN_HOME so it never touches the
// real ~/.coven/cave/message-feedback.json.
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
    model: "claude-sonnet-4",
    runtime: "claude",
    content: "the raw prompt text",
    secretToken: "abc",
  };
  const clean = fb.sanitizeMessageFeedback(dirty, "2026-07-03T00:00:00Z");
  assert.equal(clean.messageId, "turn-42", "trims the message id");
  assert.equal(clean.vote, "up");
  assert.equal(clean.cleared, false);
  assert.equal(clean.familiarId, "sage");
  assert.equal(clean.model, "claude-sonnet-4", "model stamp survives (per-model analytics)");
  assert.equal(clean.runtime, "claude", "runtime stamp survives (per-runtime analytics)");
  assert.equal(clean.at, "2026-07-03T00:00:00Z");
  assert.ok(
    !("content" in clean) && !("secretToken" in clean),
    "drops non-whitelisted keys (no content/secret leakage)",
  );
}
// sessionId: the voted message's thread, kept only when it is a well-formed id.
{
  const kept = fb.sanitizeMessageFeedback({ messageId: "m", vote: "down", sessionId: " 31f28910-d951-4ae7-af6b-8b4847a5489a " }, "t");
  assert.equal(kept.sessionId, "31f28910-d951-4ae7-af6b-8b4847a5489a", "thread id survives (outcome calibration)");
  for (const bad of ["[redacted]", "../etc", "a b", "", 42]) {
    const dropped = fb.sanitizeMessageFeedback({ messageId: "m", vote: "down", sessionId: bad }, "t");
    assert.equal(dropped.sessionId, undefined, `malformed thread id dropped: ${JSON.stringify(bad)}`);
  }
}
// reason: a fixed one-tap category, kept only on an active thumbs-down.
{
  assert.equal(fb.sanitizeMessageFeedback({ messageId: "m", vote: "down", reason: "misunderstood" }, "t").reason, "misunderstood");
  assert.equal(fb.sanitizeMessageFeedback({ messageId: "m", vote: "down", reason: "the model was rude" }, "t").reason, undefined, "free text dropped");
  assert.equal(fb.sanitizeMessageFeedback({ messageId: "m", vote: "up", reason: "incorrect" }, "t").reason, undefined, "no reason on a thumbs-up");
  assert.equal(fb.sanitizeMessageFeedback({ messageId: "m", vote: "down", cleared: true, reason: "incorrect" }, "t").reason, undefined, "no reason on a cleared vote");
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
assert.equal(b.model, undefined, "no model unless supplied");
assert.equal(b.runtime, undefined, "no runtime unless supplied");
assert.equal(b.sessionId, undefined, "no thread id unless supplied");

const all = await fb.loadMessageFeedback();
assert.equal(all.length, 2, "both entries persisted");
assert.equal(all[0].messageId, "m1");
assert.equal(all[1].messageId, "m2");

assert.equal(await fb.recordMessageFeedback({ messageId: "m3" }), null, "invalid input is not recorded");

await rm(tmpHome, { recursive: true, force: true });
console.log("message-feedback-store.test.ts OK");
