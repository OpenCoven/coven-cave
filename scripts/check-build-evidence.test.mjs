import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { EVIDENCE_JOB_PREFIXES, evidenceSummaryLines, latestEvidenceJobs, staleEvidence } from "./check-build-evidence.mjs";

const SCRIPT = fileURLToPath(new URL("./check-build-evidence.mjs", import.meta.url));
const CURRENT = "a".repeat(40);
const OLD = "b".repeat(40);

function job(name, headSha, attempt) {
  return { name, head_sha: headSha, run_attempt: attempt, started_at: "2026-08-28T10:00:00Z" };
}

function cli(jobs, currentSha = CURRENT) {
  return spawnSync(process.execPath, [SCRIPT, "--current-sha", currentSha], {
    input: JSON.stringify(jobs),
    encoding: "utf8",
  });
}

test("latest evidence per name is the highest attempt", () => {
  const jobs = [
    job("Frontend validation", OLD, 1),
    job("Frontend validation", CURRENT, 2),
    job("Select validation", CURRENT, 2),
    { name: "unrelated job", head_sha: CURRENT, run_attempt: 2 },
  ];
  const latest = latestEvidenceJobs(jobs);
  assert.equal(latest.size, 2);
  assert.equal(latest.get("Frontend validation").head_sha, CURRENT);
  assert.equal(latest.get("Select validation").head_sha, CURRENT);
});

test("a carried-forward job with a moved head is stale", () => {
  const jobs = [job("Frontend validation", OLD, 1)];
  assert.deepEqual(staleEvidence(jobs, { currentSha: CURRENT, now: Date.parse("2026-08-28T12:00:00Z") }), [
    "Frontend validation ran against " + OLD + " (attempt 1, 7200s old)",
  ]);
});

test("same-sha evidence is never stale, whatever its age", () => {
  assert.deepEqual(staleEvidence([job("Frontend validation", CURRENT, 1)], { currentSha: CURRENT }), []);
});

test("the CLI refuses stale evidence and exits 1 (cave-38aud)", () => {
  const result = cli([job("Frontend validation", OLD, 1)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing carried-forward upstream evidence/);
  assert.match(result.stderr, /ran against/);
  assert.match(result.stdout, /Evidence recorded/);
});

test("the CLI passes current evidence and records the summary lines", () => {
  const result = cli([
    job("Select validation", CURRENT, 2),
    job("Frontend validation", CURRENT, 2),
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Select validation: /);
});

test("the CLI accepts the gh api jobs envelope", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--current-sha", CURRENT], {
    input: JSON.stringify({ total_count: 1, jobs: [job("Select validation", CURRENT, 2)] }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Select validation: /);
});

test("a malformed or missing --current-sha is a usage error", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { input: "[]", encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--current-sha is required/);
});

test("evidence prefixes match the workflow's upstream jobs, including E2E shards", () => {
  assert.deepEqual([...EVIDENCE_JOB_PREFIXES].sort(), [
    "Frontend E2E",
    "Frontend bundle",
    "Frontend validation",
    "iOS build",
    "Select validation",
  ].sort());
  // The sharded matrix and the agentic leg both match the E2E prefix.
  const jobs = [
    job("Frontend E2E (1/8)", CURRENT, 2),
    job("Frontend E2E (agentic)", OLD, 2),
  ];
  const latest = latestEvidenceJobs(jobs);
  assert.equal(latest.size, 1);
  assert.equal(latest.get("Frontend E2E").head_sha, OLD, "the newest attempt wins per prefix");
  assert.equal(staleEvidence(jobs, { currentSha: CURRENT }).length, 1);
});
