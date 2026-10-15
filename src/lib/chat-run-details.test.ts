import assert from "node:assert/strict";
import { responseRunDetails, runDetailsLineTexts, runDetailsSummaryText } from "./chat-run-details.ts";

// #6026: the per-turn trail folds into one disclosure. Its closed line names
// the runtime, the model state when it is not applied, and how many facts the
// runtime did not report or confirm; the open list keeps every line.

assert.equal(responseRunDetails(undefined), null, "no metadata, no disclosure");

const base = { familiarId: "astra", harness: "claude", model: "anthropic/claude-fable-5-1", runtime: "local:/repo" };

{
  // The screenshot that opened the issue: a claude turn whose model is saved
  // but not confirmed, on the Coven relay with reasoning support unverified.
  const details = responseRunDetails({
    ...base,
    runtimeIdentity: {
      schemaVersion: 1, harness: "claude", version: "2.1.289", model: null,
      activity: { schemaVersion: 1, path: "coven", tools: "supported", reasoning: "unknown" },
    },
    desiredModel: "anthropic/claude-fable-5-1",
    modelApplicationState: "pending",
    modelSource: "familiar-default",
    modelApplicationReason: "Cave saved the model intent and is waiting for runtime confirmation.",
  });
  assert.ok(details);
  assert.equal(runDetailsSummaryText(details), "Run details · claude 2.1.289 · model pending · 2 unverified");
  assert.deepEqual(details.groups.map((group) => group.id), ["runtime", "model", "activity"]);
  assert.deepEqual(runDetailsLineTexts(details), [
    "Runtime: claude 2.1.289",
    "Runtime-reported model: Unavailable",
    "Selected model: anthropic/claude-fable-5-1",
    "Model: pending",
    "Source: familiar-default",
    "Cave saved the model intent and is waiting for runtime confirmation.",
    "Runtime path: Coven relay",
    "Tool details: supported on this path",
    "Reasoning summaries: support unverified on this path",
  ]);
  // The gaps are the unreported model and the unverified reasoning support;
  // the pending state is its own summary fact, not a second count.
  assert.deepEqual(
    details.groups.flatMap((group) => group.lines.filter((line) => line.gap).map((line) => line.label)),
    ["Runtime-reported model", "Reasoning summaries"],
  );
  const note = details.groups.find((group) => group.id === "model")?.lines.at(-1);
  assert.equal(note?.label, undefined, "the application reason is a note, not a labeled row");
}

{
  // A fully confirmed turn: no state fact, no count.
  const details = responseRunDetails({
    ...base,
    runtimeIdentity: {
      schemaVersion: 1, harness: "claude", version: "2.1.289", model: "claude-opus-5-5",
      activity: { schemaVersion: 1, path: "direct", tools: "supported", reasoning: "supported" },
    },
    desiredModel: "claude-opus-5-5",
    modelApplicationState: "applied",
    modelSource: "session",
    requestedControls: { reasoning: "high" },
    appliedControls: { reasoning: "high" },
  });
  assert.ok(details);
  assert.equal(runDetailsSummaryText(details), "Run details · claude 2.1.289");
  assert.equal(details.unverified, 0);
  assert.equal(details.rejected, 0);
  assert.deepEqual(details.groups.find((group) => group.id === "controls")?.lines, [{ label: "Applied", value: "reasoning high" }]);
}

{
  // No runtime report at all (a legacy transcript): the recorded model is
  // labeled as such, nothing is promoted to the confirmed model, and every
  // unreported fact counts.
  const details = responseRunDetails({ ...base, confirmedModel: "legacy-inferred-model", modelApplicationState: "applied" });
  assert.ok(details);
  assert.equal(runDetailsSummaryText(details), "Run details · runtime not recorded · 3 unverified");
  assert.deepEqual(runDetailsLineTexts(details), [
    "Runtime: Identity not recorded in this response",
    "Runtime-reported model: Unavailable",
    "Selected model: anthropic/claude-fable-5-1",
    "Recorded model: legacy-inferred-model",
    "Activity support: Not recorded",
  ]);
}

{
  // Controls: a forwarded-but-unconfirmed family is a gap; a rejected family
  // gets its own count, including one rejected without a request value.
  const details = responseRunDetails({
    ...base,
    harness: "codex",
    runtimeIdentity: {
      schemaVersion: 1, harness: "codex", version: null, model: null,
      activity: { schemaVersion: 1, path: "unknown", tools: "unsupported", reasoning: "disabled" },
    },
    requestedModel: "",
    desiredModel: "openai/gpt-6-astra",
    forwardedModel: "gpt-6-astra",
    modelApplicationState: "unsupported",
    requestedControls: { reasoning: "high", performance: "fast" },
    forwardedControls: { reasoning: "high" },
    rejectedControlFamilies: ["performance", "verbosity"],
  });
  assert.ok(details);
  // Version not reported, model unavailable, reasoning forwarded, path unknown.
  assert.equal(runDetailsSummaryText(details), "Run details · codex · model unsupported · 4 unverified · 2 rejected");
  assert.deepEqual(runDetailsLineTexts(details), [
    "Runtime: codex · Version not reported",
    "Runtime-reported model: Unavailable",
    "Requested model: Runtime default",
    "Selected model: openai/gpt-6-astra",
    "Forwarded model: gpt-6-astra",
    "Model: unsupported",
    "Forwarded — not confirmed: reasoning high",
    "Rejected: performance fast",
    "Rejected: verbosity",
    "Runtime path: Not yet selected",
    "Tool details: not supported on this path",
    "Reasoning summaries: decoding disabled for this turn",
  ]);
  assert.equal(details.groups.find((group) => group.id === "activity")?.lines.filter((line) => line.gap).length, 1,
    "unsupported and disabled are facts, only an unknown state is a gap");
}

console.log("chat-run-details.test.ts: ok");
