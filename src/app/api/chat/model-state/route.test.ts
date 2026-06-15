// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /export async function GET/);
assert.match(route, /export async function PATCH/);
assert.match(route, /bindingFor\(config, familiarId\)/);
assert.match(route, /resolveChatModelState/);
assert.match(route, /loadConversation\(sessionId\)/);
assert.match(route, /saveConfig/);
assert.match(route, /saveConversation/);
assert.match(
  route,
  /conversation\.familiarId !== familiarId[\s\S]*jsonError\("not found", 404\)/,
  "session-scoped model writes must reject conversations owned by another familiar",
);
assert.match(route, /scope !== "familiar-default" && scope !== "session"/);
assert.match(route, /next-message scope is composer-local/);
const nextMessageBranch = route.match(/if \(scope === "next-message"\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
assert.doesNotMatch(nextMessageBranch, /saveConfig/, "next-message choices must never persist to Cave config");

console.log("chat-model-state route test: ok");
