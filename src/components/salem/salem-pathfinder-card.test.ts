// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const card = await readFile(new URL("./salem-pathfinder-card.tsx", import.meta.url), "utf8");
const widget = await readFile(new URL("./salem-widget.tsx", import.meta.url), "utf8");

// Card component contract
assert.match(card, /export function SalemPathfinderCard/, "exports SalemPathfinderCard");
assert.match(card, /density\?: "full" \| "slim"/, "supports full/slim density");
assert.match(card, /sanitizeCard\(card\)/, "sanitizes the card before rendering");
assert.match(card, /salem-pf__steps/, "renders the checklist");
assert.match(card, /salem-pf__action--primary/, "renders a primary action");
assert.match(card, /copyText\(/, "copies commands to the clipboard");
// Honest UI: setup-only / board actions are hidden unless their handler is wired.
assert.match(card, /a\.kind !== "save-board-checklist" \|\| !!onSave/, "save action hidden without onSave handler");
assert.match(card, /a\.kind !== "run-doctor" \|\| !!onRunDoctor/, "doctor action hidden without onRunDoctor handler");
// slim density hides links/blockers
assert.match(card, /!slim && safe\.blockers\.length/, "slim hides blockers");
assert.match(card, /!slim && safe\.links\.length/, "slim hides links");
// Emoji-free — icons only (Salem guard).
assert.doesNotMatch(card, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emoji glyphs in the card");

// Panel integration
assert.match(widget, /import \{ SalemPathfinderCard \}/, "panel imports the card");
assert.match(widget, /\/api\/salem\/pathfinder/, "panel posts to the pathfinder route");
assert.match(widget, /<SalemPathfinderCard /, "panel renders the card when present");

console.log("salem-pathfinder-card.test.ts OK");
