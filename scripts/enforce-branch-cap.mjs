import { pathToFileURL } from "node:url";

export const BRANCH_CAP = 40;

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
    return { action: "allow", branchCount, maxBranches };
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

  error(
    `::error::Deleted '${decision.branch}': repository branch cap ` +
      `${decision.maxBranches} exceeded (${decision.branchCount} branches).`,
  );
  return 1;
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
