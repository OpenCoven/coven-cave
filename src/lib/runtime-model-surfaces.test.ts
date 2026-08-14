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
const salem = source("../components/salem/ask-salem-view.tsx");
const summoning = source("../components/familiar-summoning-circle.tsx");

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
  chat,
  /formatModelList\(\s*modelHarness,\s*current,\s*composerModelOptions,\s*composerModelInventory\.allowCustom,\s*\)/,
  "chat /model listing uses the live runtime inventory",
);
assert.match(
  quick,
  /formatModelList\(\s*modelHarness,\s*modelOverride \?\? null,\s*runtimeModelOptions,\s*runtimeModelInventory\.allowCustom,\s*\)/,
  "quick-chat /model listing uses the live runtime inventory",
);
assert.match(
  quick,
  /resolveModelArg\(\s*args,\s*modelHarness,\s*runtimeModelOptions,\s*runtimeModelInventory\.allowCustom,\s*\)/,
  "quick-chat /model resolution uses the live runtime inventory and its custom-id capability",
);
assert.match(
  home,
  /resolveModelArg\(\s*args,\s*modelHarness,\s*runtimeModelOptions,\s*runtimeModelInventory\.allowCustom,\s*\)/,
  "home /model resolution honors the full inventory custom-id capability",
);
assert.match(
  chat,
  /resolveModelArg\(\s*args,\s*modelHarness,\s*composerModelOptions,\s*composerModelInventory\.allowCustom,\s*\)/,
  "chat /model resolution honors the full inventory custom-id capability",
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
assert.match(
  salem,
  /inventoryProvenanceLabel[\s\S]*useRuntimeModelInventory\(/,
  "Ask Salem derives its selected familiar model status from the shared inventory",
);
assert.match(
  summoning,
  /useRuntimeModelInventory\(harness \?\? "", null\)/,
  "familiar summoning uses the shared runtime inventory for its model preview",
);
assert.doesNotMatch(salem, /defaultModelForRuntime/, "Ask Salem never advertises a static implicit model");
assert.doesNotMatch(summoning, /defaultModelForRuntime/, "summoning never advertises a static implicit model");
assert.doesNotMatch(
  summoning,
  /modelInventory\.models\[0\]/,
  "summoning never turns a curated seed into an implicit selected model",
);

console.log("runtime-model-surfaces.test.ts: ok");
