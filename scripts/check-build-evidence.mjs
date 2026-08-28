// Guard for the Frontend build aggregator: refuse a green gate built on
// carried-forward upstream evidence (cave-38aud).
//
// A `gh run rerun --failed` re-runs only the failed jobs; successful upstream
// jobs are carried forward with their original head_sha and timestamps. When
// the PR's merge ref has moved since (the base changed), the aggregator would
// otherwise report green on hours-old results produced against a different
// tree. This script compares each evidence job's latest head_sha against the
// current run's head and refuses on any mismatch, and always prints the
// evidence lines so the staleness is visible in the job summary.

import { readFileSync } from "node:fs";

export const EVIDENCE_JOB_PREFIXES = [
  "Select validation",
  "iOS build",
  "Frontend validation",
  "Frontend bundle",
  "Frontend E2E",
];

/**
 * Jobs that back the aggregator's green, newest attempt first per prefix.
 *
 * The E2E matrix shards name themselves "Frontend E2E (1/8)" and friends, so
 * matching is by prefix. Carried-forward jobs keep their original
 * run_attempt, so the job the aggregator actually reads for a prefix is the
 * one with the highest attempt. A prefix absent from the list never ran and
 * is left to the result gate.
 */
export function latestEvidenceJobs(jobs) {
  const byName = new Map();
  for (const job of jobs) {
    if (typeof job?.name !== "string") continue;
    const prefix = EVIDENCE_JOB_PREFIXES.find((candidate) => job.name.startsWith(candidate));
    if (!prefix) continue;
    const existing = byName.get(prefix);
    if (!existing || Number(job.run_attempt ?? 0) >= Number(existing.run_attempt ?? 0)) {
      byName.set(prefix, job);
    }
  }
  return byName;
}

export function staleEvidence(jobs, { currentSha, now = Date.now() }) {
  const stale = [];
  for (const [name, job] of latestEvidenceJobs(jobs)) {
    if (job.head_sha === currentSha) continue;
    const ageSeconds = job.started_at
      ? Math.max(0, Math.floor((now - Date.parse(job.started_at)) / 1000))
      : null;
    stale.push(
      name + " ran against " + job.head_sha + " (attempt " + job.run_attempt
      + (ageSeconds === null ? "" : ", " + ageSeconds + "s old") + ")",
    );
  }
  return stale;
}

export function evidenceSummaryLines(jobs) {
  const lines = [];
  for (const [name, job] of latestEvidenceJobs(jobs)) {
    lines.push("- " + name + ": " + job.head_sha + " (attempt " + job.run_attempt + ", started " + (job.started_at ?? "unknown") + ")");
  }
  return lines;
}

export function main(argv = process.argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--")) continue;
    args.set(argv[i], argv[i + 1]);
  }
  const currentSha = args.get("--current-sha");
  if (!currentSha) {
    console.error("check-build-evidence: --current-sha is required");
    process.exitCode = 2;
    return;
  }
  let jobs;
  try {
    jobs = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    console.error("check-build-evidence: stdin must be the jobs JSON array:", error.message);
    process.exitCode = 2;
    return;
  }
  if (!Array.isArray(jobs)) {
    console.error("check-build-evidence: stdin must be the jobs JSON array");
    process.exitCode = 2;
    return;
  }

  const stale = staleEvidence(jobs, { currentSha });
  const lines = evidenceSummaryLines(jobs);
  console.log("Evidence recorded by the Frontend build gate:");
  for (const line of lines) console.log(line);

  if (stale.length > 0) {
    console.error("Refusing carried-forward upstream evidence (cave-38aud):");
    for (const line of stale) console.error("- " + line);
    console.error("Re-run the whole workflow run (not only failed jobs) and the evidence will be re-produced.");
    process.exitCode = 1;
  }
}

if (import.meta.url === "file://" + process.argv[1]) {
  main();
}
