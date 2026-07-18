// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildRecommendationInstruction,
  extractRecommendedReply,
  hasReplyableTurn,
} from "./reply-recommendation.ts";

// ── hasReplyableTurn ──────────────────────────────────────────────────────────
assert.equal(hasReplyableTurn([]), false, "a cold thread has nothing to recommend against");
assert.equal(
  hasReplyableTurn([{ role: "user", text: "hi" }]),
  false,
  "a trailing user turn means we're waiting on a reply, not ready to suggest one",
);
assert.equal(
  hasReplyableTurn([
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello there", pending: true },
  ]),
  false,
  "a still-streaming assistant turn is not a valid anchor",
);
assert.equal(
  hasReplyableTurn([
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello there" },
  ]),
  true,
  "a settled non-empty assistant turn is a valid anchor",
);
assert.equal(
  hasReplyableTurn([{ role: "assistant", text: "   " }]),
  false,
  "an empty assistant turn is not a valid anchor",
);

// ── buildRecommendationInstruction ────────────────────────────────────────────
const instruction = buildRecommendationInstruction({
  messages: [
    { role: "user", text: "can you deploy the app?" },
    { role: "assistant", text: "Deployed to staging. Want production too?" },
  ],
  familiarName: "Sage",
});
assert.match(instruction, /<reply><\/reply>/, "instruction demands the reply be wrapped in <reply> tags");
assert.match(instruction, /first-person voice/, "instruction asks for the user's own voice");
assert.match(instruction, /Do not answer as the assistant/, "instruction forbids continuing as the assistant");
assert.match(instruction, /User: can you deploy the app\?/, "transcript labels the user turn");
assert.match(instruction, /Sage: Deployed to staging\./, "transcript labels the familiar by name");

// Only the last few turns are included, and each is clipped.
const many = Array.from({ length: 12 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  text: `turn number ${i}`,
}));
const trimmed = buildRecommendationInstruction({ messages: many, familiarName: null });
assert.doesNotMatch(trimmed, /turn number 0\b/, "old turns fall out of the transcript window");
assert.match(trimmed, /turn number 11\b/, "the newest turn is always present");
assert.match(trimmed, /Familiar: turn number 11/, "a missing familiar name falls back to 'Familiar'");

// ── extractRecommendedReply ───────────────────────────────────────────────────
assert.deepEqual(
  extractRecommendedReply("<reply>Ship it to production.</reply>"),
  { partial: "Ship it to production.", complete: true },
  "a closed tag extracts the complete reply",
);
assert.equal(
  extractRecommendedReply("<reply>Ship it to prod").partial,
  "Ship it to prod",
  "an open tag mid-stream yields the body so far",
);
assert.equal(
  extractRecommendedReply("<reply>Ship it</re").partial,
  "Ship it",
  "a trailing partial of the closing tag is trimmed off the preview",
);
assert.equal(
  extractRecommendedReply("<rep").partial,
  "",
  "a partial opening tag renders nothing rather than tag noise",
);
assert.equal(
  extractRecommendedReply("Just say yes and move on.").partial,
  "Just say yes and move on.",
  "a tagless stream is usable as-is",
);
assert.equal(
  extractRecommendedReply('<reply>"Ship it now."</reply>').partial,
  "Ship it now.",
  "a stray wrapping quote pair is stripped",
);
assert.equal(
  extractRecommendedReply("```\nDo the thing.\n```").partial,
  "Do the thing.",
  "stray code fences are trimmed from a tagless reply",
);

console.log("reply-recommendation.test.ts passed");
