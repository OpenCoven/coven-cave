import assert from "node:assert/strict";
import test from "node:test";
import { parseProposalSubmission, PROPOSAL_CONTENT_MAX_BYTES, submissionOutcome } from "./proposal-submission.ts";

const input = { familiarId: "sage", target: "notes/today.md", contents: "replacement" };
test("submission accepts a bounded whole-file replacement, including an empty file", () => {
  assert.deepEqual(parseProposalSubmission(input), input);
  assert.equal(parseProposalSubmission({ ...input, contents: "" })?.contents, "");
  assert.ok(parseProposalSubmission({ ...input, contents: "x".repeat(PROPOSAL_CONTENT_MAX_BYTES) }));
  assert.equal(parseProposalSubmission({ ...input, contents: "é".repeat(PROPOSAL_CONTENT_MAX_BYTES) }), null);
});
test("submission rejects routing escapes, unknown authority fields and malformed inputs", () => {
  for (const target of ["", "/etc/file", "../file", "notes/../file", "notes//file", "notes/./file", "C:file", "a\\b", "a\0b"]) {
    assert.equal(parseProposalSubmission({ ...input, target }), null, target);
  }
  for (const familiarId of ["", ".", "..", "sage/edits", "sage?x", "sage#x"]) {
    assert.equal(parseProposalSubmission({ ...input, familiarId }), null, familiarId);
  }
  for (const value of [null, [], 1, { ...input, principalKeyFingerprint: "invented" }, { ...input, contents: 2 }]) {
    assert.equal(parseProposalSubmission(value), null);
  }
});
test("only matching daemon status and explicit successful disposition confirm an outcome", () => {
  assert.deepEqual(submissionOutcome({ ok: true, status: 200, data: { ok: true, disposition: "applied" } }), { kind: "applied" });
  const proposalId = "cccccccc-0001-4001-8001-000000000001";
  assert.deepEqual(submissionOutcome({ ok: true, status: 202, data: { ok: true, disposition: "staged", proposalId } }), { kind: "staged", proposalId });
  assert.deepEqual(submissionOutcome({ ok: true, status: 202, data: { ok: true, disposition: "staged", proposalId: "<private>" } }), { kind: "staged", proposalId: null });
  assert.deepEqual(submissionOutcome({ ok: true, status: 202, data: { ok: true, disposition: "held" } }), { kind: "held" });
  for (const data of [null, {}, { disposition: "applied" }, { ok: false, disposition: "applied" }, { ok: true, disposition: "new_variant" }]) {
    assert.deepEqual(submissionOutcome({ ok: true, status: 200, data }), { kind: "unknown" });
  }
  assert.deepEqual(submissionOutcome({ ok: true, status: 202, data: { ok: true, disposition: "applied" } }), { kind: "unknown" });
});
test("known refusals are sanitized; lost or post-write failure outcomes remain unknown", () => {
  for (const [status, code] of [[403, "ward_refused"], [403, "protected_proposal_forbidden"], [404, "familiar_not_found"], [409, "ward_not_configured"]] as const) {
    assert.deepEqual(submissionOutcome({ ok: false, status, data: { error: { code, message: "private contents" } } }), { kind: "refused" });
  }
  for (const status of [0, 403, 500]) {
    assert.deepEqual(submissionOutcome({ ok: false, status, data: { error: { code: "ward_apply_ambiguous", details: { writeApplied: true } } } }), { kind: "unknown" });
  }
});
test("documented budget refusals require explicit no-write evidence", () => {
  for (const code of ["ward_apply_too_large", "proposal_quota_exceeded"]) {
    assert.deepEqual(submissionOutcome({ ok: false, status: 413,
      data: { error: { code, details: { writeApplied: false, target: "private" } } } }), { kind: "refused" });
    for (const details of [undefined, {}, { writeApplied: true }]) {
      assert.deepEqual(submissionOutcome({ ok: false, status: 413,
        data: { error: { code, details } } }), { kind: "unknown" });
    }
  }
});
