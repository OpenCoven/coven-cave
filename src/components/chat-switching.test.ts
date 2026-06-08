// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouterBlock =
  source.match(/<ChatRouter\b[\s\S]*?pendingProjectRoot=\{pendingProjectRoot\}\s*\/>/)?.[0] ?? "";

assert.ok(chatRouterBlock, "ChatSurface should render ChatRouter in conversation mode");

assert.match(
  chatRouterBlock,
  /onSetActiveFamiliar\(id\)/,
  "ChatRouter familiar selection should update the active familiar",
);

assert.doesNotMatch(
  chatRouterBlock,
  /goToList\(\)/,
  "Switching familiar from the conversation surface should not force the chat list",
);

assert.match(
  chatRouterBlock,
  /routerRef\.current\?\.newChat\(root\)/,
  "Switching familiar with pending project context should start the new familiar in that project chat",
);
