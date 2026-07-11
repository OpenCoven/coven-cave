// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const comp = await readFile(new URL("./artifact-comments.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/artifact-comments.css", import.meta.url), "utf8");

// ── ArtifactComments: select-to-comment + request revision ───────────────────
assert.match(comp, /export function ArtifactComments\(/, "exports the ArtifactComments component");
// Selection is scoped to THIS turn's rendered markdown, not the whole document.
assert.match(
  comp,
  /\[data-turn-id="\$\{CSS\.escape\(turnId\)\}"\] \.cave-artifact-content/,
  "scopes text selection to the turn's rendered markdown content",
);
assert.match(comp, /document\.addEventListener\("mouseup", onMouseUp\)/, "detects selection on mouseup");
assert.match(comp, /window\.getSelection\(\)/, "reads the live text selection");
assert.match(comp, /className="cave-artifact-comment-fab"/, "shows a floating Comment affordance on selection");
// The fab's x is clamped so wide selections can't push it off the viewport edge.
assert.match(
  comp,
  /clampFabX\(rect\.left \+ rect\.width \/ 2, window\.innerWidth\)/,
  "clamps the fab position to the viewport so it never clips offscreen",
);
// The comments are folded into a prompt and sent via the chat send path.
assert.match(comp, /buildCommentsPrompt\(comments/, "builds the revision prompt from the collected comments");
assert.match(comp, /onRequest\(prompt\)/, "submits the synthesized prompt to the agent");
assert.match(comp, /Request \{familiarName\}/, "labels the action with the familiar's name");
// Per-turn persistence so a reload doesn't drop in-progress comments.
assert.match(comp, /readComments\(turnId\)/, "initialises comments from per-turn storage");
assert.match(comp, /writeComments\(turnId, comments\)/, "persists comments per turn");
// Note editing + removal.
assert.match(comp, /aria-label="Comment note"/, "each comment has an editable note field");
assert.match(comp, /aria-label="Remove comment"/, "each comment can be removed");

// ── chat-view wiring ─────────────────────────────────────────────────────────
assert.match(chatView, /import \{ ArtifactComments \}/, "chat-view imports ArtifactComments");
assert.match(
  chatView,
  /<div className="cave-artifact-content">\s*<MessageBubble/,
  "the assistant bubble is wrapped so selection can be scoped to its markdown",
);
assert.match(
  chatView,
  /!turn\.pending && !turn\.error && visible\.trim\(\)\.length > 80 \? \(\s*<ArtifactComments/,
  "ArtifactComments mounts only on settled, substantial assistant turns",
);
assert.match(
  chatView,
  /<ArtifactComments[\s\S]*?turnId=\{turn\.id\}[\s\S]*?onRequest=\{\(prompt\) => onSuggestion\?\.\(prompt\)\}/,
  "the revision request is sent through the existing onSuggestion→send path",
);

// ── CSS present for the affordance + panel ───────────────────────────────────
assert.match(css, /\.cave-artifact-comment-fab \{[\s\S]*?position: fixed/, "the floating Comment button is styled");
assert.match(css, /\.cave-artifact-comments \{/, "the comments panel is styled");
assert.match(css, /\.cave-artifact-comments__send \{/, "the request-revision button is styled");

console.log("artifact-comments.test.ts: ok");
