// @ts-nocheck
import assert from "node:assert/strict";

import {
  buildDiagramGuidePrompt,
  DIAGRAM_COMMAND_START,
} from "./diagram-command.ts";

const blank = buildDiagramGuidePrompt("");
assert.match(blank, /No brief yet/, "a bare /diagram starts without inventing a brief");
assert.match(blank, /exactly one concise, highest-value question per turn/i, "the intake advances one decision at a time");
assert.match(blank, /Begin by asking what the diagram should help its audience understand/, "the first turn asks for intent");
assert.match(blank, /If the `diagram-design` skill is available/, "the installed skill is preferred");
assert.match(blank, /If it is not available, continue/, "the command has a no-install fallback");

const seeded = buildDiagramGuidePrompt("OAuth token refresh between the app and API");
assert.match(seeded, /OAuth token refresh between the app and API/, "a supplied brief reaches the guide");
assert.match(seeded, /visual type, size, focal point/, "the guide confirms a concrete plan");
assert.match(seeded, /exactly one fenced `html` code block/, "the final answer is extractable as a chat artifact");
assert.match(seeded, /aria-labelledby/, "the output contract includes an accessible name");
assert.equal(DIAGRAM_COMMAND_START, "Help me create a diagram.", "the promptless command has a user-facing label");

console.log("diagram-command: ok");
