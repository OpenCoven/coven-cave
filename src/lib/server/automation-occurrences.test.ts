import assert from "node:assert/strict";
import test from "node:test";
import { CovenClientError, normalizeCovenError } from "@opencoven/coven-client";
import { readAutomationOccurrence, readAutomationOccurrences } from "./automation-occurrences.ts";

const signal = new AbortController().signal;
const failure = (code: string) => new CovenClientError(normalizeCovenError({ code }, "automations.occurrenceHistory"));

// Recorded from the released Coven 0.4.10 daemon (a Run now with no runtime binary).
const occurrence = {
  automationId: "nightly", automationRevision: 2, createdAt: "2026-10-18T08:31:46.886Z",
  definitionDigest: "02b20ea2b1b73c3d86e8c1a2e9adb5b5571ea61f61f06eece80c04e91263b80e",
  failureReason: "failed to spawn harness `coven-code`; held for an operator retry until the run's deadline",
  fenceGeneration: 1, id: "occ-3ef12c9439ef478aacc4e863682088a7", kind: "manual", leaseExpiresAt: null,
  leaseOwner: null, scheduledFor: "2026-10-18T08:31:46.886755000Z", schedulerGeneration: null, state: "claimed",
  updatedAt: "2026-10-18T08:31:47.199Z",
};
const run = {
  attempts: [{
    adoptionKey: "automation:run-1:1", attemptNumber: 1, dispatchGeneration: 1, failureClass: "runtime_unavailable",
    id: "attempt-run-1-1", notBefore: "2026-10-18T08:31:46.897Z", occurrenceFenceGeneration: 1, occurrenceId: occurrence.id,
    openedAt: "2026-10-18T08:31:46.897Z", priorAttemptNumber: null, priorDisposition: null, retryClassification: "initial",
    runId: "run-1", sessionId: null, settledAt: "2026-10-18T08:31:47.199Z", state: "failed", stateReason: "failed to spawn harness",
  }],
  authorityProfile: null, automationId: "nightly", automationRevision: 2, definitionDigest: null, exitCode: null,
  familiarId: null, finishedAt: null, id: "run-1", logJson: "{\"private\":true}", occurrenceId: occurrence.id,
  outputCommit: null, receiptId: null, runtime: "coven-code", sessionId: "session-1", startedAt: "2026-10-18T08:31:46.897Z",
  status: "running", timeoutAt: "2026-10-18T08:36:46.897Z",
};

function client(overrides: Partial<{ occurrenceHistory: (id: string, query: { limit?: number; cursor?: string }) => Promise<unknown>; getOccurrence: (id: string) => Promise<unknown> }>) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      occurrenceHistory: async (id: string, query: { limit?: number; cursor?: string }) => {
        calls.push(["history", id, query]);
        return overrides.occurrenceHistory ? overrides.occurrenceHistory(id, query) : Promise.reject(failure("unavailable"));
      },
      getOccurrence: async (id: string) => {
        calls.push(["get", id]);
        return overrides.getOccurrence ? overrides.getOccurrence(id) : Promise.reject(failure("unavailable"));
      },
    } as never,
  };
}

test("one bounded page of occurrences, newest first, with only the facts Cave shows", async () => {
  const { client: reader, calls } = client({
    occurrenceHistory: async () => ({ automationId: "nightly", data: [occurrence], cursor: { hasMore: true, next: "page-2" } }),
  });
  const result = await readAutomationOccurrences("nightly", new URLSearchParams(), signal, reader);
  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.deepEqual(calls, [["history", "nightly", { limit: 10 }]]);
  assert.equal(result.nextCursor, "page-2");
  assert.equal(result.occurrences[0].state, "claimed");
  assert.equal(result.occurrences[0].reasonRecorded, true);
  assert.doesNotMatch(JSON.stringify(result), /spawn|02b20ea2/);
});

test("a cursor continues the walk, and a refused cursor is the request's fault", async () => {
  const { client: reader, calls } = client({ occurrenceHistory: async () => { throw failure("invalid_options"); } });
  const result = await readAutomationOccurrences("nightly", new URLSearchParams({ cursor: "stale-cursor" }), signal, reader);
  assert.deepEqual(result, { kind: "invalid" });
  assert.deepEqual(calls, [["history", "nightly", { limit: 10, cursor: "stale-cursor" }]]);
});

test("invalid ids, extra or repeated parameters and oversized cursors never reach the daemon", async () => {
  for (const [id, query] of [
    ["has spaces", ""], ["", ""], ["nightly", "after=1"], ["nightly", "cursor=a&cursor=b"], ["nightly", "cursor="], ["nightly", `cursor=${"x".repeat(513)}`],
  ]) {
    const { client: reader, calls } = client({});
    assert.deepEqual(await readAutomationOccurrences(id, new URLSearchParams(query), signal, reader), { kind: "invalid" });
    assert.equal(calls.length, 0);
  }
});

test("a page that cannot be projected, or claims more without a cursor, fails as a whole", async () => {
  for (const page of [
    { automationId: "nightly", data: [{ ...occurrence, scheduledFor: "soon" }], cursor: { hasMore: false } },
    { automationId: "nightly", data: [{ ...occurrence, automationId: "other" }], cursor: { hasMore: false } },
    { automationId: "nightly", data: [occurrence], cursor: { hasMore: true } },
  ]) {
    const { client: reader } = client({ occurrenceHistory: async () => page });
    assert.deepEqual(await readAutomationOccurrences("nightly", new URLSearchParams(), signal, reader), { kind: "unavailable" });
  }
});

test("daemon refusals map to unsupported and unavailable without raw detail", async () => {
  for (const [code, kind] of [["capability_unsupported", "unsupported"], ["unsupported_operation", "unsupported"], ["unavailable", "unavailable"], ["timeout", "unavailable"]]) {
    const { client: reader } = client({ occurrenceHistory: async () => { throw failure(code); } });
    assert.deepEqual(await readAutomationOccurrences("nightly", new URLSearchParams(), signal, reader), { kind });
  }
});

test("one occurrence with its runs and attempts, from one producer snapshot", async () => {
  const { client: reader, calls } = client({ getOccurrence: async () => ({ occurrence: { ...occurrence, runs: [run], runsTruncated: false } }) });
  const result = await readAutomationOccurrence("nightly", occurrence.id, signal, reader);
  assert.equal(result.kind, "available");
  if (result.kind !== "available" || !result.occurrence) return assert.fail("expected an occurrence");
  assert.deepEqual(calls, [["get", occurrence.id]]);
  assert.equal(result.occurrence.runs[0].status, "running");
  assert.equal(result.occurrence.runs[0].attempts[0].failureClass, "runtime_unavailable");
  assert.doesNotMatch(JSON.stringify(result), /spawn|private|automation:run-1/);
});

test("an occurrence of another automation is absent here, and mismatched runs fail closed", async () => {
  const other = client({ getOccurrence: async () => ({ occurrence: { ...occurrence, automationId: "weekly", runs: [], runsTruncated: false } }) });
  const absent = await readAutomationOccurrence("nightly", occurrence.id, signal, other.client);
  assert.equal(absent.kind === "available" && absent.occurrence, null);
  const missing = client({ getOccurrence: async () => ({ occurrence: null }) });
  const none = await readAutomationOccurrence("nightly", occurrence.id, signal, missing.client);
  assert.equal(none.kind === "available" && none.occurrence, null);
  const crossed = client({ getOccurrence: async () => ({ occurrence: { ...occurrence, runs: [{ ...run, automationId: "weekly" }], runsTruncated: false } }) });
  assert.deepEqual(await readAutomationOccurrence("nightly", occurrence.id, signal, crossed.client), { kind: "unavailable" });
});

test("an occurrence id outside Coven's grammar never reaches the daemon", async () => {
  for (const id of ["", "../etc", "has space", "x".repeat(201)]) {
    const { client: reader, calls } = client({});
    assert.deepEqual(await readAutomationOccurrence("nightly", id, signal, reader), { kind: "invalid" });
    assert.equal(calls.length, 0);
  }
});
