// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const card = await readFile(new URL("./salem-pathfinder-card.tsx", import.meta.url), "utf8");
const widget = await readFile(new URL("./salem-widget.tsx", import.meta.url), "utf8");

// Card: "Was this helpful?" capture only renders when a handler is wired, and a
// correction note is only sent on explicit submit.
assert.match(card, /onFeedback\?: \(feedback: \{ helpful: boolean; correctionNote\?: string \}\) => void/, "card exposes onFeedback");
assert.match(card, /onFeedback \? \(/, "feedback row hidden without a handler");
assert.match(card, /Was this helpful\?/, "asks for feedback");
assert.match(card, /aria-label="Helpful"/, "thumbs-up control");
assert.match(card, /aria-label="Not helpful"/, "thumbs-down control");
assert.match(card, /Suggest a better path/, "offers an optional correction note");
assert.match(card, /sendFeedback\(false, correction\)/, "correction submitted explicitly");

// The rail chat has no Pathfinder trigger, so it must not retain unreachable
// feedback transport or card wiring.
assert.doesNotMatch(widget, /pathfinder\/feedback|recordFeedback|onFeedback=/, "rail chat omits dormant Pathfinder feedback plumbing");

console.log("salem-feedback-capture.test.ts OK");
