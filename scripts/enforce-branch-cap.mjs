import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BRANCH_CAP = 40;

// How close to the cap counts as "warn now". A rollback is only surprising
// because nothing says it is coming: the count is invisible from a checkout,
// six concurrent sessions each create branches, and the first sign of trouble
// is a branch that silently stopped existing. Three creations of notice is
// enough to retire something before it bites (cave-iy3l7).
export const NEAR_CAP_HEADROOM = 3;

export function decideBranchCap({
  branchCount,
  createdBranch,
  defaultBranch,
  maxBranches = BRANCH_CAP,
}) {
  if (!Number.isInteger(branchCount) || branchCount < 0) {
    throw new Error(`branch count must be a non-negative integer; received ${branchCount}`);
  }
  if (!Number.isInteger(maxBranches) || maxBranches < 1 || maxBranches >= 100) {
    throw new Error(`branch cap must be an integer from 1 through 99; received ${maxBranches}`);
  }
  if (!createdBranch) throw new Error("created branch is required");
  if (!defaultBranch) throw new Error("default branch is required");

  if (branchCount <= maxBranches) {
    const headroom = maxBranches - branchCount;
    return {
      action: "allow",
      branchCount,
      maxBranches,
      headroom,
      nearCap: headroom <= NEAR_CAP_HEADROOM,
    };
  }
  if (createdBranch === defaultBranch) {
    return {
      action: "refuse-default",
      branchCount,
      maxBranches,
      branch: createdBranch,
    };
  }
  return {
    action: "delete-created",
    branchCount,
    maxBranches,
    branch: createdBranch,
  };
}

export function encodeBranchRef(branch) {
  if (!branch) throw new Error("branch is required");
  return encodeURIComponent(`heads/${branch}`);
}

export async function runBranchCap({
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
  error = console.error,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  const token = requiredEnv(env, "GITHUB_TOKEN");
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  const createdBranch = requiredEnv(env, "CREATED_BRANCH");
  const defaultBranch = requiredEnv(env, "DEFAULT_BRANCH");
  const apiUrl = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const maxBranches = parseBranchCap(env.MAX_BRANCHES);
  const repositoryPath = repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };

  const branchesResponse = await fetchImpl(
    `${apiUrl}/repos/${repositoryPath}/branches?per_page=100`,
    { headers },
  );
  if (!branchesResponse.ok) {
    throw new Error(`failed to list repository branches (HTTP ${branchesResponse.status})`);
  }

  const branches = await branchesResponse.json();
  if (!Array.isArray(branches)) throw new Error("branch-list response was not an array");

  const decision = decideBranchCap({
    branchCount: branches.length,
    createdBranch,
    defaultBranch,
    maxBranches,
  });

  if (decision.action === "allow") {
    log(`Branch count ${decision.branchCount}/${decision.maxBranches}; creation allowed.`);
    if (decision.nearCap) {
      // A warning while there is still room to act. Once the cap trips, the
      // branch is already gone and the advice arrives too late to be advice.
      const notice =
        `Branch cap: ${decision.branchCount}/${decision.maxBranches} — ` +
        `${decision.headroom} ${decision.headroom === 1 ? "creation" : "creations"} of headroom left. ` +
        `The next branch created past the cap is DELETED automatically. ` +
        `Free capacity by retiring merged worktrees (\`pnpm wt:status\`, then the archive-tag route ` +
        `in CLAUDE.md) rather than waiting for the rollback.`;
      log(`::warning::${notice}`);
      writeSummary(env, `⚠️ ${notice}`);
    }
    return 0;
  }

  if (decision.action === "refuse-default") {
    throw new Error(
      `repository branch cap ${decision.maxBranches} exceeded (${decision.branchCount} branches); ` +
        `refusing to delete the default branch '${decision.branch}'`,
    );
  }

  const deleteResponse = await fetchImpl(
    `${apiUrl}/repos/${repositoryPath}/git/refs/${encodeBranchRef(decision.branch)}`,
    { method: "DELETE", headers },
  );
  if (!deleteResponse.ok) {
    throw new Error(
      `failed to delete over-cap branch '${decision.branch}' (HTTP ${deleteResponse.status})`,
    );
  }

  // Say what happened, that the work is safe, and what to do — in the message
  // itself. A session that loses a branch sees only that it stopped existing;
  // before this it had to know branch-cap.yml existed to explain that
  // (cave-iy3l7). The deletion is REMOTE ONLY, which is the part that stops
  // the panic, so it leads.
  const explanation = [
    `Deleted the remote branch '${decision.branch}': the repository is at its ` +
      `${decision.maxBranches}-branch cap (${describeCount(decision)}), and this workflow rolls back ` +
      `the newly created branch rather than letting the count grow.`,
    `Your commits are NOT lost — the deletion is remote-only, so your local branch and worktree ` +
      `still hold them. In a Claude Code session the retention hook also archives an unreachable head ` +
      `as a \`retention/<branch>-<sha>\` tag, and tags are exempt from the cap.`,
    `To land the work: free capacity first (retire merged worktrees — \`pnpm wt:status\`, then the ` +
      `archive-tag route in CLAUDE.md), then push the branch again.`,
  ].join(" ");
  error(`::error::${explanation}`);
  writeSummary(env, `❌ ${explanation}`);
  return 1;
}

/** The count, honest about the API page limit rather than quietly understating.
 *  `per_page=100` means a repository past 100 branches reports exactly 100; the
 *  decision is unaffected (the cap is capped at 99) but the NUMBER would read
 *  as fact when it is a floor. */
function describeCount({ branchCount }) {
  return branchCount >= 100 ? "100+ branches" : `${branchCount} branches`;
}

/** Mirror a message into the workflow run summary. The `::error::`/`::warning::`
 *  annotations are easy to miss under a collapsed step; the summary is the part
 *  of the run page someone actually reads. Best-effort by design — a failure to
 *  write a summary must never change the enforcement outcome. */
function writeSummary(env, message) {
  const target = env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try {
    appendFileSync(target, `${message}\n`);
  } catch {
    // Non-fatal: the annotation above already carries the message.
  }
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBranchCap(value) {
  if (value === undefined || value === "") return BRANCH_CAP;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`MAX_BRANCHES must be a positive integer; received '${value}'`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed >= 100) {
    throw new Error(`MAX_BRANCHES must be from 1 through 99; received '${value}'`);
  }
  return parsed;
}

const isDirectRun =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  try {
    process.exitCode = await runBranchCap();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}
