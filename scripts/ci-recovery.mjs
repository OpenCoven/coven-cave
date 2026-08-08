import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export const RECOVERY_GRACE_MS = 15 * 60 * 1000;
export const RECOVERY_COOLDOWN_MS = 60 * 60 * 1000;

const WORKFLOW_FILE = "ci.yml";
const MAX_PULL_PAGES = 10;
const EXPECTED_RUN_NAME = "CI ${{ github.event_name }} ${{ inputs.expected_sha || github.sha }}";
const EXPECTED_CONCURRENCY_GROUP =
  "ci-${{ github.event.pull_request.head.sha || inputs.expected_sha || github.sha }}";
const EXPECTED_JOB_GUARD =
  "github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha";
const GUARDED_JOB_NAMES = [
  "frontend-static",
  "frontend-tests",
  "frontend-bundle",
  "cargo-check",
  "e2e-shard",
  "conformance",
  "sidecar-runtime",
  "windows-native",
];

export async function runCiRecovery({
  apply = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  log = console.log,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  if (!Number.isFinite(now)) throw new Error("now must be a finite timestamp");

  const token = requiredEnv(env, "GITHUB_TOKEN");
  const repository = requiredRepository(env.GITHUB_REPOSITORY);
  const apiUrl = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const repositoryPath = repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
  const context = { apiUrl, repositoryPath, headers, fetchImpl };
  const pulls = await listOpenPulls(context);
  const eligible = [];
  const skipped = [];

  for (const rawPull of pulls) {
    const pull = parsePull(rawPull);
    const skip = baseSkipReason(pull, repository, now);
    if (skip) {
      skipped.push({ number: pull.number, reason: skip });
      continue;
    }

    const runs = await listWorkflowRuns(context, pull.sha);
    const decision = await decideRecovery(context, runs, now);
    if (!decision.recover) {
      skipped.push({ number: pull.number, reason: decision.reason });
      continue;
    }

    eligible.push({
      number: pull.number,
      reason: decision.reason,
      ref: pull.ref,
      sha: pull.sha,
      url: pull.url,
    });
  }

  const dispatchable = [];
  if (apply) {
    // Complete every candidate read before the first mutation. A later REST
    // failure must never leave the repository with a partially applied scan.
    for (const recovery of eligible) {
      const current = await getPull(context, recovery.number);
      const drift = dispatchSkipReason(current, recovery, repository, now);
      if (drift) {
        skipped.push({ number: recovery.number, reason: drift });
        continue;
      }
      dispatchable.push({
        recovery,
        supportsExpectedSha: await workflowSupportsExpectedSha(context, recovery.sha),
      });
    }
  }

  const recoveries = apply ? [] : eligible.map((recovery) => ({ ...recovery, dispatched: false }));
  for (const { recovery, supportsExpectedSha } of dispatchable) {
    await dispatchWorkflow(context, recovery.ref, recovery.sha, supportsExpectedSha);
    recoveries.push({ ...recovery, dispatched: true });
  }

  const result = {
    mode: apply ? "apply" : "report-only",
    scanned: pulls.length,
    recoveries,
    skipped,
  };
  for (const recovery of recoveries) {
    log(
      `#${recovery.number} ${recovery.reason} ` +
        `${recovery.dispatched ? "dispatched" : "eligible"} ${recovery.ref} ${recovery.sha.slice(0, 12)}`,
    );
  }
  log(
    `CI recovery: ${result.scanned} open PR${result.scanned === 1 ? "" : "s"} scanned; ` +
      `${recoveries.length} ${apply ? "dispatched" : "eligible"}.`,
  );
  return result;
}

async function listOpenPulls(context) {
  const pulls = [];
  let url = `${context.apiUrl}/repos/${context.repositoryPath}/pulls?state=open&per_page=100`;
  for (let page = 0; page < MAX_PULL_PAGES && url; page += 1) {
    const response = await context.fetchImpl(url, { headers: context.headers });
    if (!response.ok) {
      throw new Error(`failed to list open pull requests (HTTP ${response.status})`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("open pull request response was not an array");
    pulls.push(...payload);
    const next = nextLink(response.headers.get("link"));
    if (next && !isPullInventoryUrl(next, context)) {
      throw new Error("pull request pagination URL escaped the GitHub API repository endpoint");
    }
    url = next;
  }
  if (url) throw new Error(`open pull request inventory exceeded ${MAX_PULL_PAGES} pages`);
  return pulls;
}

async function listWorkflowRuns(context, sha) {
  const url =
    `${context.apiUrl}/repos/${context.repositoryPath}/actions/workflows/${WORKFLOW_FILE}/runs` +
    `?head_sha=${encodeURIComponent(sha)}&per_page=100`;
  const response = await context.fetchImpl(url, { headers: context.headers });
  if (!response.ok) {
    throw new Error(`failed to list CI runs for a pull request head (HTTP ${response.status})`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.workflow_runs)) {
    throw new Error("CI workflow run response was malformed");
  }
  return payload.workflow_runs
    .map(parseRun)
    .filter(
      (run) =>
        !run.hasInvalidExpectedShaStamp &&
        (run.expectedSha === null ||
          run.expectedSha.toLowerCase() === run.headSha.toLowerCase()),
    )
    .sort((left, right) => right.createdAt - left.createdAt);
}

async function getPull(context, number) {
  const url = `${context.apiUrl}/repos/${context.repositoryPath}/pulls/${number}`;
  const response = await context.fetchImpl(url, { headers: context.headers });
  if (!response.ok) {
    throw new Error(`failed to revalidate a pull request head (HTTP ${response.status})`);
  }
  return parsePull(await response.json());
}

async function decideRecovery(context, runs, now) {
  if (runs.length === 0) return { recover: true, reason: "missing_ci_run" };

  const recentRecovery = runs.some(
    (run) =>
      run.event === "workflow_dispatch" &&
      run.createdAt > now - RECOVERY_COOLDOWN_MS,
  );
  if (recentRecovery) return { recover: false, reason: "recovery_cooldown" };

  if (runs.some((run) => run.status === "completed" || run.status === "in_progress")) {
    return { recover: false, reason: "ci_present" };
  }

  const latest = runs[0];
  if (latest.status !== "queued") return { recover: false, reason: "ci_present" };
  if (latest.createdAt > now - RECOVERY_GRACE_MS) {
    return { recover: false, reason: "ci_queued" };
  }

  const jobCount = await workflowJobCount(context, latest.id);
  if (jobCount > 0) return { recover: false, reason: "ci_present" };
  return { recover: true, reason: "stalled_empty_run" };
}

async function workflowJobCount(context, runId) {
  const url = `${context.apiUrl}/repos/${context.repositoryPath}/actions/runs/${runId}/jobs?per_page=1`;
  const response = await context.fetchImpl(url, { headers: context.headers });
  if (!response.ok) {
    throw new Error(`failed to inspect queued CI run jobs (HTTP ${response.status})`);
  }
  const payload = await response.json();
  if (!payload || !Number.isInteger(payload.total_count) || payload.total_count < 0) {
    throw new Error("CI workflow jobs response was malformed");
  }
  return payload.total_count;
}

async function workflowSupportsExpectedSha(context, sha) {
  const url =
    `${context.apiUrl}/repos/${context.repositoryPath}/contents/.github/workflows/${WORKFLOW_FILE}` +
    `?ref=${encodeURIComponent(sha)}`;
  const response = await context.fetchImpl(url, { headers: context.headers });
  if (!response.ok) {
    throw new Error(`failed to inspect the CI workflow contract (HTTP ${response.status})`);
  }
  const payload = await response.json();
  if (
    payload?.encoding !== "base64" ||
    typeof payload.content !== "string" ||
    payload.content.length === 0
  ) {
    throw new Error("CI workflow content response was malformed");
  }
  let workflow;
  try {
    workflow = parse(Buffer.from(payload.content, "base64").toString("utf8"));
  } catch {
    throw new Error("CI workflow content was not valid YAML");
  }
  const triggers = workflow?.on;
  if (
    triggers === null ||
    typeof triggers !== "object" ||
    !Object.hasOwn(triggers, "workflow_dispatch")
  ) {
    throw new Error("CI workflow does not support recovery dispatches");
  }
  const inputs = workflow?.on?.workflow_dispatch?.inputs;
  const expectedInput =
    inputs !== null &&
    typeof inputs === "object" &&
    Object.hasOwn(inputs, "expected_sha")
      ? inputs.expected_sha
      : null;
  const hasExpectedInput = expectedInput !== null;
  const hasCompleteExpectedInput =
    expectedInput !== null &&
    typeof expectedInput === "object" &&
    expectedInput.required === true &&
    expectedInput.type === "string";
  const hasCompleteGuardedContract =
    hasCompleteExpectedInput &&
    workflow["run-name"] === EXPECTED_RUN_NAME &&
    workflow?.concurrency?.group === EXPECTED_CONCURRENCY_GROUP &&
    GUARDED_JOB_NAMES.every((name) => workflow?.jobs?.[name]?.if === EXPECTED_JOB_GUARD);
  if (hasCompleteGuardedContract) return true;

  const hasGuardedProtocolMarker =
    hasExpectedInput || JSON.stringify(workflow).includes("inputs.expected_sha");
  if (hasGuardedProtocolMarker) {
    throw new Error("CI workflow recovery contract was partially configured");
  }
  return false;
}

async function dispatchWorkflow(context, ref, expectedSha, supportsExpectedSha) {
  const url = `${context.apiUrl}/repos/${context.repositoryPath}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const body = supportsExpectedSha
    ? { ref, inputs: { expected_sha: expectedSha } }
    : { ref };
  const response = await context.fetchImpl(url, {
    method: "POST",
    headers: { ...context.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`failed to dispatch CI recovery (HTTP ${response.status})`);
  }
}

function parsePull(value) {
  const number = value?.number;
  const createdAt = Date.parse(value?.created_at);
  const updatedAt = Date.parse(value?.updated_at);
  const draft = value?.draft;
  const state = value?.state;
  const url = value?.html_url;
  const ref = value?.head?.ref;
  const sha = value?.head?.sha;
  const headRepository = value?.head?.repo?.full_name;
  if (
    !Number.isInteger(number) ||
    number <= 0 ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    typeof draft !== "boolean" ||
    typeof state !== "string" ||
    typeof url !== "string" ||
    url.length === 0 ||
    typeof ref !== "string" ||
    ref.length === 0 ||
    typeof sha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(sha) ||
    typeof headRepository !== "string"
  ) {
    throw new Error("open pull request response contained a malformed entry");
  }
  return { number, createdAt, updatedAt, draft, state, url, ref, sha, headRepository };
}

function parseRun(value) {
  const id = value?.id;
  const status = value?.status;
  const event = value?.event;
  const createdAt = Date.parse(value?.created_at);
  const headSha = value?.head_sha;
  const displayTitle = value?.display_title;
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    typeof status !== "string" ||
    status.length === 0 ||
    typeof event !== "string" ||
    event.length === 0 ||
    !Number.isFinite(createdAt) ||
    typeof headSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(headSha) ||
    typeof displayTitle !== "string" ||
    displayTitle.length === 0
  ) {
    throw new Error("CI workflow run response contained a malformed entry");
  }
  const expectedShaMatch =
    event === "workflow_dispatch"
      ? displayTitle.match(/^CI workflow_dispatch ([0-9a-f]{40})$/i)
      : null;
  const hasInvalidExpectedShaStamp =
    event === "workflow_dispatch" &&
    displayTitle.startsWith("CI workflow_dispatch ") &&
    expectedShaMatch === null;
  return {
    id,
    status,
    event,
    createdAt,
    headSha,
    expectedSha: expectedShaMatch?.[1] ?? null,
    hasInvalidExpectedShaStamp,
  };
}

function baseSkipReason(pull, repository, now) {
  if (pull.state !== "open") return "pull_closed";
  if (pull.draft) return "draft";
  if (pull.headRepository.toLowerCase() !== repository.toLowerCase()) return "fork_head";
  if (Math.max(pull.createdAt, pull.updatedAt) > now - RECOVERY_GRACE_MS) {
    return "grace_period";
  }
  return null;
}

function dispatchSkipReason(current, expected, repository, now) {
  if (current.state !== "open") return "pull_closed";
  if (
    current.sha !== expected.sha ||
    current.ref !== expected.ref ||
    current.headRepository.toLowerCase() !== repository.toLowerCase()
  ) {
    return "head_changed";
  }
  return baseSkipReason(current, repository, now);
}

function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match?.[2].split(/\s+/).includes("next")) return match[1];
  }
  return null;
}

function isPullInventoryUrl(value, context) {
  try {
    const candidate = new URL(value);
    const api = new URL(context.apiUrl);
    const apiPath = api.pathname.replace(/\/+$/, "");
    return (
      candidate.origin === api.origin &&
      candidate.pathname === `${apiPath}/repos/${context.repositoryPath}/pulls`
    );
  } catch {
    return false;
  }
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredRepository(value) {
  const repository = value?.trim();
  if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must use OWNER/REPO form");
  }
  return repository;
}

function parseArgs(argv) {
  const options = { apply: false, json: false };
  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: node scripts/ci-recovery.mjs [--apply] [--json]");
      return null;
    } else {
      throw new Error(`unsupported argument: ${arg}`);
    }
  }
  return options;
}

const isDirectRun =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options) {
      const result = await runCiRecovery({
        apply: options.apply,
        log: options.json ? () => {} : console.log,
      });
      if (options.json) console.log(JSON.stringify(result, null, 2));
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`ci-recovery: ${message}`);
    process.exitCode = 1;
  }
}
