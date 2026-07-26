// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseOpenCodeModels } from "./opencode-models.ts";

assert.deepEqual(
  parseOpenCodeModels("openai/gpt-5.6-sol\nopencode/deepseek-v4-flash-free\nopenai/gpt-5.6-sol\nnoise\n"),
  [
    { id: "openai/gpt-5.6-sol", label: "openai: GPT 5.6 Sol" },
    { id: "opencode/deepseek-v4-flash-free", label: "opencode: Deepseek V4 Flash Free" },
  ],
  "the authenticated CLI inventory is deduped and ignores diagnostics",
);

const serverSource = readFileSync(new URL("./server/opencode-models.ts", import.meta.url), "utf8");
assert.match(
  serverSource,
  /listOpenCodeModels\(familiarId\?: string \| null\)[\s\S]*?openCodeSpawnEnv\(familiarId\)/,
  "model discovery uses the same familiar-scoped vault environment as a chat run",
);
assert.match(
  serverSource,
  /const launch = openCodeLaunch\([\s\S]*?evaluateRuntimeAvailability\(openCodeAvailabilityProbe\(launch, env\)\)\.state !== "ready"[\s\S]*?done\(\[\]\);[\s\S]*?return;[\s\S]*?const child = spawn/,
  "model discovery passively verifies the exact command and required launch files before spawn",
);
console.log("opencode-models.test.ts: ok");
