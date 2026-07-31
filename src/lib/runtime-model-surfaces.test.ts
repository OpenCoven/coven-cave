// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const home = source("../components/home-composer.tsx");
const chat = source("../components/chat-view.tsx");
const quick = source("../components/quick-chat-controls.tsx");
const hero = source("../components/chat-familiar-capabilities.tsx");
const studio = source("../components/familiar-studio-brain-tab.tsx");
const board = source("../components/board-inspector.tsx");
const modelState = source("../app/api/chat/model-state/route.ts");

for (const [name, contents, options] of [
  ["home composer", home, "runtimeModelOptions"],
  ["chat composer", chat, "composerModelOptions"],
  ["quick chat", quick, "runtimeModelOptions"],
]) {
  assert.match(
    contents,
    new RegExp(`modelOptionsOverride: ${options}`),
    `${name} slash autocomplete consumes the live provider inventory`,
  );
  assert.doesNotMatch(
    contents,
    new RegExp(`modelHarness === "opencode" \\? ${options} : undefined`),
    `${name} must not limit live slash models to OpenCode`,
  );
}

assert.match(
  home,
  /resolveModelArg\(\s*args,\s*modelHarness,\s*runtimeModelOptions,\s*\)/,
  "home /model resolution uses the live Claude, Copilot, or OpenCode inventory",
);
assert.match(
  chat,
  /formatModelList\(\s*modelHarness,\s*current,\s*composerModelOptions,\s*\)/,
  "chat /model listing uses the live runtime inventory",
);
assert.match(
  chat,
  /resolveModelArg\(\s*args,\s*modelHarness,\s*composerModelOptions,\s*\)/,
  "chat /model resolution uses the live runtime inventory",
);
assert.match(
  quick,
  /formatModelList\(\s*modelHarness,\s*modelOverride \?\? null,\s*runtimeModelOptions,\s*\)/,
  "quick-chat /model listing uses the live runtime inventory",
);
assert.match(
  quick,
  /resolveModelArg\(\s*args,\s*modelHarness,\s*runtimeModelOptions,\s*\)/,
  "quick-chat /model resolution uses the live runtime inventory",
);

assert.match(
  hero,
  /useRuntimeModelInventory\(effectiveHarness, familiar\.id\)[\s\S]*inventoryProvenanceLabel/,
  "the Familiar identity model picker uses the familiar-scoped live inventory",
);
assert.match(
  studio,
  /useRuntimeModelInventory\(harnessId, familiar\.id\)[\s\S]*inventoryProvenanceLabel/,
  "Familiar Studio uses the same familiar-scoped live inventory",
);
assert.match(
  board,
  /useRuntimeModelInventory\(modelHarness, currentFamiliar\?\.id \?\? null\)[\s\S]*inventoryProvenanceLabel/,
  "task model selection uses the live runtime inventory",
);
assert.match(
  modelState,
  /listRuntimeModelInventory\(\s*state\.harness,\s*familiarId,/,
  "the aggregate model-state response gives non-web clients the same inventory",
);

console.log("runtime-model-surfaces.test.ts: ok");
