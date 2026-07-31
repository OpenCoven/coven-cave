import assert from "node:assert/strict";
import { test } from "node:test";
import {
  modelControlCapabilities,
  promptOnlyModelControls,
  validateModelControlValues,
} from "./model-control-capabilities.ts";

test("OpenAI GPT-5 through Hermes declares only its documented native controls", () => {
  const capabilities = modelControlCapabilities("hermes", "openai/gpt-5.6-sol");
  assert.deepEqual(capabilities.map((capability) => [capability.family, capability.delivery, capability.parameter]), [
    ["reasoning", "native-provider", "reasoning.effort"],
    ["verbosity", "native-provider", "text.verbosity"],
  ]);
});

test("unknown models expose no invented global thinking or speed selector", () => {
  assert.deepEqual(modelControlCapabilities("grok", "grok-4.5"), []);
});

test("controls are accepted only for the selected capability values", () => {
  const capabilities = modelControlCapabilities("hermes", "openai/gpt-5.6-sol");
  assert.deepEqual(
    validateModelControlValues(capabilities, { reasoning: "high", verbosity: "low" }),
    { values: { reasoning: "high", verbosity: "low" }, rejected: [] },
  );
  assert.deepEqual(
    validateModelControlValues(capabilities, { reasoning: "xhigh", performance: "fast" }),
    { values: {}, rejected: ["reasoning", "performance"] },
  );
});

test("prompt-only controls remain distinct from native delivery", () => {
  const capabilities = modelControlCapabilities("claude", "anthropic/claude-sonnet-4-6");
  const validated = validateModelControlValues(capabilities, { reasoning: "medium" });
  assert.deepEqual(promptOnlyModelControls(capabilities, validated.values), { reasoning: "medium" });
});
