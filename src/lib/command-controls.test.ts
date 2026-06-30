import assert from "node:assert/strict";
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  commandControlPayload,
  normalizeCommandControls,
  runtimeModelSelectLabel,
} from "./command-controls.ts";

assert.deepEqual(
  COMMAND_THINKING_OPTIONS.map((option) => option.value),
  ["low", "medium", "high"],
  "thinking options should preserve the Chat composer contract",
);

assert.deepEqual(
  COMMAND_RESPONSE_SPEED_OPTIONS.map((option) => option.value),
  ["fast", "balanced", "careful"],
  "response speed options should preserve the Chat composer contract",
);

assert.deepEqual(
  normalizeCommandControls({ thinkingEffort: "wild", responseSpeed: "slow" }),
  COMMAND_CONTROL_DEFAULTS,
  "invalid stored controls should fall back to defaults",
);

assert.deepEqual(
  normalizeCommandControls({ thinkingEffort: "medium", responseSpeed: "balanced" }),
  { thinkingEffort: "medium", responseSpeed: "balanced" },
  "valid controls should be preserved",
);

assert.deepEqual(
  commandControlPayload({ thinkingEffort: "low", responseSpeed: "careful" }),
  { reasoningEffort: "low", responseSpeed: "careful" },
  "send payload maps thinkingEffort to reasoningEffort",
);

assert.equal(runtimeModelSelectLabel([]), "Runtime managed", "empty model catalogs are runtime-managed");
assert.equal(runtimeModelSelectLabel([{ id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" }]), "Model");

assert.equal(PERMISSION_MODES.find((m) => m.value === "full")?.value, "full", "full access is a permission mode");
assert.equal(DEFAULT_PERMISSION_MODE, "full", "defaults to full access (matches Codex reference)");
assert.equal(PERMISSION_MODES.length, 3, "three permission modes");

console.log("command-controls tests passed");
