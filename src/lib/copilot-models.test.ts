import assert from "node:assert/strict";
import { normalizeCopilotModels } from "./copilot-models.ts";

const models = normalizeCopilotModels({
  models: [
    {
      id: "claude-opus-5",
      name: " Claude Opus 5 ",
      policy: { state: "enabled" },
      capabilities: { limits: { max_context_window_tokens: 1_000_000 } },
    },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "claude-opus-5", name: "duplicate", policy: { state: "enabled" } },
    { id: "disabled-model", name: "Disabled", policy: { state: "disabled" } },
    { id: "pending-model", name: "Pending", policy: { state: "unconfigured" } },
    { id: "--allow-all", name: "Flag shaped", policy: { state: "enabled" } },
    { id: "provider/model", name: "Namespaced twice", policy: { state: "enabled" } },
    { id: "claude-sonnet-5", name: "", policy: { state: "enabled" } },
  ],
});

assert.deepEqual(models, [
  { id: "github/auto", label: "Auto (Copilot picks)" },
  { id: "github/claude-opus-5", label: "Claude Opus 5" },
  { id: "github/gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "github/claude-sonnet-5", label: "Sonnet 5" },
]);
assert.equal(
  models.filter((model) => model.id === "github/claude-opus-5").length,
  1,
  "the authenticated inventory is deduplicated",
);

assert.deepEqual(normalizeCopilotModels({ models: [] }), [
  { id: "github/auto", label: "Auto (Copilot picks)" },
]);
assert.deepEqual(normalizeCopilotModels(null), []);
assert.deepEqual(normalizeCopilotModels({ models: "not-an-array" }), []);
assert.deepEqual(normalizeCopilotModels({ models: [{ id: "x".repeat(257), name: "too long" }] }), [
  { id: "github/auto", label: "Auto (Copilot picks)" },
]);

console.log("copilot-models.test.ts: ok");
