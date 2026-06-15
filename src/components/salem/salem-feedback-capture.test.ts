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

// Panel: feedback + savedToBoard posted to the local route; saved-to-board recorded on success.
assert.match(widget, /\/api\/salem\/pathfinder\/feedback/, "posts feedback to the local route");
assert.match(widget, /savedToBoard: true/, "records save-to-board");
assert.match(widget, /onFeedback=\{\(fb\) =>/, "card feedback wired in the panel");
// Privacy: only whitelisted fields are sent — no transcript/notes/secrets.
assert.doesNotMatch(widget, /recordFeedback\([\s\S]{0,200}(token|secret|transcript|messages)/i, "feedback payload carries no secrets/transcript");

console.log("salem-feedback-capture.test.ts OK");
