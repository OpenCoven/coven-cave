// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./github-action-popover.tsx", import.meta.url), "utf8");

assert.match(
  src,
  /detail: \{ familiarId: selected, initialPrompt \}/,
  "GitHub chat popover should launch chats through initialPrompt (the event contract ChatSurface consumes)",
);
assert.doesNotMatch(
  src,
  /detail: \{ familiarId: selected, context: contextText \}/,
  "GitHub chat popover should not emit the retired detail.context field",
);

console.log("github-action-popover-chat-launch.test.ts: ok");
