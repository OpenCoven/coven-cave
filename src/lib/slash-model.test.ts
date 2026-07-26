// @ts-nocheck
import assert from "node:assert/strict";
import { modelSlashOptions, resolveModelArg, formatModelList } from "./slash-model.ts";

// --- modelSlashOptions: only active in /model arg position -------------------
assert.equal(modelSlashOptions("/mod", "claude"), null, "not /model arg position until a space is typed");
assert.equal(modelSlashOptions("/familiar researcher", "claude"), null, "ignores other commands");

const all = modelSlashOptions("/model ", "claude");
assert.ok(Array.isArray(all) && all.length === 6, "‘/model ’ lists every claude model");

assert.equal(modelSlashOptions("/m ", "claude").length, 6, "the /m alias works too");

const opus = modelSlashOptions("/model opus", "claude");
assert.ok(opus.every((m) => /opus/i.test(m.label)), "filters by partial label");
assert.equal(opus.length, 2, "‘opus’ narrows to the two Opus models");

assert.equal(modelSlashOptions("/model haiku", "codex").length, 0, "codex catalog has no haiku");

const discovered = [
  { id: "openai/gpt-5.6", label: "OpenAI GPT 5.6" },
  { id: "opencode/big-pickle", label: "OpenCode Big Pickle" },
];
assert.deepEqual(
  modelSlashOptions("/model ", "opencode", discovered),
  discovered,
  "a runtime can supply its configured model inventory without a static catalog",
);

// --- resolveModelArg: id / label / substring / custom -----------------------
assert.equal(resolveModelArg("Claude Sonnet 4.6", "claude"), "anthropic/claude-sonnet-4-6", "matches by label");
assert.equal(resolveModelArg("anthropic/claude-haiku-4-5", "claude"), "anthropic/claude-haiku-4-5", "matches by exact id");
assert.equal(resolveModelArg("sonnet", "claude"), "anthropic/claude-sonnet-5", "substring matches the newest Sonnet first");
assert.equal(resolveModelArg("openai/gpt-6", "claude"), "openai/gpt-6", "accepts a valid custom id");
assert.equal(resolveModelArg("  ", "claude"), null, "empty arg → null");
assert.equal(resolveModelArg("not a model!!", "claude"), null, "malformed custom id → null");
assert.equal(
  resolveModelArg("pickle", "opencode", discovered),
  "opencode/big-pickle",
  "dynamic inventory participates in slash resolution",
);

// --- formatModelList --------------------------------------------------------
const list = formatModelList("claude", "anthropic/claude-opus-4-8");
assert.match(list, /Current model: anthropic\/claude-opus-4-8/, "shows the current model");
assert.match(list, /● Claude Opus 4\.8/, "marks the current model with ●");
assert.match(list, /○ Claude Sonnet 4\.6/, "marks others with ○");
assert.match(formatModelList("openclaw", null), /no model menu/, "free-text runtimes explain the lack of a menu");
assert.match(
  formatModelList("opencode", null, discovered),
  /OpenCode Big Pickle/,
  "dynamic inventory is listed by the /model command",
);

console.log("slash-model.test.ts: ok");
