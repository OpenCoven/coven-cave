// Guard for the Frontend build aggregator: refuse a green gate built on
// carried-forward upstream evidence (cave-38aud).
//
// The Actions jobs API reports a pull request's HEAD commit in `head_sha`, not
// the synthetic merge commit exposed as `github.sha`. It also copies a
// successful job into later `rerun --failed` attempts with the NEW
// `run_attempt` while preserving the job's ORIGINAL timestamps. Consequently:
//
//   - head_sha must be compared with the PR/workflow head SHA;
//   - started_at must be compared with the current attempt's run_started_at;
//   - every matrix leg must be retained by its exact job name; and
//   - the run's frozen base SHA must still equal the live base ref.
//
// This script uses only Node builtins because the build gate runs it before a
// dependency install on documentation-only changes.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EVIDENCE_JOB_PREFIXES = [
  "Select validation",
  "iOS build",
  "Frontend validation",
  "Frontend bundle",
  "Frontend E2E",
];

const SHA_RE = /^[0-9a-f]{40}$/i;

function isEvidenceJob(job) {
  return job?.conclusion === "success"
    && typeof job.name === "string"
    && EVIDENCE_JOB_PREFIXES.some((prefix) => job.name.startsWith(prefix));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : -1;
}

function timestamp(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNewerJob(candidate, existing) {
  const candidateAttempt = numeric(candidate.run_attempt);
  const existingAttempt = numeric(existing.run_attempt);
  if (candidateAttempt !== existingAttempt) return candidateAttempt > existingAttempt;

  const candidateId = numeric(candidate.id);
  const existingId = numeric(existing.id);
  if (candidateId !== existingId) return candidateId > existingId;

  const candidateStartedAt = timestamp(candidate.started_at) ?? -1;
  const existingStartedAt = timestamp(existing.started_at) ?? -1;
  return candidateStartedAt >= existingStartedAt;
}

/**
 * Successful jobs that back the aggregator's green, newest record first per
 * exact job name.
 *
 * Prefixes identify the workflow families, but they are never map keys. The
 * seven Frontend validation matrix legs, eight numbered E2E shards, and the
 * agentic E2E leg are independent evidence and must remain independently
 * auditable.
 */
export function latestEvidenceJobs(jobs) {
  const byExactName = new Map();
  for (const job of jobs) {
    if (!isEvidenceJob(job)) continue;
    const existing = byExactName.get(job.name);
    if (!existing || isNewerJob(job, existing)) {
      byExactName.set(job.name, job);
    }
  }
  return byExactName;
}

function sortedEvidenceJobs(jobs) {
  return [...latestEvidenceJobs(jobs)].sort(([left], [right]) => left.localeCompare(right));
}

export function staleEvidence(
  jobs,
  { expectedHeadSha, attemptStartedAt, runBaseRef, runBaseSha, liveBaseSha },
) {
  const stale = [];
  const attemptStartedAtMs = timestamp(attemptStartedAt);
  const evidence = sortedEvidenceJobs(jobs);

  if (runBaseSha !== liveBaseSha) {
    stale.push(
      `base ${runBaseRef} moved: run recorded ${runBaseSha}, live ref is ${liveBaseSha}`,
    );
  }

  if (evidence.length === 0) {
    stale.push("no successful upstream evidence jobs were returned by the Actions API");
  }

  for (const [name, job] of evidence) {
    if (job.head_sha !== expectedHeadSha) {
      stale.push(
        `${name} reported head ${job.head_sha ?? "unknown"}; expected workflow head ${expectedHeadSha}`,
      );
    }

    const jobStartedAtMs = timestamp(job.started_at);
    if (jobStartedAtMs === null) {
      stale.push(`${name} has no valid started_at timestamp (${job.started_at ?? "unknown"})`);
    } else if (attemptStartedAtMs !== null && jobStartedAtMs < attemptStartedAtMs) {
      stale.push(
        `${name} started ${job.started_at} before the current attempt started ${attemptStartedAt}`,
      );
    }
  }

  return stale;
}

export function evidenceSummaryLines(jobs) {
  return sortedEvidenceJobs(jobs).map(
    ([name, job]) => `- ${name}: ${job.head_sha ?? "unknown"} (attempt ${job.run_attempt ?? "unknown"}, started ${job.started_at ?? "unknown"})`,
  );
}

function parseArgs(argv) {
  const known = new Set([
    "--expected-head-sha",
    "--attempt-started-at",
    "--run-base-ref",
    "--run-base-sha",
    "--live-base-sha",
  ]);
  const args = new Map();
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!known.has(flag) || value === undefined) {
      return { error: `unknown or valueless argument: ${flag ?? "unknown"}` };
    }
    args.set(flag, value);
  }
  return { args };
}

function usageError(message) {
  console.error(`check-build-evidence: ${message}`);
  process.exitCode = 2;
}

export function main(argv = process.argv) {
  const parsedArgs = parseArgs(argv);
  if (parsedArgs.error) {
    usageError(parsedArgs.error);
    return;
  }
  const args = parsedArgs.args;
  const expectedHeadSha = args.get("--expected-head-sha");
  const attemptStartedAt = args.get("--attempt-started-at");
  const runBaseRef = args.get("--run-base-ref");
  const runBaseSha = args.get("--run-base-sha");
  const liveBaseSha = args.get("--live-base-sha");

  if (!SHA_RE.test(expectedHeadSha ?? "")) {
    usageError("--expected-head-sha must be a 40-hex SHA");
    return;
  }
  if (timestamp(attemptStartedAt) === null) {
    usageError("--attempt-started-at must be a valid timestamp");
    return;
  }
  if (!runBaseRef) {
    usageError("--run-base-ref is required");
    return;
  }
  if (!SHA_RE.test(runBaseSha ?? "")) {
    usageError("--run-base-sha must be a 40-hex SHA");
    return;
  }
  if (!SHA_RE.test(liveBaseSha ?? "")) {
    usageError("--live-base-sha must be a 40-hex SHA");
    return;
  }

  let jobs;
  try {
    const parsed = JSON.parse(readFileSync(0, "utf8"));
    // `gh api .../jobs` returns the envelope { total_count, jobs: [...] }.
    jobs = Array.isArray(parsed) ? parsed : parsed?.jobs;
  } catch (error) {
    usageError(`stdin must be the jobs JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(jobs)) {
    usageError("stdin must be the jobs JSON (array or { jobs: [...] } envelope)");
    return;
  }

  const context = {
    expectedHeadSha,
    attemptStartedAt,
    runBaseRef,
    runBaseSha,
    liveBaseSha,
  };
  const stale = staleEvidence(jobs, context);

  console.log("## Frontend build evidence");
  console.log(`- Expected workflow head: ${expectedHeadSha}`);
  console.log(`- Current attempt started: ${attemptStartedAt}`);
  console.log(`- Run base: ${runBaseRef}@${runBaseSha}`);
  console.log(`- Live base: ${runBaseRef}@${liveBaseSha}`);
  console.log("");
  console.log("Successful upstream jobs:");
  for (const line of evidenceSummaryLines(jobs)) console.log(line);

  if (stale.length > 0) {
    console.error("Refusing carried-forward or stale upstream evidence (cave-38aud):");
    for (const line of stale) console.error(`- ${line}`);
    console.error("Re-run the whole workflow run (not only failed jobs) after the base is current.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
