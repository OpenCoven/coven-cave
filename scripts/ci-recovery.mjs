import { pathToFileURL } from "node:url";

export const RECOVERY_GRACE_MS = 15 * 60 * 1000;
export const RECOVERY_COOLDOWN_MS = 60 * 60 * 1000;

const WORKFLOW_FILE = "ci.yml";
const MAX_PULL_PAGES = 10;

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
  const recoveries = [];
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

    let dispatched = false;
    if (apply) {
      await dispatchWorkflow(context, pull.ref);
      dispatched = true;
    }
    recoveries.push({
      number: pull.number,
      reason: decision.reason,
      ref: pull.ref,
      sha: pull.sha,
      url: pull.url,
      dispatched,
    });
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
  return payload.workflow_runs.map(parseRun).sort((left, right) => right.createdAt - left.createdAt);
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

async function dispatchWorkflow(context, ref) {
  const url = `${context.apiUrl}/repos/${context.repositoryPath}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const response = await context.fetchImpl(url, {
    method: "POST",
    headers: { ...context.headers, "content-type": "application/json" },
    body: JSON.stringify({ ref }),
  });
  if (!response.ok) {
    throw new Error(`failed to dispatch CI recovery (HTTP ${response.status})`);
  }
}

function parsePull(value) {
  const number = value?.number;
  const createdAt = Date.parse(value?.created_at);
  const draft = value?.draft;
  const url = value?.html_url;
  const ref = value?.head?.ref;
  const sha = value?.head?.sha;
  const headRepository = value?.head?.repo?.full_name;
  if (
    !Number.isInteger(number) ||
    number <= 0 ||
    !Number.isFinite(createdAt) ||
    typeof draft !== "boolean" ||
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
  return { number, createdAt, draft, url, ref, sha, headRepository };
}

function parseRun(value) {
  const id = value?.id;
  const status = value?.status;
  const event = value?.event;
  const createdAt = Date.parse(value?.created_at);
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    typeof status !== "string" ||
    status.length === 0 ||
    typeof event !== "string" ||
    event.length === 0 ||
    !Number.isFinite(createdAt)
  ) {
    throw new Error("CI workflow run response contained a malformed entry");
  }
  return { id, status, event, createdAt };
}

function baseSkipReason(pull, repository, now) {
  if (pull.draft) return "draft";
  if (pull.headRepository.toLowerCase() !== repository.toLowerCase()) return "fork_head";
  if (pull.createdAt > now - RECOVERY_GRACE_MS) return "grace_period";
  return null;
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
