// @ts-nocheck
// /canvas command: chat generates inline with a prompt; without one it shows a
// usage hint (the Canvas page moved to feature/journal-canvas-surface). The
// workspace-level /canvas hands off to a chat.
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
assert.match(ws, /case "\/canvas":[\s\S]{0,400}?startFamiliarChat\(activeId\)/, "workspace /canvas hands off to a chat");
assert.doesNotMatch(ws, /cave:journal-set-tab/, "no Canvas-tab navigation remains");

console.log("chat /canvas command wiring: ok");
