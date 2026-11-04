import assert from "node:assert/strict";
import test from "node:test";

import { canonicalModelId } from "./canonical-model-id.ts";
import {
  EXECUTION_ATTEMPT_SCHEMA_VERSION,
  buildFamiliarExecutionAnalytics,
  normalizeExecutionAttemptSnapshot,
  type ExecutionAttemptSnapshotV1,
} from "./familiar-execution-analytics.ts";

test("spellings of one model fold to one id, with the provider kept apart", () => {
  const cases: [string, string, string | null][] = [
    ["anthropic/claude-opus-5-5", "claude-opus-5-5", "anthropic"],
    ["claude-opus-5-5", "claude-opus-5-5", null],
    ["Claude-Opus-5.5", "claude-opus-5-5", null],
    ["claude-opus-5-5[1m]", "claude-opus-5-5", null],
    ["claude-fable-5-1", "claude-fable-5-1", null],
    ["claude-fable-5.1", "claude-fable-5-1", null],
    ["openai/gpt-6-astra", "gpt-6-astra", "openai"],
    ["gpt-6-astra", "gpt-6-astra", null],
    ["openAI-gpt-6-astra", "gpt-6-astra", "openai"],
    ["github/gpt-6-astra", "gpt-6-astra", "github"],
  ];
  for (const [raw, id, provider] of cases) {
    assert.deepEqual(canonicalModelId(raw), { id, provider }, raw);
  }
});

test("a different version stays a different model", () => {
  assert.equal(canonicalModelId("anthropic/claude-opus-5").id, "claude-opus-5");
  assert.notEqual(canonicalModelId("claude-opus-5").id, canonicalModelId("claude-opus-5-5").id);
});

function attempt(index: number, model: string, status: "succeeded" | "error"): ExecutionAttemptSnapshotV1 {
  const value = normalizeExecutionAttemptSnapshot({
    schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
    attemptId: `ea1_${index}`,
    familiarId: "cody",
    sessionId: `session-${index}`,
    turnId: `turn-${index}`,
    attemptNumber: 1,
    execution: { kind: "assistant-response", origin: "chat" },
    timing: { completedAt: "2026-10-30T09:00:00.000Z" },
    outcome: { status },
    models: { confirmed: model },
    provenance: { source: "live", sourceSchema: "execution-attempt-v1", capturedAt: "2026-10-30T09:00:00.000Z" },
    coverage: { knownFields: ["confirmedModel"] },
  });
  assert.ok(value, model);
  return value;
}

test("the models slice gives one row per real model and the rows add up to the total (#6357)", () => {
  const spellings = [
    "anthropic/claude-opus-5-5",
    "claude-opus-5-5",
    "anthropic/claude-opus-5",
    "claude-fable-5-1",
    "claude-fable-5.1",
    "openai/gpt-6-astra",
    "gpt-6-astra",
    "openAI-gpt-6-astra",
    "github/gpt-6-astra",
  ];
  const attempts = spellings.map((model, index) => attempt(index, model, index === 4 ? "error" : "succeeded"));
  const analytics = buildFamiliarExecutionAnalytics({
    familiarId: "cody",
    attempts,
    now: new Date("2026-10-31T00:00:00.000Z"),
  });
  const window = analytics.windows.all;
  const rows = new Map(window.models.map((row) => [row.key, row]));

  assert.deepEqual([...rows.keys()].sort(), ["claude-fable-5-1", "claude-opus-5", "claude-opus-5-5", "gpt-6-astra"]);
  assert.equal(window.models.reduce((sum, row) => sum + row.attempts, 0), window.attempts);
  assert.equal(rows.get("gpt-6-astra")?.attempts, 4);
  assert.deepEqual(rows.get("gpt-6-astra")?.providers, ["github", "openai"]);
  assert.deepEqual(rows.get("gpt-6-astra")?.rawIds, ["github/gpt-6-astra", "gpt-6-astra", "openAI-gpt-6-astra", "openai/gpt-6-astra"]);
  // The one failure is folded into fable's two attempts, not a lone "0% success" row.
  assert.equal(rows.get("claude-fable-5-1")?.attempts, 2);
  assert.equal(rows.get("claude-fable-5-1")?.successRate, 0.5);
});
