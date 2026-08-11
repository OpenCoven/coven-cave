// @ts-nocheck
// /canvas command: chat generates inline with a prompt; without one it shows a
// usage hint (the Canvas page moved to feature/journal-canvas-surface). The
// workspace-level /canvas declines local handling so Home can hand the exact
// command to a mounted ChatView.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const ws = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(chat, /command === "\/canvas"/, "chat intercepts /canvas");
assert.match(chat, /buildSketchPrompt/, "chat wraps the prompt with buildSketchPrompt");
assert.match(chat, /promptOverride/, "sendRaw supports a prompt override");
assert.match(
  chat,
  /command === "\/canvas"[\s\S]{0,300}?appendSystem\("Describe what to sketch/,
  "promptless /canvas shows a usage hint instead of opening a page",
);
assert.match(
  ws,
  /case "\/canvas":[\s\S]{0,240}?return false;/,
  "workspace /canvas leaves Home to hand the exact command to ChatView",
);
assert.doesNotMatch(ws, /cave:journal-set-tab/, "no Canvas-tab navigation remains");

console.log("chat /canvas command wiring: ok");
