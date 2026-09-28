// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// useWireCopyButtons must re-wire on DOM mutations so code-block Copy / collapse
// / expand buttons get listeners even when the highlighter populates them after
// the first render. Without this, single-render surfaces (the comux file /
// markdown preview's SyntaxBlock & MarkdownBlock) left those buttons inert,
// while the chat's repeatedly-rendering MarkdownContent happened to wire them.

const bubble = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const wiring = await readFile(new URL("./message-dom-wiring.ts", import.meta.url), "utf8");

assert.match(wiring, /const observer = new MutationObserver\(\(\) => wireAll\(\)\)/, "a MutationObserver re-runs the wiring");
assert.match(wiring, /observer\.observe\(el, \{ childList: true, subtree: true \}\)/, "it observes added nodes in the container subtree");
assert.match(
  wiring,
  /return \(\) => \{\s*observer\.disconnect\(\);\s*cleanupMarkdownLinks\(el\);\s*\}/,
  "cleanup disconnects the observer and removes markdown link listeners",
);
assert.match(wiring, /const wireAll = \(\) => \{[\s\S]*?wireCopyButtons\(el\)[\s\S]*?\};[\s\S]*?wireAll\(\);/, "initial pass wires immediately, then the observer re-wires");

assert.match(bubble, /ph:thumbs-up/, "assistant action row has thumbs-up");
assert.match(bubble, /ph:thumbs-down/, "assistant action row has thumbs-down");
assert.doesNotMatch(bubble, /ph:share-network/, "share action removed from assistant row");
assert.match(bubble, /recordFeedbackAnalytics\(/, "thumbs votes are mirrored to the analytics store");
// A fresh thumbs-down asks once what missed, with fixed one-tap reasons.
assert.match(bubble, /setReasonStep\(next === "down" \? "asking" : "idle"\)/, "only a thumbs-down (not a toggle-off) opens the reason row");
assert.match(bubble, /reasonStep === "asking" && vote === "down"/, "the reason row shows only while the vote is down");
assert.match(bubble, /FEEDBACK_REASONS\.map\(/, "reasons come from the shared fixed list, never free text");
assert.match(bubble, /recordFeedbackAnalytics\(messageId, "down", false, feedbackContext, reason\)/, "a chosen reason is recorded with the down vote");
assert.match(bubble, /aria-label="Skip reason"/, "the reason is skippable");
assert.match(bubble, /import "@\/styles\/cave-feedback-reason\.css";/, "the row imports its own stylesheet, not globals");

console.log("message-bubble-rewire.test.ts: ok");
