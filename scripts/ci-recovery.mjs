import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export const RECOVERY_GRACE_MS = 15 * 60 * 1000;
export const RECOVERY_COOLDOWN_MS = 60 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/i;
const WORKFLOW = "ci.yml";
const MAX_PAGES = 10;
const NEXT_STEPS = {
  missing_eligible_pr_run:
    "Trigger a fresh pull_request event with an authorized maintainer credential, then verify its exact head, live base and merge snapshot.",
  approval_required:
    "Have an authorized maintainer approve the pending workflow; recovery does not grant approval.",
  startup_failure:
    "Inspect the workflow startup failure before requesting a new eligible run.",
  unknown_run_conclusion:
    "Inspect the incomplete run verdict before requesting recovery.",
  ci_waiting:
    "Inspect the runner queue and concurrency holder; do not dispatch or cancel over a waiting run.",
  recovery_already_attempted:
    "Inspect the previous full-run retry before requesting another attempt.",
  base_changed:
    "Trigger a fresh pull_request event against the current base; do not rerun a stale event snapshot.",
  merge_snapshot_stale:
    "Wait for GitHub to refresh the PR merge snapshot and verify its parents before retrying.",
  workflow_contract_partial:
    "Update the PR workflow through reviewed source changes to include the current merge-freshness guards.",
};

/** Requesting a rerun is not merge readiness. GitHub must still accept all
 * required contexts from the new complete attempt on the exact current head. */
export async function runCiRecovery({
  apply = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  log = console.log,
} = {}) {
  if (typeof fetchImpl !== "function" || !Number.isFinite(now))
    throw new Error("fetch implementation and finite timestamp required");
  const repository = env.GITHUB_REPOSITORY?.trim();
  if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository))
    throw new Error("GITHUB_REPOSITORY must use OWNER/REPO form");
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const api = (env.GITHUB_API_URL || "https://api.github.com").replace(
    /\/+$/,
    "",
  );
  const context = {
    root: `${api}/repos/${repository.split("/").map(encodeURIComponent).join("/")}`,
    fetchImpl,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  };
  const pulls = (
    await pages(context, `${context.root}/pulls?state=open&per_page=100`)
  ).map(parsePull);
  const result = {
    mode: apply ? "apply" : "report-only",
    scanned: pulls.length,
    recoveries: [],
    skipped: [],
    degraded: false,
    faults: [],
    attention: [],
  };
  const skip = (number, reason, attention = false) => {
    result.skipped.push({
      number,
      reason,
      ...(NEXT_STEPS[reason] ? { nextStep: NEXT_STEPS[reason] } : {}),
    });
    if (attention) result.attention.push(number);
  };
  const fault = (number, error) => {
    skip(
      number,
      `error: ${String(error instanceof Error ? error.message : error).replace(/\s+/g, " ")}`,
    );
    result.faults.push(number);
    result.degraded = true;
  };
  const eligible = [];
  // Complete the bounded inventory before the first write; individual read
  // failures cannot authorize a mutation for that candidate.
  for (const pull of pulls) {
    const reason = baseSkipReason(pull, repository, now);
    if (reason) {
      skip(pull.number, reason);
      continue;
    }
    try {
      const decision = decideRecovery(
        await listRuns(context, pull.sha),
        pull,
        now,
      );
      if (!decision.run) {
        skip(pull.number, decision.reason, decision.attention);
        continue;
      }
      eligible.push({ pull, run: decision.run });
    } catch (error) {
      fault(pull.number, error);
    }
  }
  for (const candidate of eligible) {
    const { pull, run } = candidate;
    try {
      if (apply) {
        const reason = await preflight(context, candidate, repository, now);
        if (reason) {
          skip(pull.number, reason, Boolean(NEXT_STEPS[reason]));
          continue;
        }
        // Full rerun, never rerun-failed-jobs: the required aggregate binds all
        // upstream evidence to the same run_attempt. No new PR/source events.
        const response = await fetchImpl(
          `${context.root}/actions/runs/${run.id}/rerun`,
          {
            method: "POST",
            headers: context.headers,
          },
        );
        if (!response.ok)
          throw new Error(
            `failed to request full PR rerun (HTTP ${response.status})`,
          );
      }
      result.recoveries.push({
        number: pull.number,
        reason: "cancelled_latest_pr_run",
        ref: pull.ref,
        sha: pull.sha,
        url: pull.url,
        runId: run.id,
        previousAttempt: run.attempt,
        rerunRequested: apply,
      });
    } catch (error) {
      fault(pull.number, error);
    }
  }
  for (const item of result.recoveries)
    log(
      `#${item.number} ${apply ? "full rerun requested" : "full rerun candidate"} run ${item.runId} head ${item.sha}; required checks remain unverified`,
    );
  for (const item of result.skipped)
    log(
      `#${item.number} skipped ${item.reason}${item.nextStep ? `; ${item.nextStep}` : ""}`,
    );
  if (result.attention.length)
    log(
      `::warning::CI recovery needs maintainer action: ${result.attention.map((n) => `#${n}`).join(", ")}`,
    );
  log(
    `CI recovery: ${pulls.length} open PRs scanned; ${result.recoveries.length} ${apply ? "full reruns requested" : "full rerun candidates"}; ${result.attention.length} need maintainer action; ${result.faults.length} API/evidence faults.`,
  );
  return result;
}

async function get(context, path) {
  const response = await context.fetchImpl(`${context.root}/${path}`, {
    headers: context.headers,
  });
  if (!response.ok)
    throw new Error(
      `GitHub read failed for ${path.split("?")[0]} (HTTP ${response.status})`,
    );
  return response.json();
}
async function pages(context, first, runInventory = false) {
  const expected = new URL(first);
  let url = first;
  const values = [];
  let total = null;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const response = await context.fetchImpl(url, { headers: context.headers });
    if (!response.ok)
      throw new Error(`GitHub inventory failed (HTTP ${response.status})`);
    const payload = await response.json();
    const entries = runInventory ? payload?.workflow_runs : payload;
    if (!Array.isArray(entries)) throw new Error("malformed GitHub inventory");
    if (runInventory) {
      if (
        !Number.isSafeInteger(payload.total_count) ||
        payload.total_count < 0 ||
        payload.total_count > 1000
      )
        throw new Error("unbounded or malformed run inventory");
      total = Math.max(total ?? 0, payload.total_count);
    }
    values.push(...entries);
    url = nextLink(response.headers.get("link"));
    if (url) {
      const next = new URL(url);
      if (
        next.origin !== expected.origin ||
        next.pathname !== expected.pathname ||
        (runInventory &&
          next.searchParams.get("head_sha") !==
            expected.searchParams.get("head_sha"))
      )
        throw new Error("pagination escaped the repository inventory endpoint");
    }
  }
  if (url || (total !== null && values.length < total))
    throw new Error("incomplete GitHub inventory");
  return values;
}
async function listRuns(context, sha) {
  return (
    await pages(
      context,
      `${context.root}/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&per_page=100`,
      true,
    )
  )
    .map(parseRun)
    .filter((run) => run.sha === sha)
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}
function binding(run, pull) {
  return run.pulls.find(
    (p) =>
      p.number === pull.number &&
      p.head?.sha === pull.sha &&
      p.base?.ref === pull.baseRef &&
      SHA.test(p.base?.sha ?? ""),
  );
}
function decideRecovery(runs, pull, now) {
  // This repository's recoverable protected workflow is pull_request. A push
  // to main or a manual dispatch for the same SHA is not this PR's event.
  const latest = runs.find(
    (run) => run.event === "pull_request" && binding(run, pull),
  );
  if (!latest) return { reason: "missing_eligible_pr_run", attention: true };
  if (latest.status === "in_progress") return { reason: "ci_in_progress" };
  if (["queued", "pending", "waiting", "requested"].includes(latest.status))
    return {
      reason: "ci_waiting",
      attention: latest.updatedAt <= now - RECOVERY_GRACE_MS,
    };
  if (latest.status !== "completed")
    return { reason: "unknown_run_conclusion", attention: true };
  if (latest.conclusion === "action_required")
    return { reason: "approval_required", attention: true };
  if (latest.conclusion === "startup_failure")
    return { reason: "startup_failure", attention: true };
  if (latest.conclusion === "cancelled") {
    if (latest.attempt > 1)
      return { reason: "recovery_already_attempted", attention: true };
    if (latest.updatedAt > now - RECOVERY_COOLDOWN_MS)
      return { reason: "recovery_cooldown" };
    return { run: latest };
  }
  if (
    ["success", "failure", "neutral", "skipped", "timed_out"].includes(
      latest.conclusion,
    )
  )
    return { reason: "ci_present" };
  return { reason: "unknown_run_conclusion", attention: true };
}
async function preflight(context, { pull, run }, repository, now) {
  let current = parsePull(await get(context, `pulls/${pull.number}`));
  let reason = driftReason(current, pull, repository, now);
  if (reason) return reason;
  if (!current.mergeable || !SHA.test(current.mergeSha ?? ""))
    return "merge_snapshot_stale";
  const association = binding(run, pull);
  const base = await get(
    context,
    `git/ref/heads/${encodeURIComponent(pull.baseRef)}`,
  );
  if (
    base?.ref !== `refs/heads/${pull.baseRef}` ||
    base.object?.type !== "commit" ||
    !SHA.test(base.object?.sha ?? "")
  )
    throw new Error("malformed live base ref");
  if (association.base.sha !== base.object.sha) return "base_changed";
  const merge = await get(context, `git/ref/pull/${pull.number}/merge`);
  if (
    merge?.ref !== `refs/pull/${pull.number}/merge` ||
    merge.object?.type !== "commit" ||
    merge.object?.sha !== current.mergeSha
  )
    return "merge_snapshot_stale";
  const commit = await get(context, `git/commits/${current.mergeSha}`);
  if (
    commit?.sha !== current.mergeSha ||
    commit.parents?.length !== 2 ||
    commit.parents[0]?.sha !== base.object.sha ||
    commit.parents[1]?.sha !== pull.sha
  )
    return "merge_snapshot_stale";
  if (!(await hasFreshnessContract(context, pull.sha)))
    return "workflow_contract_partial";
  // Slow network/contract inspection must not leave a stale mutation target.
  const latest = decideRecovery(
    await listRuns(context, pull.sha),
    pull,
    now,
  ).run;
  if (!latest || latest.id !== run.id || latest.attempt !== run.attempt)
    return "run_changed";
  const detail = parseRun(await get(context, `actions/runs/${run.id}`));
  if (
    detail.id !== run.id ||
    detail.sha !== pull.sha ||
    detail.event !== "pull_request" ||
    detail.path !== ".github/workflows/ci.yml" ||
    detail.attempt !== run.attempt ||
    detail.status !== "completed" ||
    detail.conclusion !== "cancelled" ||
    binding(detail, pull)?.base.sha !== base.object.sha
  )
    return "run_changed";
  current = parsePull(await get(context, `pulls/${pull.number}`));
  reason = driftReason(current, pull, repository, now);
  if (reason) return reason;
  if (!current.mergeable || current.mergeSha !== merge.object.sha)
    return "merge_snapshot_stale";
  const finalBase = await get(
    context,
    `git/ref/heads/${encodeURIComponent(pull.baseRef)}`,
  );
  if (finalBase?.ref !== base.ref || finalBase.object?.sha !== base.object.sha)
    return "base_changed";
  return null;
}
async function hasFreshnessContract(context, sha) {
  const content = await get(
    context,
    `contents/.github/workflows/${WORKFLOW}?ref=${sha}`,
  );
  if (
    content?.encoding !== "base64" ||
    typeof content.content !== "string" ||
    !content.content
  )
    throw new Error("malformed workflow content");
  const workflow = parse(
    Buffer.from(content.content, "base64").toString("utf8"),
  );
  const trigger = workflow?.on;
  if (
    !trigger ||
    typeof trigger !== "object" ||
    !Object.hasOwn(trigger, "pull_request")
  )
    return false;
  const jobs = workflow.jobs;
  if (!jobs?.["pr-checks"] || !jobs.paths || jobs.build?.if !== "always()")
    return false;
  const attemptGuard = jobs.build.steps?.find(
    (step) => step.name === "Refuse carried-forward upstream evidence",
  );
  if (
    !attemptGuard ||
    attemptGuard.if ||
    attemptGuard["continue-on-error"] ||
    attemptGuard.env?.RUN_ATTEMPT !== "${{ github.run_attempt }}" ||
    !attemptGuard.run?.includes("node scripts/check-build-evidence.mjs") ||
    !attemptGuard.run.includes('--run-attempt "$RUN_ATTEMPT"') ||
    !attemptGuard.run.includes('--attempt-started-at "$ATTEMPT_STARTED_AT"')
  )
    return false;
  const freshnessShell =
    /^set -euo pipefail\s+test -f scripts\/check-merge-tree-freshness\.mjs \|\| \{\s+echo "[^"\n]+"\s+exit 1\s+\}\s+node scripts\/check-merge-tree-freshness\.mjs --pr "\$PR_NUMBER" --head "\$HEAD_SHA"\s*$/;
  let checkouts = 0;
  for (const job of Object.values(jobs)) {
    const steps = job?.steps;
    if (!Array.isArray(steps)) continue;
    const checkoutIndex = steps.findIndex((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    if (checkoutIndex < 0) continue;
    checkouts++;
    const guardIndex = steps.findIndex(
      (step) =>
        step.if === "github.event_name == 'pull_request'" &&
        step.env?.PR_NUMBER === "${{ github.event.pull_request.number }}" &&
        step.env?.HEAD_SHA === "${{ github.event.pull_request.head.sha }}" &&
        typeof step.run === "string" &&
        freshnessShell.test(step.run),
    );
    if (
      guardIndex <= checkoutIndex ||
      !steps
        .slice(checkoutIndex + 1, guardIndex)
        .every(
          (step) =>
            step.name === "Capture run base snapshot" &&
            step.run ===
              'node scripts/capture-ci-base-snapshot.mjs >> "$GITHUB_OUTPUT"',
        ) ||
      job["continue-on-error"] ||
      steps[guardIndex]["continue-on-error"]
    )
      return false;
  }
  return checkouts > 0;
}
function parsePull(value) {
  const createdAt = Date.parse(value?.created_at),
    updatedAt = Date.parse(value?.updated_at);
  if (
    !Number.isSafeInteger(value?.number) ||
    value.number < 1 ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    typeof value.draft !== "boolean" ||
    !["open", "closed"].includes(value.state) ||
    !SHA.test(value.head?.sha ?? "") ||
    typeof value.head?.ref !== "string" ||
    typeof value.head.repo?.full_name !== "string" ||
    typeof value.base?.ref !== "string" ||
    typeof value.base.repo?.full_name !== "string" ||
    typeof value.html_url !== "string"
  )
    throw new Error("malformed pull request evidence");
  return {
    number: value.number,
    createdAt,
    updatedAt,
    draft: value.draft,
    state: value.state,
    sha: value.head.sha,
    ref: value.head.ref,
    headRepository: value.head.repo.full_name,
    baseRef: value.base.ref,
    baseRepository: value.base.repo.full_name,
    url: value.html_url,
    mergeable: value.mergeable,
    mergeSha: value.merge_commit_sha,
  };
}
function parseRun(value) {
  const createdAt = Date.parse(value?.created_at),
    updatedAt = Date.parse(value?.updated_at);
  if (
    !Number.isSafeInteger(value?.id) ||
    value.id < 1 ||
    !Number.isSafeInteger(value.run_attempt) ||
    value.run_attempt < 1 ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !SHA.test(value.head_sha ?? "") ||
    typeof value.status !== "string" ||
    typeof value.event !== "string" ||
    !Array.isArray(value.pull_requests) ||
    (value.conclusion !== null && typeof value.conclusion !== "string")
  )
    throw new Error("malformed workflow run evidence");
  return {
    id: value.id,
    attempt: value.run_attempt,
    createdAt,
    updatedAt,
    sha: value.head_sha,
    status: value.status,
    conclusion: value.conclusion,
    event: value.event,
    pulls: value.pull_requests,
    path: value.path,
  };
}
function baseSkipReason(pull, repository, now) {
  if (pull.state !== "open") return "pull_closed";
  if (pull.draft) return "draft";
  if (pull.headRepository.toLowerCase() !== repository.toLowerCase())
    return "fork_head";
  if (
    pull.baseRepository.toLowerCase() !== repository.toLowerCase() ||
    pull.baseRef !== "main"
  )
    return "other_base";
  if (Math.max(pull.createdAt, pull.updatedAt) > now - RECOVERY_GRACE_MS)
    return "grace_period";
  return null;
}
function driftReason(current, expected, repository, now) {
  const reason = baseSkipReason(current, repository, now);
  if (reason) return reason;
  if (
    current.sha !== expected.sha ||
    current.ref !== expected.ref ||
    current.baseRef !== expected.baseRef
  )
    return "head_changed";
  return null;
}
function nextLink(header) {
  for (const part of (header ?? "").split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match?.[2].split(/\s+/).includes("next")) return match[1];
  }
  return null;
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.some((arg) => !["--apply", "--json", "--help", "-h"].includes(arg))
    )
      throw new Error("unsupported recovery argument");
    if (args.includes("--help") || args.includes("-h"))
      console.log(
        "Usage: node scripts/ci-recovery.mjs [--apply] [--json]\nOnly full retries of eligible cancelled PR runs are automatic; other cases report maintainer actions.",
      );
    else {
      const result = await runCiRecovery({
        apply: args.includes("--apply"),
        log: args.includes("--json") ? () => {} : console.log,
      });
      if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
      if (result.degraded) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ci-recovery: ${error.message}`);
    process.exitCode = 1;
  }
}
