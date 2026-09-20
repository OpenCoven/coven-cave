import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalProposalRevision, normalizeProposalAuthority } from "./proposal-authority.ts";

// Captured from an isolated, repository-authored synthetic Ward fixture through
// the real Cave submission UI. Exact producer commits are recorded in the file.
function fixture() {
  return JSON.parse(readFileSync(new URL("./fixtures/threads/daemon-scheduled-proposal.json", import.meta.url), "utf8"));
}
test("real daemon evidence retains the confirmed veto-only authority path", () => {
  const { staged, summary } = fixture();
  assert.equal(canonicalProposalRevision(staged), summary.proposalRevision);
  const result = normalizeProposalAuthority(staged, summary);
  assert.equal(result.state, "verified");
  if (result.state !== "verified") return;
  assert.equal(result.lifecycle, "veto-window-open");
  assert.deepEqual(result.availableDecisions, ["reject"]);
});
test("evidence extensions stay revision-bound and never grant approval", () => {
  for (const field of ["identityEvidence", "autoRegressionEvidence"]) {
    const { staged, summary } = fixture();
    staged[field] = Array(32).fill(1);
    assert.equal(normalizeProposalAuthority(staged, summary).state, "blocked");
    summary.proposalRevision = canonicalProposalRevision(staged);
    const result = normalizeProposalAuthority(staged, summary);
    assert.equal(result.state, "verified");
    if (result.state === "verified") assert.deepEqual(result.availableDecisions, ["reject"]);
  }
});
test("malformed or unknown daemon evidence stays blocked even with a matching revision", () => {
  const mutations = [
    (s: Record<string, unknown>) => { s.identityEvidence = [1]; },
    (s: Record<string, unknown>) => { s.autoRegressionEvidence = Array(32).fill(256); },
    (s: Record<string, unknown>) => { s.probes = {}; },
    (s: Record<string, unknown>) => { (s.probes as Array<Record<string, unknown>>)[0].status = "approved"; },
    (s: Record<string, unknown>) => { (s.probes as Array<Record<string, unknown>>)[0].proposedSha256 = "bad"; },
    (s: Record<string, unknown>) => { (s.probes as Array<Record<string, unknown>>)[0].extraAuthority = true; },
    (s: Record<string, unknown>) => { (s.probes as Array<Record<string, unknown>>)[0].results = [{ id: "unknown" }]; },
    (s: Record<string, unknown>) => { s.extraAuthority = true; },
  ];
  for (const mutate of mutations) {
    const { staged, summary } = fixture();
    mutate(staged);
    summary.proposalRevision = canonicalProposalRevision(staged);
    assert.equal(normalizeProposalAuthority(staged, summary).state, "blocked");
  }
  for (const probeSummary of [null, {}, { status: "passed", passed: -1, failed: 0, unscored: 0, targets: 1 },
    { status: "approved", passed: 1, failed: 0, unscored: 0, targets: 1 }]) {
    const { staged, summary } = fixture();
    summary.probeSummary = probeSummary;
    assert.equal(normalizeProposalAuthority(staged, summary).state, "blocked");
  }
});
test("passed, failed and unscored probes remain advisory under the daemon's typed path", () => {
  for (const status of ["passed", "failed", "unscored"]) {
    const { staged, summary } = fixture();
    const report = staged.probes[0];
    report.status = status;
    report.baselineSha256 = null;
    report.error = "Synthetic fixture diagnostic";
    report.results = [{ id: "parse", configuredSurface: "TOOLS.md", configurationSha256: "a".repeat(64),
      status, summary: "Synthetic probe result", detail: { format: "json", parsed: false } }];
    summary.proposalRevision = canonicalProposalRevision(staged);
    summary.probeSummary = { status, passed: status === "passed" ? 1 : 0,
      failed: status === "failed" ? 1 : 0, unscored: status === "unscored" ? 1 : 0, targets: 1 };
    const result = normalizeProposalAuthority(staged, summary);
    assert.equal(result.state, "verified");
    if (result.state === "verified") assert.deepEqual(result.availableDecisions, ["reject"]);
    report.results[0].status = "approved";
    summary.proposalRevision = canonicalProposalRevision(staged);
    assert.equal(normalizeProposalAuthority(staged, summary).state, "blocked");
  }
});
