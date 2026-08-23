// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(chat, /command === "\/diagram"/, "chat intercepts /diagram");
assert.match(chat, /buildDiagramGuidePrompt/, "chat starts the guided diagram intake");
assert.match(
  chat,
  /command === "\/diagram"[\s\S]{0,500}?promptOverride: wrapped/,
  "the familiar receives the guide while the user bubble keeps the short brief",
);
assert.match(
  chat,
  /brief \|\| DIAGRAM_COMMAND_START/,
  "a bare /diagram has a visible user-facing starting message",
);
assert.match(
  workspace,
  /case "\/canvas":\s*case "\/diagram":[\s\S]{0,260}?return false;/,
  "Home hands /diagram to a mounted ChatView instead of treating it as navigation",
);

console.log("chat /diagram command wiring: ok");
