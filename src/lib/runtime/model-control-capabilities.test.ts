import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appliedModelControls,
  modelControlCapabilities,
  modelControlInputWithLegacy,
  promptOnlyModelControls,
  validateModelControlValues,
  type ModelControlCapability,
} from "./model-control-capabilities.ts";

test("OpenAI GPT-5 through Hermes declares only its documented native controls", () => {
  const capabilities = modelControlCapabilities("hermes", "openai/gpt-5.6-sol");
  assert.deepEqual(capabilities.map((capability) => [capability.family, capability.delivery, capability.parameter]), [
    ["reasoning", "native-provider", "reasoning.effort"],
    ["verbosity", "native-provider", "text.verbosity"],
  ]);
});

test("runtime aliases resolve through the same canonical capability identity", () => {
  assert.deepEqual(
    modelControlCapabilities("hermes-agent", "openai/gpt-5.6-sol").map((capability) => capability.family),
    ["reasoning", "verbosity"],
    "Hermes package aliases retain the selected model controls",
  );
  assert.deepEqual(
    modelControlCapabilities("claude-code", "anthropic/claude-sonnet-4-6").map((capability) => capability.family),
    ["reasoning"],
    "Claude binary aliases retain prompt-only reasoning guidance",
  );
});

test("unknown models expose no invented global thinking or speed selector", () => {
  assert.deepEqual(modelControlCapabilities("grok", "grok-4.5"), []);
  assert.deepEqual(
    modelControlCapabilities("hermes", "openai/gpt-5-unverified"),
    [],
    "provider-looking custom Hermes ids must not manufacture native capabilities",
  );
  assert.deepEqual(
    modelControlCapabilities("claude", "anthropic/claude-preview-foo"),
    [],
    "custom Claude ids must not manufacture prompt guidance capabilities",
  );
  assert.deepEqual(
    modelControlCapabilities("hermes", "openai/codex-auto-review"),
    [],
    "catalog entries without verified GPT-5 Responses support must not expose native controls",
  );
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
  assert.deepEqual(
    validateModelControlValues(
      capabilities,
      modelControlInputWithLegacy(capabilities, { reasoningEffort: "medium", responseSpeed: "fast" }, undefined),
    ),
    { values: { reasoning: "medium" }, rejected: [] },
    "legacy reasoning migrates only through selected-model capabilities; legacy speed does not",
  );
  assert.deepEqual(
    modelControlInputWithLegacy(
      capabilities,
      { reasoningEffort: "low" },
      { reasoning: "high" },
    ),
    { reasoning: "high" },
    "explicit typed controls override legacy fields",
  );
  assert.deepEqual(
    validateModelControlValues(capabilities, ["reasoning"]),
    { values: {}, rejected: ["modelControls"] },
    "a present malformed payload fails closed instead of silently dropping controls",
  );
});

test("prompt-only controls remain distinct from native delivery", () => {
  const capabilities = modelControlCapabilities("claude", "anthropic/claude-sonnet-4-6");
  const validated = validateModelControlValues(capabilities, { reasoning: "medium" });
  assert.deepEqual(promptOnlyModelControls(capabilities, validated.values), { reasoning: "medium" });
  assert.deepEqual(
    appliedModelControls(capabilities, validated.values),
    {},
    "prompt guidance is never reported as provider-applied",
  );
});

test("capability declarations can reject incompatible control families", () => {
  const capabilities: ModelControlCapability[] = [
    {
      family: "reasoning",
      label: "Reasoning",
      delivery: "prompt-only",
      values: [{ value: "low", label: "Low" }],
      validation: { incompatibleWith: ["verbosity"] },
    },
    {
      family: "verbosity",
      label: "Verbosity",
      delivery: "prompt-only",
      values: [{ value: "low", label: "Low" }],
      validation: {},
    },
  ];
  assert.deepEqual(
    validateModelControlValues(capabilities, { reasoning: "low", verbosity: "low" }),
    { values: {}, rejected: ["reasoning", "verbosity"] },
  );
});
