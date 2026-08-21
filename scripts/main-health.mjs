// A push to `main` runs CI, and nothing reads the verdict. `enforce_admins` is
// off by the owner's standing instruction, so an admin push lands without the
// required `Frontend build` context ever gating it — the run still happens, it
// just fails into an empty room. On 2026-08-21 seven branches were merged
// locally and pushed direct between 00:29 and 01:22 CDT (six of them with no
// PR at all); `main` failed CI on every push from 1257258ce onward and the
// first person to notice was a session reading the commit list hours later.
//
// This closes the observation gap, not the permission one. It never blocks a
// push, never touches branch protection, and never reverts anything: it names
// the oldest known-failing commit in the streak adjacent to HEAD, says how that
// commit landed, and keeps ONE deduplicated tracking issue open until `main` is
// green again.
import { pathToFileURL } from "node:url";

export const DEFAULT_BRANCH = "main";
export const TRACKING_LABEL = "main-red";
const TRACKING_LABEL_COLOR = "b60205";
const TRACKING_LABEL_DESCRIPTION = "main is failing CI; filed by scripts/main-health.mjs";
const WORKFLOW_FILE = "ci.yml";
// Deep enough to walk back through a burst of direct pushes (the 2026-08-21
// burst was seven merges inside 53 minutes) and still find the last green head.
const MAX_COMMITS = 40;
const MAX_RUNS = 100;
const MAX_ISSUE_PAGES = 3;

// A conclusion that proves the tree was broken at that head. `cancelled` is
// NOT one: a push supersedes the previous run's concurrency group, so a busy
// stretch of `main` cancels healthy runs by design (see ci.yml's concurrency
// note). Reading a cancellation as a failure would attribute a red main to
// whichever commit happened to be pushed over.
const FAILING_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

export async function runMainHealth({
  apply = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  const token = requiredEnv(env, "GITHUB_TOKEN");
  const repository = requiredRepository(env.GITHUB_REPOSITORY);
  const branch = env.MAIN_HEALTH_BRANCH?.trim() || DEFAULT_BRANCH;
  const apiUrl = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const repositoryPath = repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const context = {
    apiUrl,
    repositoryPath,
    repository,
    branch,
    fetchImpl,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  };

  const commits = await listBranchCommits(context);
  if (commits.length === 0) throw new Error(`${branch} has no commits`);
  const verdicts = await pushVerdicts(context);
  const assessment = assess(commits, verdicts);

  if (assessment.status === "red") {
    assessment.culprit.landing = await classifyLanding(context, assessment.culprit);
  }

  const tracking = await findTrackingIssue(context);
  const actions = apply
    ? await reconcile(context, assessment, tracking)
    : plan(assessment, tracking);

  const result = {
    mode: apply ? "apply" : "report-only",
    branch,
    status: assessment.status,
    head: assessment.head,
    culprit: assessment.culprit,
    lastGood: assessment.lastGood,
    unattributed: assessment.unattributed,
    tracking: tracking ? { number: tracking.number, culprit: tracking.culprit } : null,
    actions,
  };

  report(log, result);
  return result;
}

// Walk newest → oldest. The culprit is the OLDEST commit that CI actually
// judged failing without a success in between, which is not the same as "the
// commit at HEAD" — a burst of direct pushes leaves several red heads and only
// the first one introduced the break.
function assess(commits, verdicts) {
  const head = describe(commits[0], verdicts);
  // Only `success` is green. Everything that is neither success nor a proven
  // failure — no run yet, `cancelled`, `action_required`, `neutral` — is
  // unknown, because the alternative is a cancelled head reading as green and
  // retracting a tracking issue that is still true.
  if (head.conclusion === "success") {
    return { status: "green", head, culprit: null, lastGood: head, unattributed: [] };
  }
  if (!FAILING_CONCLUSIONS.has(head.conclusion)) {
    return { status: "unknown", head, culprit: null, lastGood: null, unattributed: [] };
  }

  let culprit = head;
  let lastGood = null;
  // Commits CI never judged, or only ever cancelled. They cannot be cleared and
  // cannot be blamed, so they are carried into the report rather than dropped:
  // a silent skip here would read as "the streak is fully attributed".
  const unattributed = [];
  for (const raw of commits.slice(1)) {
    const commit = describe(raw, verdicts);
    if (commit.conclusion === "success") {
      lastGood = commit;
      break;
    }
    if (FAILING_CONCLUSIONS.has(commit.conclusion)) {
      culprit = commit;
      continue;
    }
    unattributed.push(commit);
  }

  return { status: "red", head, culprit, lastGood, unattributed };
}

function describe(commit, verdicts) {
  const run = verdicts.get(commit.sha);
  return {
    sha: commit.sha,
    subject: commit.subject,
    author: commit.author,
    committedAt: commit.committedAt,
    parents: commit.parents,
    mergedBranch: mergedBranchOf(commit.subject),
    conclusion: run?.conclusion,
    runId: run?.id,
    runUrl: run?.url,
  };
}

// GitHub Desktop writes both spellings; a `git merge origin/<branch>` from the
// CLI writes the remote-tracking one. Either way the branch name is the single
// most useful field in the report — it says whose work went in unchecked.
function mergedBranchOf(subject) {
  const match = /^Merge (?:remote-tracking )?branch '(?:origin\/)?([^']+)'/.exec(subject);
  return match?.[1] ?? null;
}

// How did this commit reach `main`? Squash-merging a PR sets that PR's
// `merge_commit_sha` to the commit it produced, so an exact match is proof.
// Anything weaker is not: `/commits/{sha}/pulls` also lists open PRs that
// merely CONTAIN the commit, which every PR branched off `main` afterwards
// does. Accusing one of those of a direct push would be a fabrication.
async function classifyLanding(context, commit) {
  const url =
    `${context.apiUrl}/repos/${context.repositoryPath}/commits/` +
    `${encodeURIComponent(commit.sha)}/pulls?per_page=100`;
  const response = await context.fetchImpl(url, { headers: context.headers });
  if (!response.ok) {
    // The association connection degrades under throttling and answers with an
    // error rather than an empty list. Treating that as "no PR" would blame a
    // commit that merged perfectly well, so an unavailable lookup stays
    // unavailable in the report.
    return { kind: "unknown", reason: `association_unavailable_${response.status}`, pulls: [] };
  }
  const pulls = asArray(await response.json())
    .map((pull) => ({
      number: Number(pull?.number),
      mergedAt: typeof pull?.merged_at === "string" ? pull.merged_at : null,
      mergeCommitSha: typeof pull?.merge_commit_sha === "string" ? pull.merge_commit_sha : null,
    }))
    .filter((pull) => Number.isInteger(pull.number));

  const landed = pulls.find((pull) => pull.mergedAt && pull.mergeCommitSha === commit.sha);
  if (landed) return { kind: "pull-request", pull: landed.number, pulls };
  if (commit.parents > 1) {
    return { kind: "direct-merge", branch: commit.mergedBranch, pulls };
  }
  return { kind: "direct-commit", pulls };
}

async function listBranchCommits(context) {
  const url =
    `${context.apiUrl}/repos/${context.repositoryPath}/commits` +
    `?sha=${encodeURIComponent(context.branch)}&per_page=${MAX_COMMITS}`;
  const payload = await getJson(context, url, "commit inventory");
  return asArray(payload).map((commit) => ({
    sha: String(commit?.sha ?? ""),
    subject: String(commit?.commit?.message ?? "").split("\n")[0],
    author: commit?.commit?.author?.name ?? commit?.author?.login ?? "unknown",
    committedAt: commit?.commit?.committer?.date ?? null,
    parents: asArray(commit?.parents).length,
  }));
}

// Workflow-scoped on purpose: `main` also collects Cave Performance and the CI
// recovery sweep, and a green run of either says nothing about the tree.
async function pushVerdicts(context) {
  const url =
    `${context.apiUrl}/repos/${context.repositoryPath}/actions/workflows/` +
    `${encodeURIComponent(WORKFLOW_FILE)}/runs` +
    `?branch=${encodeURIComponent(context.branch)}&event=push&status=completed&per_page=${MAX_RUNS}`;
  const payload = await getJson(context, url, "workflow run inventory");
  const verdicts = new Map();
  // Newest first, so the first entry for a head is its latest verdict — a
  // re-run of a failed head must be able to clear it.
  for (const run of asArray(payload?.workflow_runs)) {
    const sha = String(run?.head_sha ?? "");
    if (!sha || verdicts.has(sha)) continue;
    verdicts.set(sha, {
      id: run?.id,
      conclusion: typeof run?.conclusion === "string" ? run.conclusion : null,
      url: run?.html_url ?? null,
    });
  }
  return verdicts;
}

async function findTrackingIssue(context) {
  let url =
    `${context.apiUrl}/repos/${context.repositoryPath}/issues` +
    `?state=open&labels=${encodeURIComponent(TRACKING_LABEL)}&per_page=100`;
  for (let page = 0; page < MAX_ISSUE_PAGES && url; page += 1) {
    const response = await context.fetchImpl(url, { headers: context.headers });
    // Before the first issue is filed the label does not exist yet, and some
    // deployments answer an unknown label filter with 404 rather than [].
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`issue inventory failed: ${response.status}`);
    for (const issue of asArray(await response.json())) {
      // Pull requests come back from this endpoint too.
      if (issue?.pull_request) continue;
      const culprit = markedCulprit(String(issue?.body ?? ""));
      if (culprit) return { number: Number(issue.number), culprit, url: issue?.html_url ?? null };
    }
    url = nextLink(response.headers?.get?.("link"));
  }
  return null;
}

const MARKER = /<!--\s*main-health:culprit=([0-9a-f]{40})\s*-->/;

function markedCulprit(body) {
  return MARKER.exec(body)?.[1] ?? null;
}

function plan(assessment, tracking) {
  if (assessment.status === "red") {
    if (!tracking) return [{ action: "open-issue", culprit: assessment.culprit.sha }];
    if (tracking.culprit !== assessment.culprit.sha) {
      return [{ action: "retarget-issue", issue: tracking.number, culprit: assessment.culprit.sha }];
    }
    return [{ action: "none", reason: "already-tracked", issue: tracking.number }];
  }
  // Only a green verdict closes the issue. "No completed run for this head yet"
  // is the normal state for the first minutes after every push, and closing on
  // it would retract the report each time someone pushed over a red main.
  if (assessment.status === "green" && tracking) {
    return [{ action: "close-issue", issue: tracking.number }];
  }
  return [{ action: "none", reason: assessment.status === "green" ? "green" : "no-verdict" }];
}

async function reconcile(context, assessment, tracking) {
  const [intent] = plan(assessment, tracking);
  switch (intent.action) {
    case "open-issue": {
      await ensureTrackingLabel(context);
      const issue = await createIssue(context, {
        title: issueTitle(assessment),
        body: issueBody(context, assessment),
        labels: [TRACKING_LABEL],
      });
      return [{ ...intent, issue: issue.number, url: issue.url }];
    }
    case "retarget-issue": {
      // One tracking issue, retargeted rather than replaced: a second red
      // commit while the first is still open is the same outage, and a fresh
      // issue per push would have filed seven on 2026-08-21 alone.
      await commentOnIssue(
        context,
        tracking.number,
        `\`main\` is still red, and the oldest failing commit is now ` +
          `${assessment.culprit.sha.slice(0, 9)}. Details updated above.`,
      );
      await patchIssue(context, tracking.number, {
        title: issueTitle(assessment),
        body: issueBody(context, assessment),
      });
      return [intent];
    }
    case "close-issue": {
      await commentOnIssue(
        context,
        tracking.number,
        `\`main\` is green again at ${assessment.head.sha.slice(0, 9)}` +
          `${assessment.head.runUrl ? ` (${assessment.head.runUrl})` : ""}.`,
      );
      await patchIssue(context, tracking.number, { state: "closed" });
      return [intent];
    }
    default:
      return [intent];
  }
}

function issueTitle(assessment) {
  const { culprit } = assessment;
  return `main is red since ${culprit.sha.slice(0, 9)} — ${truncate(culprit.subject, 72)}`;
}

function issueBody(context, assessment) {
  const { head, culprit, lastGood, unattributed } = assessment;
  const lines = [
    `<!-- main-health:culprit=${culprit.sha} -->`,
    "",
    `\`${context.branch}\` is failing CI. Filed by \`scripts/main-health.mjs\`; it closes ` +
      `itself when \`${context.branch}\` is green again.`,
    "",
    "## Oldest failing commit",
    "",
    `- **${culprit.sha.slice(0, 9)}** — ${culprit.subject}`,
    `- Author: ${culprit.author}${culprit.committedAt ? ` · ${culprit.committedAt}` : ""}`,
    `- How it landed: ${landingSentence(culprit.landing)}`,
    culprit.runUrl ? `- Failing run: ${culprit.runUrl}` : null,
    "",
    "## Context",
    "",
    `- Current head: ${head.sha.slice(0, 9)} (${head.conclusion ?? "no verdict"})`,
    lastGood
      ? `- Last green commit: ${lastGood.sha.slice(0, 9)} — ${lastGood.subject}`
      : `- No green commit within the last ${MAX_COMMITS} on \`${context.branch}\`.`,
  ];

  if (unattributed.length > 0) {
    // Say what was dropped. Without this the streak reads as fully explained.
    lines.push(
      "",
      `- CI never returned a usable verdict for ${unattributed.length} commit` +
        `${unattributed.length === 1 ? "" : "s"} inside the streak, so ${
          unattributed.length === 1 ? "it is" : "they are"
        } neither blamed nor cleared: ` +
        unattributed.map((commit) => commit.sha.slice(0, 9)).join(", "),
    );
  }

  lines.push(
    "",
    "## Why this is filed at all",
    "",
    "Branch protection gates pull requests, not pushes, and the repository owner is",
    "exempt from it by standing instruction. A push that breaks the tree therefore runs",
    "CI and fails with nobody watching. This issue is that missing signal — it is not a",
    "request to change branch protection.",
  );

  return lines.filter((line) => line !== null).join("\n");
}

function landingSentence(landing) {
  switch (landing?.kind) {
    case "pull-request":
      return `squash-merged from PR #${landing.pull}`;
    case "direct-merge":
      return landing.branch
        ? `**pushed directly to the branch** — a local merge of \`${landing.branch}\`, no PR`
        : "**pushed directly to the branch** — a local merge commit, no PR";
    case "direct-commit":
      return "**pushed directly to the branch** — a single commit, no PR";
    default:
      return `undetermined (${landing?.reason ?? "no lookup"}) — GitHub did not answer the commit's pull-request association, so this says nothing either way`;
  }
}

// Create the label before the issue that carries it. GitHub is widely believed
// to create an unknown label implicitly on issue creation, and that belief is
// exactly the wrong thing to rest this on: if it does not, the POST fails, the
// whole apply throws, and the one path that reports a red `main` silently never
// runs. Creating it explicitly costs one request on the first filing and none
// afterwards.
async function ensureTrackingLabel(context) {
  const url =
    `${context.apiUrl}/repos/${context.repositoryPath}/labels/` +
    encodeURIComponent(TRACKING_LABEL);
  const existing = await context.fetchImpl(url, { headers: context.headers });
  if (existing.ok) return "exists";
  if (existing.status !== 404) {
    throw new Error(`label lookup failed: ${existing.status}`);
  }
  const created = await context.fetchImpl(
    `${context.apiUrl}/repos/${context.repositoryPath}/labels`,
    {
      method: "POST",
      headers: { ...context.headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: TRACKING_LABEL,
        color: TRACKING_LABEL_COLOR,
        description: TRACKING_LABEL_DESCRIPTION,
      }),
    },
  );
  // 422 here is the create-create race between two runs, not a failure.
  if (created.ok || created.status === 422) return "created";
  throw new Error(`label creation failed: ${created.status}`);
}

async function createIssue(context, { title, body, labels }) {
  const payload = await sendJson(
    context,
    `${context.apiUrl}/repos/${context.repositoryPath}/issues`,
    "POST",
    { title, body, labels },
  );
  return { number: Number(payload?.number), url: payload?.html_url ?? null };
}

async function patchIssue(context, number, fields) {
  await sendJson(
    context,
    `${context.apiUrl}/repos/${context.repositoryPath}/issues/${number}`,
    "PATCH",
    fields,
  );
}

async function commentOnIssue(context, number, body) {
  await sendJson(
    context,
    `${context.apiUrl}/repos/${context.repositoryPath}/issues/${number}/comments`,
    "POST",
    { body },
  );
}

function report(log, result) {
  const { status, head, culprit, lastGood } = result;
  if (status === "green") {
    log(`main-health: ${result.branch} is green at ${head.sha.slice(0, 9)}.`);
  } else if (status === "unknown") {
    log(
      `main-health: ${result.branch} head ${head.sha.slice(0, 9)} has no completed CI push run yet.`,
    );
  } else {
    log(`main-health: ${result.branch} is RED at ${head.sha.slice(0, 9)}.`);
    log(`  oldest failing commit ${culprit.sha.slice(0, 9)} ${culprit.subject}`);
    log(`  landed: ${stripMarkdown(landingSentence(culprit.landing))}`);
    log(
      lastGood
        ? `  last green ${lastGood.sha.slice(0, 9)} ${lastGood.subject}`
        : `  no green commit in the last ${MAX_COMMITS}`,
    );
    for (const commit of result.unattributed) {
      log(`  no verdict ${commit.sha.slice(0, 9)} ${commit.subject}`);
    }
  }
  for (const action of result.actions) {
    log(
      `  ${result.mode === "apply" ? "applied" : "would"} ${action.action}` +
        `${action.issue ? ` #${action.issue}` : ""}${action.reason ? ` (${action.reason})` : ""}`,
    );
  }
}

function stripMarkdown(value) {
  return value.replace(/\*\*/g, "").replace(/`/g, "");
}

async function getJson(context, url, what) {
  const response = await context.fetchImpl(url, { headers: context.headers });
  if (!response.ok) throw new Error(`${what} failed: ${response.status}`);
  return response.json();
}

async function sendJson(context, url, method, body) {
  const response = await context.fetchImpl(url, {
    method,
    headers: { ...context.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status}`);
  return response.json();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function truncate(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match?.[2].split(/\s+/).includes("next")) return match[1];
  }
  return null;
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
      console.log("Usage: node scripts/main-health.mjs [--apply] [--json]");
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
      const result = await runMainHealth({
        apply: options.apply,
        log: options.json ? () => {} : console.log,
      });
      if (options.json) console.log(JSON.stringify(result, null, 2));
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`main-health: ${message}`);
    process.exitCode = 1;
  }
}
