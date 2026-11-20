import assert from "node:assert/strict";
import { responseRunDetails, runDetailsLineTexts, runDetailsSummaryText } from "./chat-run-details.ts";

// #6026: the per-turn trail folds into one disclosure. Its closed line names
// the runtime, the model state when it is not applied, and how many facts the
// runtime did not report or confirm; the open list keeps every fact.
// #6039: one Model row carries the model fact, and the activity rows read in
// plain words.

assert.equal(responseRunDetails(undefined), null, "no metadata, no disclosure");

const base = { familiarId: "astra", harness: "claude", model: "anthropic/claude-fable-5-1", runtime: "local:/repo" };

{
  // The screenshot that opened #6026: a claude turn whose model is saved but
  // not confirmed, on the Coven relay with reasoning support unverified.
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
  // One Model row says selection, state and source; the pending reason
  // sentence restated the state and is gone.
  assert.deepEqual(runDetailsLineTexts(details), [
    "Runtime: claude 2.1.289",
    "Model: anthropic/claude-fable-5-1 · pending confirmation · familiar default",
    "Runtime path: Coven relay",
    "Tool details: available",
    "Reasoning summaries: not verified on this path",
  ]);
  // The unconfirmed Model row is the gap; the state is its own summary fact.
  assert.deepEqual(
    details.groups.flatMap((group) => group.lines.filter((line) => line.gap).map((line) => line.label)),
    ["Model", "Reasoning summaries"],
  );
}

{
  // A fully confirmed turn: the reported model, no state or source noise, no
  // count.
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
  assert.deepEqual(runDetailsLineTexts(details), [
    "Runtime: claude 2.1.289",
    "Model: claude-opus-5-5 · reported by the runtime",
    "Applied: reasoning high",
    "Runtime path: Direct runtime",
    "Tool details: available",
    "Reasoning summaries: available",
  ]);
}

{
  // The runtime reported a different model than the one selected: both show.
  const details = responseRunDetails({
    ...base,
    runtimeIdentity: { schemaVersion: 1, harness: "claude", version: "2.1.289", model: "claude-sonnet-5-5" },
    desiredModel: "anthropic/claude-fable-5-1",
    modelApplicationState: "applied",
  });
  assert.ok(details);
  assert.deepEqual(runDetailsLineTexts(details).slice(1, 3), [
    "Model: claude-sonnet-5-5 · reported by the runtime",
    "Selected model: anthropic/claude-fable-5-1",
  ]);
}

{
  // No runtime report at all (a legacy transcript): the recorded model is
  // labeled as such and never promoted to a reported model; the selection
  // shows because it differs; every unreported fact counts.
  const details = responseRunDetails({ ...base, confirmedModel: "legacy-inferred-model", modelApplicationState: "applied" });
  assert.ok(details);
  assert.equal(runDetailsSummaryText(details), "Run details · runtime not recorded · 2 unverified");
  assert.deepEqual(runDetailsLineTexts(details), [
    "Runtime: Identity not recorded in this response",
    "Recorded model: legacy-inferred-model",
    "Selected model: anthropic/claude-fable-5-1",
    "Activity: not recorded for this turn",
  ]);
}

{
  // Controls: a forwarded-but-unconfirmed family is a gap; a rejected family
  // gets its own count, including one rejected without a request value. An
  // unsupported model keeps its reason, because the phrase alone does not
  // say why; the explicit runtime-default request shows because it differs
  // from the resolved selection; the forwarded id shows because it differs.
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
    modelApplicationReason: "Runtime rejected the selected model.",
    requestedControls: { reasoning: "high", performance: "fast" },
    forwardedControls: { reasoning: "high" },
    rejectedControlFamilies: ["performance", "verbosity"],
  });
  assert.ok(details);
  // Version not reported, model unconfirmed, reasoning forwarded, path unknown.
  assert.equal(runDetailsSummaryText(details), "Run details · codex · model unsupported · 4 unverified · 2 rejected");
  assert.deepEqual(runDetailsLineTexts(details), [
    "Runtime: codex · Version not reported",
    "Model: openai/gpt-6-astra · not supported by the runtime",
    "Requested model: Runtime default",
    "Forwarded model: gpt-6-astra",
    "Runtime rejected the selected model.",
    "Forwarded — not confirmed: reasoning high",
    "Rejected: performance fast",
    "Rejected: verbosity",
    "Runtime path: Not yet selected",
    "Tool details: not available on this path",
    "Reasoning summaries: off for this turn",
  ]);
  const note = details.groups.find((group) => group.id === "model")?.lines.at(-1);
  assert.equal(note?.label, undefined, "the rejection reason is a note, not a labeled row");
  assert.equal(details.groups.find((group) => group.id === "activity")?.lines.filter((line) => line.gap).length, 1,
    "unsupported and disabled are facts, only an unknown state is a gap");
}

{
  // A request that matches the selection, and a pending reason, add no rows.
  const details = responseRunDetails({
    ...base,
    runtimeIdentity: { schemaVersion: 1, harness: "claude", version: "2.1.289", model: null },
    requestedModel: "anthropic/claude-fable-5-1",
    desiredModel: "anthropic/claude-fable-5-1",
    modelApplicationState: "saved",
    modelSource: "next-message",
    modelApplicationReason: "Selected for the next message only.",
  });
  assert.ok(details);
  assert.deepEqual(runDetailsLineTexts(details).slice(0, 2), [
    "Runtime: claude 2.1.289",
    "Model: anthropic/claude-fable-5-1 · saved, waiting for the runtime · this message only",
  ]);
  assert.equal(details.groups.find((group) => group.id === "model")?.lines.length, 1);
}

console.log("chat-run-details.test.ts: ok");
