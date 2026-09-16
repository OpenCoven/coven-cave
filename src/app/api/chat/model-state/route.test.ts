// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /export async function GET/);
assert.match(route, /export async function PATCH/);
assert.match(
  route,
  /rawPreviewModel = url.searchParams.get\("model"\)[\s\S]*?previewModel[\s\S]*?currentState\(familiarId, sessionId, previewModel\)/,
  "GET supports a read-only selected-model preview for pre-first-send clients",
);
assert.match(
  route,
  /rawPreviewModel !== null && previewModel === null[\s\S]*?jsonError\("invalid model", 400\)/,
  "model previews fail closed before capability resolution when the id is unsafe",
);
assert.match(
  route,
  /const localInventoryRequest = rejectNonLocalRequest\(req\) === null[\s\S]*?state\.harness === "opencode" && localInventoryRequest[\s\S]*?listRuntimeModelInventory\([\s\S]*?allowOpenCodeInventory: canReadOpenCodeInventory/,
  "the aggregate endpoint uses the shared inventory while keeping OpenCode discovery local-only",
);
assert.match(
  route,
  /listRuntimeModelInventory\(\s*state\.harness,\s*familiarId,/,
  "Claude, Copilot, OpenCode, and static clients receive one capability-aware model contract",
);
assert.match(route, /\n\s*inventory,\n/);
assert.match(
  route,
  /function modelBindingScope\([\s\S]*?binding\.hermesProfile\.id[\s\S]*?runtimeForBinding\(binding\),[\s\S]*?runtime,[\s\S]*?hermesScope,[\s\S]*?bindingScope: modelBindingScope\(binding, state\.runtime\)/,
  "the response exposes a non-secret binding identity for local, SSH, and Hermes profile scope transitions",
);
assert.match(route, /bindingFor\(config, familiarId\)/);
assert.match(route, /resolveChatModelState/);
assert.match(route, /loadConversation\(sessionId\)/);
assert.match(
  route,
  /const conversationHarness = conversation\?\.pendingRuntimeHandoff\?\.toHarness \?\? conversation\?\.harness;[\s\S]*?const resolvedConversationHarness = conversationHarness[\s\S]*?canonicalHarnessId\(conversationHarness\)[\s\S]*?harness: resolvedConversationHarness \?\? canonicalHarnessId\(binding\.harness\)/,
  "model state must preview a persisted runtime-handoff target before its first fresh turn",
);
assert.match(
  route,
  /if \(conversation && conversation\.familiarId !== familiarId\)[\s\S]*?jsonError\("not found", 404\)/,
  "model-state GET must not expose another familiar's session model intent",
);
assert.match(route, /saveConfig/);
assert.match(route, /saveConversation/);
assert.match(
  route,
  /const bareLocalHermes =[\s\S]*?canonicalHarnessId\(binding\.harness\) === "hermes"[\s\S]*?!binding\.hermesProfile[\s\S]*?!binding\.hasInvalidHermesProfileBinding[\s\S]*?!isSshRuntime\(binding\.runtime\)[\s\S]*?!state\.runtime\?\.startsWith\("ssh:"\)[\s\S]*?canReadHermesInventory = bareLocalHermes && localInventoryRequest[\s\S]*?allowHermesInventory: canReadHermesInventory[\s\S]*?hermesDirect = bareLocalHermes[\s\S]*?hermesDirect && hermesApi !== null/,
  "Hermes discovery requires both local origin and a bare-local binding while remote native controls stay transport-aligned",
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
assert.match(route, /scope !== "familiar-default" && scope !== "session" && scope !== "runtime-handoff"/);
assert.match(
  route,
  /if \(scope === "runtime-handoff"\)[\s\S]*?runtime must match the familiar binding[\s\S]*?conversation\.pendingRuntimeHandoff = \{[\s\S]*?fromHarness:[\s\S]*?toHarness:[\s\S]*?requestedAt:[\s\S]*?conversation\.modelIntent = \{[\s\S]*?model: ""/,
  "runtime handoff is persisted only for the configured target and clears a foreign session model to the target default",
);
assert.match(route, /next-message scope is composer-local/);
assert.match(route, /const clearModel = body\.model === null \|\| body\.model === ""/);
assert.equal(
  route.match(/isValidFamiliarId\(familiarId\)/g)?.length,
  2,
  "GET and PATCH reject URL-shaped familiar ids before echoing them in model state",
);
assert.match(
  route,
  /const modelValidationHarness = scope === "session"[\s\S]*?sessionConversation\?\.pendingRuntimeHandoff\?\.toHarness[\s\S]*?sessionConversation\?\.harness[\s\S]*?binding\.harness[\s\S]*?isModelAllowedByRuntime\(modelValidationHarness, model\)/,
  "model-state writes validate pending handoffs against their target runtime rather than trusting picker validation",
);
assert.match(
  route,
  /if \(clearModel\) \{[\s\S]*?conversation\.modelIntent = \{[\s\S]*?model: "",[\s\S]*?source: "session"/,
  "model: null records an explicit empty session intent for the runtime default",
);
assert.match(
  route,
  /saveConfig\([\s\S]*?model: clearModel \? "" : model,/,
  "model: null becomes a durable empty familiar runtime-default intent",
);
const nextMessageBranch = route.match(/if \(scope === "next-message"\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
assert.doesNotMatch(nextMessageBranch, /saveConfig/, "next-message choices must never persist to Cave config");

console.log("chat-model-state route test: ok");
