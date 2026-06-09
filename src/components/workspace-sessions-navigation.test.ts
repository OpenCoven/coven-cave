// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const slashCommands = await readFile(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  workspace,
  /mode === "sessions"/,
  "Sessions mode branch has been removed from workspace",
);

assert.doesNotMatch(
  chatSurface,
  /import \{ SessionsView \}/,
  "ChatSurface should no longer import SessionsView — ChatList from chat-router is the single chat list",
);

assert.match(
  workspace,
  /case "\/sessions":[\s\S]*?setMode\("chat"\)/,
  "/sessions slash routes to chat surface",
);

assert.match(
  slashCommands,
  /name: "\/sessions"[\s\S]*description: "Open all sessions across familiars and harnesses\."/,
  "Slash command help should describe Sessions as cross-familiar and cross-harness",
);
