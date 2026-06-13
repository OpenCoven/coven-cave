// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouterBlock =
  source.match(/<ChatRouter\b[\s\S]*?\/>/)?.[0] ?? "";

assert.ok(chatRouterBlock, "ChatSurface should render ChatRouter in conversation mode");

assert.doesNotMatch(
  chatRouterBlock,
  /onFamiliarSelect/,
  "ChatRouter should no longer expose an inline familiar selector — the avatar rail is the only switcher",
);

assert.match(
  chatRouterBlock,
  /familiars=\{familiars\}/,
  "ChatRouter should receive the familiar list so generic Familiars scope can still show chats",
);
