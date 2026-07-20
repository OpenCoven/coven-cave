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
assert.match(wiring, /return \(\) => observer\.disconnect\(\)/, "the observer is disconnected on cleanup");
assert.match(wiring, /const wireAll = \(\) => \{[\s\S]*?wireCopyButtons\(el\)[\s\S]*?\};[\s\S]*?wireAll\(\);/, "initial pass wires immediately, then the observer re-wires");

assert.match(bubble, /ph:thumbs-up/, "assistant action row has thumbs-up");
assert.match(bubble, /ph:thumbs-down/, "assistant action row has thumbs-down");
assert.doesNotMatch(bubble, /ph:share-network/, "share action removed from assistant row");
assert.match(bubble, /recordFeedbackAnalytics\(/, "thumbs votes are mirrored to the analytics store");

console.log("message-bubble-rewire.test.ts: ok");
