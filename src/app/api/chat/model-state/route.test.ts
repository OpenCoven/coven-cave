// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /export async function GET/);
assert.match(route, /export async function PATCH/);
assert.match(
  route,
  /state\.harness === "opencode"[\s\S]*?!rejectNonLocalRequest\(req\)[\s\S]*?listRuntimeModelInventory\([\s\S]*?allowOpenCodeInventory: canReadOpenCodeInventory/,
  "the aggregate endpoint uses the shared inventory while keeping OpenCode discovery local-only",
);
assert.match(
  route,
  /listRuntimeModelInventory\(\s*state\.harness,\s*familiarId,/,
  "Claude, Copilot, OpenCode, and static clients receive one capability-aware model contract",
);
assert.match(route, /\n\s*inventory,\n/);
assert.match(route, /bindingFor\(config, familiarId\)/);
assert.match(route, /resolveChatModelState/);
assert.match(route, /loadConversation\(sessionId\)/);
assert.match(route, /saveConfig/);
assert.match(route, /saveConversation/);
assert.match(
  route,
  /const hermesBinding = bindingFor\(await loadConfig\(\), familiarId\);[\s\S]*?const hermesDirect =[\s\S]*?!isSshRuntime\(hermesBinding\.runtime\)[\s\S]*?hermesDirect && hermesApi !== null/,
  "SSH-bound Hermes chats must not advertise native Responses controls",
);
assert.equal(
  route.match(/sessionId && !isSafeConversationSessionId\(sessionId\)/g)?.length,
  2,
  "GET and PATCH must reject unsafe optional session ids before loading or locking",
);
assert.match(
  route,
  /conversation\.familiarId !== familiarId[\s\S]*jsonError\("not found", 404\)/,
  "session-scoped model writes must reject conversations owned by another familiar",
);
assert.match(route, /scope !== "familiar-default" && scope !== "session"/);
assert.match(route, /next-message scope is composer-local/);
assert.match(route, /const clearModel = body\.model === null/);
assert.match(
  route,
  /if \(clearModel\) \{[\s\S]*?conversation\.modelIntent = \{[\s\S]*?model: "",[\s\S]*?source: "session"/,
  "model: null records an explicit empty session intent for the runtime default",
);
assert.match(
  route,
  /saveConfig\([\s\S]*?model,/,
  "model: null flows through config merge semantics to remove a familiar override",
);
const nextMessageBranch = route.match(/if \(scope === "next-message"\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
assert.doesNotMatch(nextMessageBranch, /saveConfig/, "next-message choices must never persist to Cave config");

console.log("chat-model-state route test: ok");
