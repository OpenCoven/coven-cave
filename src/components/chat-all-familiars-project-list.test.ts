// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*familiars=\{familiars\}[\s\S]*onSetActiveFamiliar=\{onSetActiveFamiliar\}/,
  "ChatSurface should pass all familiars into ChatRouter so the generic Familiars scope can still list chats",
);

assert.doesNotMatch(
  chatRouter,
  /if \(!familiar\) \{[\s\S]*?Choose a familiar/,
  "ChatRouter should not hide the chat list when the generic Familiars scope is selected",
);

assert.match(
  chatRouter,
  /<ChatList[\s\S]*familiar=\{familiar\}[\s\S]*familiars=\{familiars\}/,
  "ChatRouter should render ChatList with nullable familiar plus the full familiar list",
);

assert.match(
  chatRouter,
  /onSetActiveFamiliar\?\.\(next\.id\)/,
  "Opening a chat or project-scoped launch from all-familiars mode should select that familiar before entering the chat",
);

assert.match(
  chatRouter,
  /newChat: \(projectRoot\?: string, initialPrompt\?: string, familiarId\?: string \| null\)/,
  "Imperative new-chat launches should carry a familiar id with the project root",
);

assert.match(
  chatList,
  /deriveChatProjectGroups\(filtered\)/,
  "ChatList should use project grouping derived from working directory roots",
);

assert.match(
  chatList,
  /defaultFamiliarId/,
  "Project group launch should carry the latest familiar for that working directory",
);

console.log("chat-all-familiars-project-list.test.ts: ok");
