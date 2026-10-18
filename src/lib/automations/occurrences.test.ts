import assert from "node:assert/strict";
import test from "node:test";
import {
  attemptFailureLabel,
  attemptStateLabel,
  occurrenceGlyphStatus,
  occurrenceIsOpen,
  occurrenceStateLabel,
  parseOccurrenceResult,
  parseOccurrencesResult,
  projectOccurrence,
  projectOccurrenceDetail,
  runHasNoAttemptInProgress,
  runStatusLabel,
  OCCURRENCE_STATES,
  RUN_STATUSES,
  ATTEMPT_STATES,
} from "./occurrences.ts";

// Shapes recorded from the released Coven 0.4.10 daemon: a Run now whose
// runtime binary was missing, held open for an operator retry.
const SPAWN_FAILURE = "failed to spawn harness `coven-code` in piped mode: No such file or directory (os error 2)";
const wireOccurrence = {
  automationId: "occprobe", automationRevision: 2, createdAt: "2026-10-18T08:31:46.886Z",
  definitionDigest: "02b20ea2b1b73c3d86e8c1a2e9adb5b5571ea61f61f06eece80c04e91263b80e",
  failureReason: `${SPAWN_FAILURE}; held for an operator retry until the run's deadline`,
  fenceGeneration: 1, id: "occ-3ef12c9439ef478aacc4e863682088a7", kind: "manual", leaseExpiresAt: null,
  leaseOwner: "scheduler-instance-7", scheduledFor: "2026-10-18T08:31:46.886755000Z", schedulerGeneration: null,
  state: "claimed", updatedAt: "2026-10-18T08:31:47.199Z",
};
const wireAttempt = {
  adoptionKey: "automation:run-0ce1422cb4c24b87b33dfd1834a3edf7:1", attemptNumber: 1, dispatchGeneration: 1,
  failureClass: "runtime_unavailable", id: "attempt-run-0ce1422cb4c24b87b33dfd1834a3edf7-1",
  notBefore: "2026-10-18T08:31:46.897Z", occurrenceFenceGeneration: 1, occurrenceId: wireOccurrence.id,
  openedAt: "2026-10-18T08:31:46.897Z", priorAttemptNumber: null, priorDisposition: null, retryClassification: "initial",
  runId: "run-0ce1422cb4c24b87b33dfd1834a3edf7", sessionId: null, settledAt: "2026-10-18T08:31:47.199Z",
  state: "failed", stateReason: SPAWN_FAILURE,
};
const wireRun = {
  attempts: [wireAttempt], authorityProfile: null, automationId: "occprobe", automationRevision: 2,
  definitionDigest: wireOccurrence.definitionDigest, exitCode: null, familiarId: null, finishedAt: null,
  id: "run-0ce1422cb4c24b87b33dfd1834a3edf7", logJson: "{\"secret\":\"log text\"}", occurrenceId: wireOccurrence.id,
  outputCommit: null, receiptId: null, runtime: "coven-code", sessionId: "session-2aaabc1cef394d7ea0da9a6961cdf966",
  startedAt: "2026-10-18T08:31:46.897Z", status: "running", timeoutAt: "2026-10-18T08:36:46.897Z",
};

test("an occurrence keeps only bounded facts: reasons, lease owners and digests stay in the daemon", () => {
  const projected = projectOccurrence(wireOccurrence);
  assert.deepEqual(projected, {
    id: wireOccurrence.id, automationRevision: 2, scheduledFor: "2026-10-18T08:31:46.886Z", kind: "manual",
    state: "claimed", fenceGeneration: 1, leaseExpiresAt: null, reasonRecorded: true,
    createdAt: "2026-10-18T08:31:46.886Z", updatedAt: "2026-10-18T08:31:47.199Z",
  });
  assert.doesNotMatch(JSON.stringify(projected), /spawn|scheduler-instance|02b20ea2/);
});

test("a run and its attempts keep their own states; logs, reasons and adoption keys are dropped", () => {
  const detail = projectOccurrenceDetail({ ...wireOccurrence, runs: [wireRun], runsTruncated: false });
  assert.ok(detail);
  const [run] = detail.runs;
  assert.equal(run.status, "running");
  assert.equal(run.timeoutAt, "2026-10-18T08:36:46.897Z");
  assert.equal(run.sessionId, "session-2aaabc1cef394d7ea0da9a6961cdf966");
  assert.equal(run.receiptRecorded, false);
  assert.deepEqual(run.attempts[0], {
    id: wireAttempt.id, attemptNumber: 1, state: "failed", failureClass: "runtime_unavailable", retryClassification: "initial",
    priorDisposition: null, dispatchGeneration: 1, notBefore: "2026-10-18T08:31:46.897Z", openedAt: "2026-10-18T08:31:46.897Z",
    settledAt: "2026-10-18T08:31:47.199Z", reasonRecorded: true,
  });
  assert.doesNotMatch(JSON.stringify(detail), /spawn|secret|log text|automation:run-|authorityProfile/);
  // Three facts, three labels: never one spinner.
  assert.deepEqual([occurrenceStateLabel(detail.state), runStatusLabel(run.status), attemptStateLabel(run.attempts[0].state)],
    ["Claimed", "Running", "Failed"]);
  assert.equal(attemptFailureLabel("runtime_unavailable"), "Runtime unavailable");
  assert.equal(runHasNoAttemptInProgress(run), true);
});

test("an attempt still dispatching is in progress, and a finished run is not open", () => {
  const dispatching = projectOccurrenceDetail({
    ...wireOccurrence,
    runs: [{ ...wireRun, attempts: [{ ...wireAttempt, state: "dispatching", settledAt: null, failureClass: null }] }],
    runsTruncated: false,
  });
  assert.equal(runHasNoAttemptInProgress(dispatching!.runs[0]), false);
  const finished = projectOccurrenceDetail({ ...wireOccurrence, runs: [{ ...wireRun, finishedAt: "2026-10-18T08:36:46.897Z" }], runsTruncated: false });
  assert.equal(runHasNoAttemptInProgress(finished!.runs[0]), false);
});

test("states Cave does not know read as unrecognized, and unknown occurrence states stay open", () => {
  const projected = projectOccurrence({ ...wireOccurrence, state: "teleporting", kind: "webhook" });
  assert.equal(projected?.state, "unrecognized");
  assert.equal(projected?.kind, "other");
  assert.equal(occurrenceIsOpen("unrecognized"), true);
  assert.equal(occurrenceIsOpen("succeeded"), false);
  assert.equal(occurrenceGlyphStatus("unrecognized"), "unknown");
});

test("every state has a distinct label within its own vocabulary", () => {
  for (const [states, label] of [[OCCURRENCE_STATES, occurrenceStateLabel], [RUN_STATUSES, runStatusLabel], [ATTEMPT_STATES, attemptStateLabel]] as const) {
    const labels = states.map((state) => (label as (value: string) => string)(state));
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(labels.every((text) => typeof text === "string" && text.length > 0));
  }
  assert.notEqual(occurrenceGlyphStatus("recovery_required"), occurrenceGlyphStatus("claimed"));
});

test("malformed occurrences fail the projection instead of rendering partial facts", () => {
  for (const bad of [
    { ...wireOccurrence, id: "has spaces" },
    { ...wireOccurrence, automationRevision: 0 },
    { ...wireOccurrence, scheduledFor: "yesterday" },
    { ...wireOccurrence, fenceGeneration: -1 },
    null,
  ]) assert.equal(projectOccurrence(bad), undefined);
  assert.equal(projectOccurrenceDetail({ ...wireOccurrence, runs: [{ ...wireRun, runtime: "two words" }], runsTruncated: false }), undefined);
  assert.equal(projectOccurrenceDetail({ ...wireOccurrence, runs: [wireRun] }), undefined, "runsTruncated is required");
});

test("Cave's own answers are re-validated in the browser", () => {
  const occurrence = projectOccurrence(wireOccurrence)!;
  const page = { kind: "available", readAt: "2026-10-18T08:32:00.000Z", occurrences: [occurrence], nextCursor: "next-page" };
  assert.deepEqual(parseOccurrencesResult(page), page);
  assert.equal(parseOccurrencesResult({ ...page, occurrences: [occurrence, occurrence] }).kind, "unavailable", "duplicate ids");
  assert.equal(parseOccurrencesResult({ ...page, nextCursor: "" }).kind, "unavailable");
  assert.equal(parseOccurrencesResult({ ...page, occurrences: Array.from({ length: 11 }, (_, index) => ({ ...occurrence, id: `occ-${index}` })) }).kind, "unavailable");
  assert.deepEqual(parseOccurrencesResult({ kind: "unsupported" }), { kind: "unsupported" });
  assert.deepEqual(parseOccurrencesResult("nope"), { kind: "unavailable" });

  const detail = projectOccurrenceDetail({ ...wireOccurrence, runs: [wireRun], runsTruncated: false })!;
  const answer = { kind: "available", readAt: "2026-10-18T08:32:00.000Z", occurrence: detail };
  assert.deepEqual(parseOccurrenceResult(answer), answer);
  assert.deepEqual(parseOccurrenceResult({ ...answer, occurrence: null }), { ...answer, occurrence: null });
  assert.equal(parseOccurrenceResult({ ...answer, occurrence: { ...detail, runs: "x" } }).kind, "unavailable");
  // The browser never trusts a reason that sneaks through: only the flag survives.
  const reparsed = parseOccurrenceResult({ ...answer, occurrence: { ...detail, failureReason: "leak", reasonRecorded: true } });
  assert.doesNotMatch(JSON.stringify(reparsed), /leak/);
});
