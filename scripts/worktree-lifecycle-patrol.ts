#!/usr/bin/env node --experimental-strip-types
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  classifyWorktree,
  isDisposableIgnoredPath,
  renderWorktreeLifecycleReport,
  summarizeWorktreeLifecycle,
  type WorktreeLifecycleItem,
  type WorktreeObservation,
  type WorktreeProcessOwner,
} from "../src/lib/worktree-lifecycle.ts";
import { beadIdsInText } from "../src/lib/beads-pr-management.ts";

type Options = {
  repo: string | null;
  root: string;
  json: boolean;
  nowMs: number;
};

type CommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
};

type WorktreeEntry = {
  path: string;
  head: string;
  branch: string | null;
};

type PullRequest = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  head: { ref: string; sha: string };
};

type WorkflowRun = {
  head_branch: string | null;
  head_sha: string;
  html_url: string;
};

const ACTIVE_WORKFLOW_STATES = [
  "queued",
  "in_progress",
  "requested",
  "waiting",
  "pending",
];
const PROTECTED_BRANCHES = new Set(["main", "__dolt_remote_info__"]);
const BEAD_STATUSES = new Set(["open", "in_progress", "blocked", "deferred", "closed"]);
const CLAIM_STATES = new Set(["active", "expired"]);

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: null,
    root: process.cwd(),
    json: false,
    nowMs: Date.now(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--":
        break;
      case "--repo":
        options.repo = argv[++index] ?? null;
        break;
      case "--root":
        options.root = argv[++index] ?? "";
        break;
      case "--json":
        options.json = true;
        break;
      case "--now": {
        const value = Date.parse(argv[++index] ?? "");
        if (!Number.isFinite(value)) throw new Error("--now requires an ISO timestamp");
        options.nowMs = value;
        break;
      }
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unsupported argument: ${arg}`);
    }
  }
  if (!options.repo || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(options.repo)) {
    throw new Error("--repo OWNER/REPO is required");
  }
  if (!path.isAbsolute(options.root)) throw new Error("--root must be an absolute path");
  return options;
}

function printHelp() {
  console.log(`Usage: node --experimental-strip-types scripts/worktree-lifecycle-patrol.ts --repo OWNER/REPO [--root PATH] [--json]

Builds a read-only lifecycle report for every registered worktree. The patrol
correlates local state with claims, Beads, pull requests, workflow runs, and
live process cwd ownership. It never removes worktrees or branches.`);
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  timeout = 30_000,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
  };
}

function git(root: string, args: string[], timeout?: number): CommandResult {
  return command("git", ["-C", root, ...args], root, timeout);
}

function requiredGit(root: string, args: string[]): string {
  const result = git(root, args);
  if (!result.ok) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function parseWorktrees(raw: string): WorktreeEntry[] {
  const records = raw.split("\0\0").filter(Boolean);
  return records.map((record) => {
    const fields = record.split("\0").filter(Boolean);
    const worktree = fields.find((field) => field.startsWith("worktree "));
    const head = fields.find((field) => field.startsWith("HEAD "));
    const branch = fields.find((field) => field.startsWith("branch "));
    if (!worktree || !head) throw new Error("malformed git worktree inventory");
    return {
      path: worktree.slice("worktree ".length),
      head: head.slice("HEAD ".length),
      branch: branch?.slice("branch refs/heads/".length) ?? null,
    };
  });
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
}

function normalizePath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function parseProcessOwners(raw: string): {
  owners: Array<WorktreeProcessOwner & { cwd: string }>;
  partial: boolean;
} {
  const owners: Array<WorktreeProcessOwner & { cwd: string }> = [];
  let record:
    | {
        pid: number | null;
        command: string | null;
        sawCwdField: boolean;
        cwd: string | null;
      }
    | null = null;
  let partial = false;

  const finishRecord = () => {
    if (!record) return;
    if (
      record.pid === null ||
      record.command === null ||
      !record.sawCwdField ||
      record.cwd === null
    ) {
      partial = true;
    } else {
      owners.push({ pid: record.pid, command: record.command, cwd: record.cwd });
    }
  };

  for (const line of raw.split("\n")) {
    if (!line) continue;
    const pidMatch = line.match(/^p([1-9]\d*)$/);
    if (pidMatch) {
      finishRecord();
      const pid = Number(pidMatch[1]);
      record = {
        pid: Number.isSafeInteger(pid) ? pid : null,
        command: null,
        sawCwdField: false,
        cwd: null,
      };
      if (record.pid === null) partial = true;
    } else if (line.startsWith("p")) {
      finishRecord();
      record = { pid: null, command: null, sawCwdField: false, cwd: null };
      partial = true;
    } else if (line.startsWith("c")) {
      if (!record || record.command !== null || line.length === 1) partial = true;
      else record.command = line.slice(1);
    } else if (line === "fcwd") {
      if (!record || record.sawCwdField) partial = true;
      else record.sawCwdField = true;
    } else if (line.startsWith("n")) {
      const cwd = line.slice(1);
      if (
        !record ||
        !record.sawCwdField ||
        record.cwd !== null ||
        !path.isAbsolute(cwd)
      ) {
        partial = true;
      } else {
        record.cwd = normalizePath(cwd);
      }
    } else {
      partial = true;
    }
  }
  finishRecord();
  return { owners, partial };
}

function processOwnersFor(
  worktreePath: string,
  owners: Array<WorktreeProcessOwner & { cwd: string }>,
): WorktreeProcessOwner[] {
  const root = normalizePath(worktreePath);
  const prefix = `${root}${path.sep}`;
  return owners
    .filter((owner) => owner.cwd === root || owner.cwd.startsWith(prefix))
    .map(({ pid, command: processCommand }) => ({ pid, command: processCommand }));
}

function statusState(root: string): {
  changes: string[];
  ignoredPaths: string[];
  nonDisposableIgnoredPaths: string[];
  error: string | null;
} {
  const result = git(root, [
    "-c",
    "status.showUntrackedFiles=all",
    "-c",
    "core.fileMode=true",
    "-c",
    "core.fsmonitor=false",
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
    "--ignore-submodules=none",
  ]);
  if (!result.ok) {
    return {
      changes: [],
      ignoredPaths: [],
      nonDisposableIgnoredPaths: [],
      error: result.stderr || "git status failed",
    };
  }
  const entries = result.stdout.split("\0").filter(Boolean);
  const changes = entries.filter((entry) => !entry.startsWith("# ") && !entry.startsWith("! "));
  const ignoredPaths = entries
    .filter((entry) => entry.startsWith("! "))
    .map((entry) => entry.slice(2));
  const nonDisposableIgnoredPaths = ignoredPaths.filter(
    (ignoredPath) => !isDisposableIgnoredPath(ignoredPath),
  );
  return { changes, ignoredPaths, nonDisposableIgnoredPaths, error: null };
}

function indexFlags(root: string): { flags: string[]; error: string | null } {
  const result = git(root, ["ls-files", "-v", "-z"]);
  if (!result.ok) {
    return { flags: [], error: result.stderr || "git index flag inventory failed" };
  }
  return {
    flags: result.stdout
      .split("\0")
      .filter((entry) => /^[a-zS] /.test(entry)),
    error: null,
  };
}

function updatedAt(
  root: string,
  branch: string | null,
  exactMergeAt: string | null,
): {
  value: number | null;
  error: string | null;
} {
  const commit = git(root, ["log", "-1", "--format=%ct", "HEAD"]);
  const reflogs = [
    git(root, ["reflog", "show", "-1", "--date=unix", "--format=%gd", "HEAD"]),
    ...(branch
      ? [
          git(root, [
            "reflog",
            "show",
            "-1",
            "--date=unix",
            "--format=%gd",
            `refs/heads/${branch}`,
          ]),
        ]
      : []),
  ];
  const epochs: number[] = [];
  if (commit.ok && /^\d+$/.test(commit.stdout.trim())) {
    epochs.push(Number(commit.stdout.trim()) * 1000);
  }
  for (const reflog of reflogs) {
    const match = reflog.stdout.trim().match(/@\{(\d+)\}$/);
    if (reflog.ok && match) epochs.push(Number(match[1]) * 1000);
  }
  if (exactMergeAt !== null) {
    const mergeEpoch = Date.parse(exactMergeAt);
    if (Number.isFinite(mergeEpoch)) epochs.push(mergeEpoch);
  }
  if (
    epochs.length === 0 ||
    !commit.ok ||
    !/^\d+$/.test(commit.stdout.trim()) ||
    reflogs.some(
      (reflog) => !reflog.ok || !/@\{(\d+)\}$/.test(reflog.stdout.trim()),
    )
  ) {
    return {
      value: epochs.length > 0 ? Math.max(...epochs) : null,
      error: "branch/worktree recency unavailable",
    };
  }
  return { value: Math.max(...epochs), error: null };
}

function fetchPullRequests(
  repo: string,
  root: string,
  branches: string[],
): { pullRequests: PullRequest[]; error: string | null } {
  const pullRequests: PullRequest[] = [];
  for (const branch of [...new Set(branches)].filter((name) => !PROTECTED_BRANCHES.has(name))) {
    const result = command(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "all",
        "--head",
        branch,
        "--limit",
        "101",
        "--json",
        "number,url,state,isDraft,mergedAt,baseRefName,headRefName,headRefOid",
      ],
      root,
      60_000,
    );
    if (!result.ok) {
      return {
        pullRequests: [],
        error: result.stderr || `pull request inventory unavailable for ${branch}`,
      };
    }
    try {
      const parsed = parseJson<
        Array<{
          number: number;
          url: string;
          state: "OPEN" | "CLOSED" | "MERGED";
          isDraft: boolean;
          mergedAt: string | null;
          baseRefName: string;
          headRefName: string;
          headRefOid: string;
        }>
      >(result.stdout, `GitHub pull request inventory for ${branch}`);
      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          (pr) =>
            Number.isInteger(pr.number) &&
            typeof pr.url === "string" &&
            (pr.state === "OPEN" || pr.state === "CLOSED" || pr.state === "MERGED") &&
            typeof pr.isDraft === "boolean" &&
            (pr.state === "MERGED"
              ? typeof pr.mergedAt === "string" && Number.isFinite(Date.parse(pr.mergedAt))
              : pr.mergedAt === null) &&
            typeof pr.baseRefName === "string" &&
            pr.baseRefName.length > 0 &&
            pr.headRefName === branch &&
            /^[0-9a-f]{40,64}$/.test(pr.headRefOid),
        )
      ) {
        throw new Error();
      }
      if (parsed.length >= 101) {
        return {
          pullRequests: [],
          error: `pull request inventory exceeded the safe per-branch limit for ${branch}`,
        };
      }
      pullRequests.push(
        ...parsed.map((pr): PullRequest => ({
          number: pr.number,
          html_url: pr.url,
          state: pr.state === "OPEN" ? "open" : "closed",
          draft: pr.isDraft,
          merged_at:
            pr.state === "MERGED" && pr.baseRefName === "main" ? pr.mergedAt : null,
          head: { ref: pr.headRefName, sha: pr.headRefOid },
        })),
      );
    } catch {
      return {
        pullRequests: [],
        error: `pull request inventory returned malformed data for ${branch}`,
      };
    }
  }
  return { pullRequests, error: null };
}

function fetchWorkflows(
  repo: string,
  root: string,
): { runs: WorkflowRun[]; error: string | null } {
  const runs: WorkflowRun[] = [];
  for (const state of ACTIVE_WORKFLOW_STATES) {
    const result = command(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "--paginate",
        "--slurp",
        "-X",
        "GET",
        `repos/${repo}/actions/runs`,
        "-f",
        "per_page=100",
        "-f",
        `status=${state}`,
      ],
      root,
      120_000,
    );
    if (!result.ok) {
      return { runs: [], error: result.stderr || `workflow inventory failed for ${state}` };
    }
    try {
      const pages = parseJson<Array<{ total_count: number; workflow_runs: WorkflowRun[] }>>(
        result.stdout,
        "GitHub workflow inventory",
      );
      if (
        !Array.isArray(pages) ||
        pages.length === 0 ||
        !pages.every(
          (page) =>
            page !== null &&
            typeof page === "object" &&
            Number.isInteger(page.total_count) &&
            page.total_count >= 0 &&
            Array.isArray(page.workflow_runs) &&
            page.workflow_runs.every(
              (run) =>
                run !== null &&
                typeof run === "object" &&
                (run.head_branch === null || typeof run.head_branch === "string") &&
                typeof run.head_sha === "string" &&
                /^[0-9a-f]{40,64}$/.test(run.head_sha) &&
                typeof run.html_url === "string" &&
                run.html_url.length > 0,
            ),
        )
      ) {
        throw new Error();
      }
      const firstPage = pages[0];
      if (!firstPage) throw new Error();
      const totals = new Set(pages.map((page) => page.total_count));
      const stateRuns = pages.flatMap((page) => page.workflow_runs);
      if (totals.size !== 1) {
        return {
          runs: [],
          error: `workflow inventory returned inconsistent totals for ${state}`,
        };
      }
      const total = firstPage.total_count;
      if (total >= 1_000) {
        return {
          runs: [],
          error: `workflow inventory reached GitHub's 1000-run cap for ${state}`,
        };
      }
      if (stateRuns.length !== total) {
        return {
          runs: [],
          error: `workflow inventory returned partial data for ${state}`,
        };
      }
      runs.push(...stateRuns);
    } catch {
      return { runs: [], error: `workflow inventory returned malformed data for ${state}` };
    }
  }
  return { runs, error: null };
}

function fetchClaims(root: string): {
  claims: Array<{ branch: string; agent_id: string; state: string }>;
  error: string | null;
} {
  const result = command("coven", ["claim", "status", "--json"], root);
  if (!result.ok) return { claims: [], error: result.stderr || "Coven claims unavailable" };
  try {
    const parsed = parseJson<{
      claims: Array<{ branch: string; agent_id: string; state: string }>;
    }>(result.stdout, "Coven claims");
    if (
      !Array.isArray(parsed.claims) ||
      !parsed.claims.every(
        (claim) =>
          claim !== null &&
          typeof claim === "object" &&
          typeof claim.branch === "string" &&
          claim.branch.length > 0 &&
          typeof claim.agent_id === "string" &&
          claim.agent_id.length > 0 &&
          typeof claim.state === "string" &&
          CLAIM_STATES.has(claim.state),
      )
    ) {
      throw new Error();
    }
    return { claims: parsed.claims, error: null };
  } catch {
    return { claims: [], error: "Coven claims returned malformed data" };
  }
}

function fetchTasks(root: string): {
  tasks: Array<{ id: string; status: string; text: string }>;
  error: string | null;
} {
  const result = command(
    "bd",
    ["list", "--limit", "0", "--include-gates", "--include-infra", "--include-templates", "--json"],
    root,
    120_000,
  );
  if (!result.ok) return { tasks: [], error: result.stderr || "Beads inventory unavailable" };
  try {
    const parsed = parseJson<
      Array<{
        id: string;
        status: string;
        title?: string;
        description?: string;
        notes?: string;
        external_ref?: string;
      }>
    >(result.stdout, "Beads inventory");
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (task) =>
          task !== null &&
          typeof task === "object" &&
          typeof task.id === "string" &&
          task.id.length > 0 &&
          typeof task.status === "string" &&
          BEAD_STATUSES.has(task.status) &&
          typeof task.title === "string" &&
          (task.description === undefined ||
            task.description === null ||
            typeof task.description === "string") &&
          (task.notes === undefined || task.notes === null || typeof task.notes === "string") &&
          (task.external_ref === undefined ||
            task.external_ref === null ||
            typeof task.external_ref === "string"),
      )
    ) {
      throw new Error();
    }
    return {
      tasks: parsed
        .filter((task) => task.status !== "closed")
        .map((task) => ({
          id: task.id,
          status: task.status,
          text: [
            task.title ?? "",
            task.description ?? "",
            task.notes ?? "",
            task.external_ref ?? "",
          ].join("\n"),
        })),
      error: null,
    };
  } catch {
    return { tasks: [], error: "Beads inventory returned malformed data" };
  }
}

function fetchProcessOwners(): {
  owners: Array<WorktreeProcessOwner & { cwd: string }>;
  error: string | null;
} {
  const result = command("lsof", ["-d", "cwd", "-F", "pcn"], path.parse(process.cwd()).root);
  const parsed = parseProcessOwners(result.stdout);
  if (!result.ok) {
    return {
      owners: parsed.owners,
      error: result.stderr || "process cwd inventory unavailable",
    };
  }
  if (result.stderr) {
    return {
      owners: parsed.owners,
      error: "process cwd inventory reported incomplete data",
    };
  }
  if (!result.stdout.trim() || parsed.partial) {
    return {
      owners: parsed.owners,
      error: "process cwd inventory returned malformed or partial data",
    };
  }
  return { owners: parsed.owners, error: null };
}

function refsContaining(root: string, head: string): {
  refs: string[];
  error: string | null;
} {
  const result = git(root, ["branch", "-r", "--contains", head, "--format=%(refname:short)"]);
  if (!result.ok) return { refs: [], error: result.stderr || "remote containment check failed" };
  return {
    refs: result.stdout
      .split("\n")
      .map((ref) => ref.trim())
      .filter(Boolean),
    error: null,
  };
}

function onDefaultBranch(root: string, head: string): {
  value: boolean;
  error: string | null;
} {
  const result = git(root, ["merge-base", "--is-ancestor", head, "refs/remotes/origin/main"]);
  if (result.status === 0) return { value: true, error: null };
  if (result.status === 1) return { value: false, error: null };
  return { value: false, error: result.stderr || "default-branch ancestry check failed" };
}

function matchingTasks(
  branch: string | null,
  worktreePath: string,
  tasks: Array<{ id: string; text: string }>,
): string[] {
  if (!branch || PROTECTED_BRANCHES.has(branch)) return [];
  const branchBeadIds = new Set(beadIdsInText(branch));
  return tasks
    .filter(
      (task) =>
        branchBeadIds.has(task.id.toLowerCase()) ||
        task.text.includes(branch) ||
        task.text.includes(worktreePath),
    )
    .map((task) => task.id);
}

function collect(options: Options): WorktreeLifecycleItem[] {
  const root = realpathSync(options.root);
  const commonGitDir = requiredGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]).trim();
  const primaryPath = normalizePath(path.dirname(commonGitDir));
  const initialRaw = requiredGit(root, ["worktree", "list", "--porcelain", "-z"]);
  const entries = parseWorktrees(initialRaw);

  const prs = fetchPullRequests(
    options.repo!,
    root,
    entries.flatMap((entry) => (entry.branch ? [entry.branch] : [])),
  );
  const workflows = fetchWorkflows(options.repo!, root);
  const claims = fetchClaims(root);
  const tasks = fetchTasks(root);
  const processes = fetchProcessOwners();
  const globalErrors = [prs.error, workflows.error, claims.error, tasks.error, processes.error].filter(
    (error): error is string => error !== null,
  );

  const observations: WorktreeObservation[] = entries.map((entry) => {
    const state = statusState(entry.path);
    const flags = indexFlags(entry.path);
    const remoteRefs = refsContaining(entry.path, entry.head);
    const ancestry = onDefaultBranch(entry.path, entry.head);
    const branchPrs = entry.branch
      ? prs.pullRequests.filter((pr) => pr.head.ref === entry.branch)
      : [];
    const exactMerged = branchPrs.find(
      (pr) => pr.merged_at !== null && pr.head.sha === entry.head,
    );
    const latestMerged = exactMerged ?? branchPrs.find((pr) => pr.merged_at !== null);
    const recency = updatedAt(entry.path, entry.branch, exactMerged?.merged_at ?? null);
    const openPrs = branchPrs
      .filter((pr) => pr.state === "open")
      .map((pr) => ({ number: pr.number, url: pr.html_url }));
    const activeWorkflowUrls = workflows.runs
      .filter(
        (run) =>
          run.head_sha === entry.head ||
          (entry.branch !== null && run.head_branch === entry.branch),
      )
      .map((run) => run.html_url);
    const probeErrors = [
      ...globalErrors,
      state.error,
      flags.error,
      recency.error,
      remoteRefs.error,
      ancestry.error,
    ].filter((error): error is string => error !== null);

    return {
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      isPrimary: normalizePath(entry.path) === primaryPath,
      protectedBranch: entry.branch !== null && PROTECTED_BRANCHES.has(entry.branch),
      changes: state.changes,
      ignoredPaths: state.ignoredPaths,
      nonDisposableIgnoredPaths: state.nonDisposableIgnoredPaths,
      indexFlags: flags.flags,
      processOwners: processOwnersFor(entry.path, processes.owners),
      claimOwners: entry.branch
        ? claims.claims
            .filter((claim) => claim.branch === entry.branch && claim.state === "active")
            .map((claim) => claim.agent_id)
        : [],
      taskIds: matchingTasks(entry.branch, entry.path, tasks.tasks),
      openPrs,
      mergedPr: latestMerged
        ? {
            number: latestMerged.number,
            url: latestMerged.html_url,
            headOid: latestMerged.head.sha,
          }
        : null,
      activeWorkflowUrls,
      headOnDefaultBranch: ancestry.value,
      remoteRefsContainingHead: remoteRefs.refs,
      updatedAtMs: recency.value,
      probeErrors,
    };
  });

  const finalRaw = requiredGit(root, ["worktree", "list", "--porcelain", "-z"]);
  if (finalRaw !== initialRaw) {
    throw new Error("worktree inventory changed during patrol; rerun against a stable inventory");
  }

  return observations.map((observation) =>
    classifyWorktree(observation, options.nowMs),
  );
}

try {
  const options = parseArgs(process.argv.slice(2));
  const items = collect(options);
  const summary = summarizeWorktreeLifecycle(items);
  console.log(
    options.json
      ? JSON.stringify({ ok: true, generatedAt: new Date(options.nowMs).toISOString(), ...summary }, null, 2)
      : renderWorktreeLifecycleReport(summary),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`worktree-lifecycle-patrol: ${message}`);
  process.exit(1);
}
