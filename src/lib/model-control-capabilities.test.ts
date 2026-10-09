import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVEN_SPEED_CONTROL_PARAMETER,
  appliedModelControls,
  modelControlCapabilities,
  modelControlInputWithLegacy,
  promptOnlyModelControls,
  validateModelControlValues,
  withForwardableRuntimeCliControls,
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
    modelControlCapabilities("claude-code", "anthropic/claude-sonnet-4-6").map((capability) => [capability.family, capability.delivery]),
    [["reasoning", "prompt-only"], ["performance", "runtime-cli"]],
    "Claude binary aliases retain prompt-only reasoning guidance and the runtime Speed flag",
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
    modelControlCapabilities("claude", "anthropic/claude-preview-foo").map((capability) => capability.family),
    ["performance"],
    "custom Claude ids must not manufacture prompt guidance capabilities; the CLI-level Speed flag is model-independent",
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
  const claudeCapabilities = modelControlCapabilities("claude", "");
  assert.deepEqual(
    validateModelControlValues(
      claudeCapabilities,
      modelControlInputWithLegacy(claudeCapabilities, { responseSpeed: "fast" }, undefined),
    ),
    { values: {}, rejected: [] },
    "the legacy responseSpeed default never becomes a Speed pick: old clients send it on every turn and it would pin Claude to its lowest effort",
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

test("Claude's Speed control is coven run --speed, offered for the runtime default and gated on the CLI probe", () => {
  const capabilities = modelControlCapabilities("claude", "");
  assert.deepEqual(
    capabilities.map((capability) => [capability.family, capability.delivery, capability.parameter]),
    [["reasoning", "prompt-only", undefined], ["performance", "runtime-cli", COVEN_SPEED_CONTROL_PARAMETER]],
    "the runtime default still gets thinking guidance, and Speed rides the daemon's --speed flag",
  );
  const speed = capabilities.find((capability) => capability.family === "performance");
  assert.deepEqual(
    speed?.values.map((option) => option.value),
    ["fast", "balanced", "thorough"],
    "Speed values are coven run --speed's own vocabulary, which the daemon maps onto Claude --effort low|medium|high",
  );
  assert.deepEqual(
    withForwardableRuntimeCliControls(capabilities, { speed: false }).map((capability) => capability.family),
    ["reasoning"],
    "a CLI that does not advertise --speed drops the control instead of rendering a chip the send route would reject",
  );
  assert.deepEqual(
    withForwardableRuntimeCliControls(capabilities, { speed: true }).map((capability) => capability.family),
    ["reasoning", "performance"],
  );
  const validated = validateModelControlValues(capabilities, { performance: "thorough" });
  assert.deepEqual(validated, { values: { performance: "thorough" }, rejected: [] });
  assert.deepEqual(
    appliedModelControls(capabilities, validated.values),
    { performance: "thorough" },
    "a forwarded runtime flag is reported as applied, unlike prompt guidance",
  );
  assert.deepEqual(promptOnlyModelControls(capabilities, validated.values), {});
  assert.deepEqual(modelControlCapabilities("codex", ""), [], "no other runtime borrows the Claude Speed mapping");
});
