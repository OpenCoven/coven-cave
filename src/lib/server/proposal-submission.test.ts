import assert from "node:assert/strict";
import test from "node:test";
import { forwardProposalSubmission } from "./proposal-submission.ts";
import type { DaemonRequest } from "../coven-daemon.ts";

const input = { familiarId: "sage", target: "notes/today.md", contents: "synthetic" };
test("fixture mode never contacts a daemon", async () => {
  const outcome = await forwardProposalSubmission(input, { fixtureMode: true, call: async () => { throw new Error("must not call"); } });
  assert.deepEqual(outcome, { kind: "unavailable" });
});
test("submission forwards once with bounded transport and no credential or authority fields", async () => {
  const requests: DaemonRequest[] = [];
  const outcome = await forwardProposalSubmission(input, { fixtureMode: false, call: async request => {
    requests.push(request);
    return { ok: true, status: 202, data: { ok: true, disposition: "staged" } };
  } });
  assert.deepEqual(outcome, { kind: "staged", proposalId: null });
  assert.deepEqual(requests, [{ method: "POST", path: "/api/v1/familiars/sage/edits",
    body: { edits: [{ target: input.target, contents: input.contents }] }, retryTransportFailure: false,
    timeoutMs: 15_000, hardTimeoutMs: 15_000, maxResponseBytes: 256 * 1024 }]);
});
test("lost responses are unknown and never retried", async () => {
  let calls = 0;
  const outcome = await forwardProposalSubmission(input, { fixtureMode: false, call: async () => {
    calls++; throw new Error("lost after write");
  } });
  assert.equal(calls, 1);
  assert.deepEqual(outcome, { kind: "unknown" });
});
