// @ts-nocheck
// /canvas command: chat generates inline with a prompt; workspace opens the
// Canvas page with no prompt.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const ws = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(chat, /command === "\/canvas"/, "chat intercepts /canvas");
assert.match(chat, /buildSketchPrompt/, "chat wraps the prompt with buildSketchPrompt");
assert.match(chat, /promptOverride/, "sendRaw supports a prompt override");
assert.match(ws, /case "\/canvas":/, "the /canvas command still exists");
assert.match(ws, /setMode\("journal"\)/, "/canvas opens the journal surface");
assert.match(ws, /cave:journal-set-tab/, "/canvas requests the Canvas tab");

console.log("chat /canvas command wiring: ok");
