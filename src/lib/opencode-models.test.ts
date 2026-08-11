// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendBoundedModelOutput, MAX_MODEL_LIST_OUTPUT_BYTES } from "./server/opencode-models.ts";
import { parseOpenCodeModels } from "./opencode-models.ts";

assert.deepEqual(
  parseOpenCodeModels("openai/gpt-5.6-sol\nanthropic/claude-opus-5\nopenrouter/anthropic/claude-opus-5\nopenrouter/~anthropic/claude-opus-latest\nopencode/deepseek-v4-flash-free\nopenai/gpt-5.6-sol\nnoise\nopenrouter//invalid\n"),
  [
    { id: "openai/gpt-5.6-sol", label: "openai: GPT 5.6 Sol" },
    { id: "anthropic/claude-opus-5", label: "anthropic: Claude Opus 5" },
    {
      id: "openrouter/anthropic/claude-opus-5",
      label: "openrouter: Anthropic Claude Opus 5",
    },
    {
      id: "openrouter/~anthropic/claude-opus-latest",
      label: "openrouter: Anthropic Claude Opus Latest",
    },
    { id: "opencode/deepseek-v4-flash-free", label: "opencode: Deepseek V4 Flash Free" },
  ],
  "the authenticated CLI inventory keeps nested provider model ids, dedupes, and ignores diagnostics",
);

const serverSource = readFileSync(new URL("./server/opencode-models.ts", import.meta.url), "utf8");
assert.equal(
  appendBoundedModelOutput("a", "b"),
  "ab",
  "inventory output stays intact below the response budget",
);
assert.equal(
  appendBoundedModelOutput("x".repeat(MAX_MODEL_LIST_OUTPUT_BYTES), "y"),
  null,
  "an oversized OpenCode inventory is rejected before it can grow in memory",
);
assert.match(serverSource, /MAX_MODEL_LIST_OUTPUT_BYTES/, "OpenCode inventory has a hard response-size budget");
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
