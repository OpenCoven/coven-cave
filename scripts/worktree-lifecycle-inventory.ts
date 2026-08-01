import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  calculateLifecycleBudgets,
  classifyLifecycleUnit,
  classifyWorktree,
  isDisposableIgnoredPath,
  type ManagedCreationException,
  type WorktreeLifecycleBudgets,
  type WorktreeLifecycleItem,
  type WorktreeLifecycleMetadata,
  type WorktreeLifecycleObservation,
  type WorktreeObservation,
  type WorktreeProcessOwner,
  type WorktreeRemoteRef,
} from "../src/lib/worktree-lifecycle.ts";
import { beadIdsInText } from "../src/lib/beads-pr-management.ts";

export interface WorktreeLifecycleInventoryOptions {
  repo: string;
  root: string;
  nowMs: number;
}

export interface WorktreeLifecycleInventory {
  items: WorktreeLifecycleItem[];
  budgets: WorktreeLifecycleBudgets;
  inventoryFingerprint: string;
}

type CommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
};

type WorktreeEntry = {
  path: string;
  head: string;
  ref: string | null;
  branch: string | null;
  refError: string | null;
};

type LocalBranchRef = {
  ref: string;
  branch: string;
  oid: string;
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

type CovenSession = {
  id: string;
  projectRoot: string;
  status: string;
};

type BeadTask = {
  id: string;
  status: string;
  text: string;
  structured: StructuredMetadataRecord | null;
};

type StructuredMetadataRecord = {
  branch: string;
  path: string | null;
  metadata: WorktreeLifecycleMetadata | null;
  errors: string[];
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
const TERMINAL_SESSION_STATUSES = new Set([
  "completed",
  "failed",
  "killed",
  "stopped",
  "orphaned",
]);
const DISPOSITIONS = new Set(["active", "pr", "recovery", "archive"]);
const OID = /^[0-9a-f]{40,64}$/;
const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-](\d{2}):(\d{2}))$/;
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1]!;
}

function isCanonicalRfc3339Instant(value: string): boolean {
  const match = value.match(RFC3339_INSTANT);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , timezone, offsetHour, offsetMinute] =
    match;
  if (
    !isRealCalendarDate(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (timezone !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isIsoCalendarDate(value: string): boolean {
  const match = value.match(ISO_CALENDAR_DATE);
  return (
    match !== null &&
    isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  );
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
  if (!result.ok) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function parseWorktrees(raw: string): WorktreeEntry[] {
  return raw
    .split("\0\0")
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\0").filter(Boolean);
      const worktreeFields = fields.filter((field) => field.startsWith("worktree "));
      const headFields = fields.filter((field) => field.startsWith("HEAD "));
      const branchFields = fields.filter((field) => field.startsWith("branch "));
      if (worktreeFields.length !== 1 || headFields.length !== 1 || branchFields.length > 1) {
        throw new Error("malformed git worktree inventory");
      }
      const worktreePath = worktreeFields[0]!.slice("worktree ".length);
      const head = headFields[0]!.slice("HEAD ".length);
      if (!path.isAbsolute(worktreePath) || !OID.test(head)) {
        throw new Error("malformed git worktree inventory");
      }
      const ref = branchFields[0]?.slice("branch ".length) ?? null;
      if (ref === null) {
        return { path: worktreePath, head, ref: null, branch: null, refError: null };
      }
      const match = ref.match(/^refs\/heads\/(.+)$/);
      if (!match || !match[1]) {
        return {
          path: worktreePath,
          head,
          ref,
          branch: null,
          refError: `worktree ref is not a direct refs/heads ref: ${ref}`,
        };
      }
      return {
        path: worktreePath,
        head,
        ref,
        branch: match[1],
        refError: null,
      };
    });
}

function parseLocalBranchRefs(raw: string): LocalBranchRef[] {
  if (raw === "") return [];
  const chunks = raw.split("\0");
  if (chunks.pop() !== "\n" || chunks.length === 0) {
    throw new Error("malformed local branch inventory");
  }
  return chunks.map((chunk, index) => {
    const record = index === 0 ? chunk : chunk.startsWith("\n") ? chunk.slice(1) : "";
    const fields = record.split("\n");
    if (fields.length !== 2) throw new Error("malformed local branch inventory");
    const [ref, oid] = fields;
    const match = ref?.match(/^refs\/heads\/(.+)$/);
    if (!match || !match[1] || !oid || !OID.test(oid)) {
      throw new Error("malformed local branch inventory");
    }
    return { ref, branch: match[1], oid };
  });
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
      if (!record || !record.sawCwdField || record.cwd !== null || !path.isAbsolute(cwd)) {
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
  return {
    changes,
    ignoredPaths,
    nonDisposableIgnoredPaths: ignoredPaths.filter(
      (ignoredPath) => !isDisposableIgnoredPath(ignoredPath),
    ),
    error: null,
  };
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
  probeRoot: string,
  ref: string | null,
  exactMergeAt: string | null,
  includeWorktreeHead: boolean,
): { value: number | null; error: string | null } {
  const target = includeWorktreeHead ? "HEAD" : ref;
  if (!target) return { value: null, error: "branch/worktree recency unavailable" };
  const commit = git(probeRoot, ["log", "-1", "--format=%ct", target]);
  const reflogTargets = [
    ...(includeWorktreeHead ? ["HEAD"] : []),
    ...(ref ? [ref] : []),
  ];
  const reflogs = reflogTargets.map((reflogRef) =>
    git(probeRoot, [
      "reflog",
      "show",
      "-1",
      "--date=unix",
      "--format=%gd",
      reflogRef,
    ]),
  );
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
            isRecord(pr) &&
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
            typeof pr.headRefOid === "string" &&
            OID.test(pr.headRefOid),
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
            isRecord(page) &&
            Number.isInteger(page.total_count) &&
            page.total_count >= 0 &&
            Array.isArray(page.workflow_runs) &&
            page.workflow_runs.every(
              (run) =>
                isRecord(run) &&
                (run.head_branch === null || typeof run.head_branch === "string") &&
                typeof run.head_sha === "string" &&
                OID.test(run.head_sha) &&
                typeof run.html_url === "string" &&
                run.html_url.length > 0,
            ),
        )
      ) {
        throw new Error();
      }
      const totals = new Set(pages.map((page) => page.total_count));
      const stateRuns = pages.flatMap((page) => page.workflow_runs);
      if (totals.size !== 1) {
        return {
          runs: [],
          error: `workflow inventory returned inconsistent totals for ${state}`,
        };
      }
      const total = pages[0]!.total_count;
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
      !isRecord(parsed) ||
      !Array.isArray(parsed.claims) ||
      !parsed.claims.every(
        (claim) =>
          isRecord(claim) &&
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

function fetchSessions(root: string): { sessions: CovenSession[]; error: string | null } {
  const result = command("coven", ["sessions", "--json"], root);
  if (!result.ok) return { sessions: [], error: result.stderr || "Coven sessions unavailable" };
  try {
    const parsed = parseJson<{
      sessions: Array<{ id: string; project_root: string; status: string }>;
    }>(result.stdout, "Coven sessions");
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.sessions) ||
      !parsed.sessions.every(
        (session) =>
          isRecord(session) &&
          typeof session.id === "string" &&
          session.id.length > 0 &&
          typeof session.project_root === "string" &&
          path.isAbsolute(session.project_root) &&
          typeof session.status === "string" &&
          session.status.length > 0,
      )
    ) {
      throw new Error();
    }
    return {
      sessions: parsed.sessions.map((session) => ({
        id: session.id,
        projectRoot: normalizePath(session.project_root),
        status: session.status,
      })),
      error: null,
    };
  } catch {
    return { sessions: [], error: "Coven sessions returned malformed data" };
  }
}

function parseException(
  value: unknown,
  errors: string[],
): ManagedCreationException | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    errors.push("exception must be an object");
    return undefined;
  }
  const { owner, reason, expiresAt, additionalPaths } = value;
  if (typeof owner !== "string" || owner.trim().length === 0) {
    errors.push("exception owner must be a nonblank string");
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    errors.push("exception reason must be a nonblank string");
  }
  if (
    typeof expiresAt !== "string" ||
    !isCanonicalRfc3339Instant(expiresAt)
  ) {
    errors.push("exception expiresAt must be an RFC3339 timestamp");
  }
  if (
    !Array.isArray(additionalPaths) ||
    !additionalPaths.every(
      (candidate) => typeof candidate === "string" && path.isAbsolute(candidate),
    )
  ) {
    errors.push("exception additionalPaths must contain absolute paths");
  }
  if (
    typeof owner !== "string" ||
    typeof reason !== "string" ||
    typeof expiresAt !== "string" ||
    !Array.isArray(additionalPaths)
  ) {
    return undefined;
  }
  return {
    owner,
    reason,
    expiresAt,
    additionalPaths: additionalPaths.filter(
      (candidate): candidate is string => typeof candidate === "string",
    ),
  };
}

function parseStructuredMetadata(taskId: string, value: unknown): StructuredMetadataRecord | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error();
  if (value.coven === undefined || value.coven === null) return null;
  if (!isRecord(value.coven)) throw new Error();
  if (value.coven.worktree === undefined || value.coven.worktree === null) return null;
  if (!isRecord(value.coven.worktree)) throw new Error();

  const worktree = value.coven.worktree;
  const branch = typeof worktree.branch === "string" ? worktree.branch : "";
  if (!branch.trim()) throw new Error();
  const errors: string[] = [];
  const prefix = `Bead ${taskId} worktree metadata`;
  const metadataErrors = (message: string) => errors.push(`${prefix}: ${message}`);
  if (branch.startsWith("refs/heads/") || branch.trim() !== branch) {
    metadataErrors("branch must be an exact local branch name");
  }
  if (typeof worktree.path !== "string" || !path.isAbsolute(worktree.path)) {
    metadataErrors("path must be absolute");
  }
  if (typeof worktree.owner !== "string" || worktree.owner.trim().length === 0) {
    metadataErrors("owner must be a nonblank string");
  }
  if (typeof worktree.purpose !== "string" || worktree.purpose.trim().length === 0) {
    metadataErrors("purpose must be a nonblank string");
  }
  if (typeof worktree.disposition !== "string" || !DISPOSITIONS.has(worktree.disposition)) {
    metadataErrors("disposition is invalid");
  }
  if (
    typeof worktree.createdAt !== "string" ||
    !isCanonicalRfc3339Instant(worktree.createdAt)
  ) {
    metadataErrors("createdAt must be an RFC3339 timestamp");
  }
  if (
    worktree.reason !== undefined &&
    (typeof worktree.reason !== "string" || worktree.reason.trim().length === 0)
  ) {
    metadataErrors("reason must be a nonblank string");
  }
  if (
    worktree.reviewAfter !== undefined &&
    (typeof worktree.reviewAfter !== "string" ||
      !isIsoCalendarDate(worktree.reviewAfter))
  ) {
    metadataErrors("reviewAfter must be an ISO calendar date");
  }
  if (
    (worktree.disposition === "recovery" || worktree.disposition === "archive") &&
    (typeof worktree.reason !== "string" || typeof worktree.reviewAfter !== "string")
  ) {
    metadataErrors("recovery/archive dispositions require reason and reviewAfter");
  }
  const exceptionErrors: string[] = [];
  const exception = parseException(worktree.exception, exceptionErrors);
  for (const error of exceptionErrors) metadataErrors(error);

  const metadataPath = typeof worktree.path === "string" ? worktree.path : null;
  if (errors.length > 0) return { branch, path: metadataPath, metadata: null, errors };
  return {
    branch,
    path: metadataPath,
    metadata: {
      beadId: taskId.toLowerCase(),
      owner: worktree.owner as string,
      purpose: worktree.purpose as string,
      disposition: worktree.disposition as WorktreeLifecycleMetadata["disposition"],
      createdAt: worktree.createdAt as string,
      ...(typeof worktree.reason === "string" ? { reason: worktree.reason } : {}),
      ...(typeof worktree.reviewAfter === "string"
        ? { reviewAfter: worktree.reviewAfter }
        : {}),
      ...(exception ? { exception } : {}),
    },
    errors: [],
  };
}

function fetchTasks(root: string): { tasks: BeadTask[]; error: string | null } {
  const result = command(
    "bd",
    [
      "list",
      "--all",
      "--limit",
      "0",
      "--include-gates",
      "--include-infra",
      "--include-templates",
      "--json",
    ],
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
        metadata?: unknown;
      }>
    >(result.stdout, "Beads inventory");
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (task) =>
          isRecord(task) &&
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
      tasks: parsed.map((task) => ({
        id: task.id,
        status: task.status,
        text: [
          task.title ?? "",
          task.description ?? "",
          task.notes ?? "",
          task.external_ref ?? "",
        ].join("\n"),
        structured: parseStructuredMetadata(task.id, task.metadata),
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

function directRefError(root: string, ref: string): string | null {
  const result = git(root, ["symbolic-ref", "-q", ref]);
  if (result.status === 1) return null;
  if (result.status === 0) return `local branch ref is symbolic: ${ref}`;
  return result.stderr || `local ref directness check failed for ${ref}`;
}

function exactRemoteRef(root: string, ref: string): {
  remoteRef: WorktreeRemoteRef | null;
  error: string | null;
} {
  const result = git(root, ["ls-remote", "--exit-code", "--heads", "origin", ref], 60_000);
  if (result.status === 2) return { remoteRef: null, error: null };
  if (!result.ok) {
    return {
      remoteRef: null,
      error: result.stderr || `same-named remote ref probe failed for ${ref}`,
    };
  }
  const match = result.stdout.match(/^([0-9a-f]{40,64})\t([^\n]+)\n?$/);
  if (!match || match[2] !== ref) {
    return {
      remoteRef: null,
      error: `same-named remote ref probe returned malformed data for ${ref}`,
    };
  }
  return { remoteRef: { ref: match[2], oid: match[1] }, error: null };
}

function matchingTasks(
  branch: string | null,
  worktreePath: string | null,
  tasks: BeadTask[],
): string[] {
  if (!branch || PROTECTED_BRANCHES.has(branch)) return [];
  const branchBeadIds = new Set(beadIdsInText(branch));
  return tasks
    .filter((task) => task.status !== "closed")
    .filter(
      (task) =>
        task.structured?.branch === branch ||
        branchBeadIds.has(task.id.toLowerCase()) ||
        task.text.includes(branch) ||
        (worktreePath !== null && task.text.includes(worktreePath)),
    )
    .map((task) => task.id);
}

function metadataFor(
  branch: string | null,
  worktreePath: string | null,
  tasks: BeadTask[],
): { metadata: WorktreeLifecycleMetadata | null; errors: string[] } {
  if (!branch) return { metadata: null, errors: [] };
  const records = tasks
    .map((task) => task.structured)
    .filter((record): record is StructuredMetadataRecord => record?.branch === branch);
  if (records.length > 1) {
    return {
      metadata: null,
      errors: [`duplicate structured worktree metadata records for ${branch}`],
    };
  }
  const record = records[0];
  if (!record) return { metadata: null, errors: [] };
  if (record.errors.length > 0 || !record.metadata) {
    return { metadata: null, errors: record.errors };
  }
  if (worktreePath !== null && normalizePath(record.path!) !== normalizePath(worktreePath)) {
    return {
      metadata: null,
      errors: [`structured worktree metadata path does not match ${branch}`],
    };
  }
  return { metadata: record.metadata, errors: [] };
}

function activeSessionIds(worktreePath: string, sessions: CovenSession[]): string[] {
  const normalized = normalizePath(worktreePath);
  return sessions
    .filter(
      (session) =>
        session.projectRoot === normalized && !TERMINAL_SESSION_STATUSES.has(session.status),
    )
    .map((session) => session.id);
}

function fingerprint(worktreeRaw: string, refsRaw: string): string {
  return createHash("sha256")
    .update(String(Buffer.byteLength(worktreeRaw)))
    .update("\0")
    .update(worktreeRaw)
    .update(String(Buffer.byteLength(refsRaw)))
    .update("\0")
    .update(refsRaw)
    .digest("hex");
}

function classifyInventoryObservation(
  observation: WorktreeLifecycleObservation,
  nowMs: number,
): WorktreeLifecycleItem {
  if (observation.kind === "worktree" && observation.path !== null && observation.branch === null) {
    const { metadata: _metadata, ...legacyDetached } = observation;
    return classifyWorktree(legacyDetached as WorktreeObservation, nowMs);
  }
  return classifyLifecycleUnit(observation, nowMs);
}

export function collectWorktreeLifecycleInventory(
  options: WorktreeLifecycleInventoryOptions,
): WorktreeLifecycleInventory {
  const root = realpathSync(options.root);
  const commonGitDir = requiredGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]).trim();
  const primaryPath = normalizePath(path.dirname(commonGitDir));
  const initialWorktreeRaw = requiredGit(root, ["worktree", "list", "--porcelain", "-z"]);
  const initialRefsRaw = requiredGit(root, [
    "for-each-ref",
    "--format=%(refname)%0a%(objectname)%00",
    "refs/heads",
  ]);
  const entries = parseWorktrees(initialWorktreeRaw);
  const localRefs = parseLocalBranchRefs(initialRefsRaw);
  const localRefByName = new Map(localRefs.map((localRef) => [localRef.ref, localRef]));
  const registeredRefs = new Set(entries.flatMap((entry) => (entry.ref ? [entry.ref] : [])));

  const units = [
    ...entries.map((entry) => ({
      kind: "worktree" as const,
      path: entry.path,
      ref: entry.ref,
      branch: entry.branch,
      head: entry.head,
      initialErrors: [
        entry.refError,
        entry.ref && !localRefByName.has(entry.ref)
          ? `registered worktree ref is absent from local branch inventory: ${entry.ref}`
          : null,
        entry.ref &&
        localRefByName.has(entry.ref) &&
        localRefByName.get(entry.ref)!.oid !== entry.head
          ? `registered worktree HEAD differs from local branch ref: ${entry.ref}`
          : null,
      ].filter((error): error is string => error !== null),
    })),
    ...localRefs
      .filter((localRef) => !registeredRefs.has(localRef.ref))
      .map((localRef) => ({
        kind: "branch-only" as const,
        path: null,
        ref: localRef.ref,
        branch: localRef.branch,
        head: localRef.oid,
        initialErrors: [] as string[],
      })),
  ];

  const prs = fetchPullRequests(
    options.repo,
    root,
    units.flatMap((unit) => (unit.branch ? [unit.branch] : [])),
  );
  const workflows = fetchWorkflows(options.repo, root);
  const claims = fetchClaims(root);
  const sessions = fetchSessions(root);
  const tasks = fetchTasks(root);
  const processes = fetchProcessOwners();
  const branchGlobalErrors = [prs.error, workflows.error, claims.error, tasks.error].filter(
    (error): error is string => error !== null,
  );

  const observations: WorktreeLifecycleObservation[] = units.map((unit) => {
    const state = unit.path
      ? statusState(unit.path)
      : { changes: [], ignoredPaths: [], nonDisposableIgnoredPaths: [], error: null };
    const flags = unit.path ? indexFlags(unit.path) : { flags: [], error: null };
    const remoteRefs = refsContaining(root, unit.head);
    const ancestry = onDefaultBranch(root, unit.head);
    const branchPrs = unit.branch
      ? prs.pullRequests.filter((pr) => pr.head.ref === unit.branch)
      : [];
    const exactMerged = branchPrs.find(
      (pr) => pr.merged_at !== null && pr.head.sha === unit.head,
    );
    const latestMerged = exactMerged ?? branchPrs.find((pr) => pr.merged_at !== null);
    const recency = updatedAt(
      unit.path ?? root,
      unit.ref,
      exactMerged?.merged_at ?? null,
      unit.path !== null,
    );
    const remote = unit.ref
      ? exactRemoteRef(root, unit.ref)
      : { remoteRef: null, error: null };
    const metadata = metadataFor(unit.branch, unit.path, tasks.tasks);
    const openPrs = branchPrs
      .filter((pr) => pr.state === "open")
      .map((pr) => ({ number: pr.number, url: pr.html_url }));
    const activeWorkflowUrls = workflows.runs
      .filter(
        (run) =>
          run.head_sha === unit.head ||
          (unit.branch !== null && run.head_branch === unit.branch),
      )
      .map((run) => run.html_url);
    const pathErrors = unit.path ? [state.error, flags.error, processes.error, sessions.error] : [];
    const probeErrors = [
      ...unit.initialErrors,
      ...branchGlobalErrors,
      ...pathErrors,
      recency.error,
      remoteRefs.error,
      ancestry.error,
      remote.error,
      ...(unit.ref ? [directRefError(root, unit.ref)] : []),
    ].filter((error): error is string => error !== null);

    return {
      kind: unit.kind,
      path: unit.path,
      ref: unit.ref,
      branch: unit.branch,
      head: unit.head,
      isPrimary: unit.path !== null && normalizePath(unit.path) === primaryPath,
      protectedBranch: unit.branch !== null && PROTECTED_BRANCHES.has(unit.branch),
      changes: state.changes,
      ignoredPaths: state.ignoredPaths,
      nonDisposableIgnoredPaths: state.nonDisposableIgnoredPaths,
      indexFlags: flags.flags,
      processOwners: unit.path ? processOwnersFor(unit.path, processes.owners) : [],
      claimOwners: unit.branch
        ? claims.claims
            .filter((claim) => claim.branch === unit.branch && claim.state === "active")
            .map((claim) => claim.agent_id)
        : [],
      taskIds: matchingTasks(unit.branch, unit.path, tasks.tasks),
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
      metadata: metadata.metadata,
      metadataErrors: metadata.errors,
      remoteRef: remote.remoteRef,
      sessionIds:
        unit.path && sessions.error === null
          ? activeSessionIds(unit.path, sessions.sessions)
          : [],
    };
  });

  const finalWorktreeRaw = requiredGit(root, ["worktree", "list", "--porcelain", "-z"]);
  const finalRefsRaw = requiredGit(root, [
    "for-each-ref",
    "--format=%(refname)%0a%(objectname)%00",
    "refs/heads",
  ]);
  if (finalWorktreeRaw !== initialWorktreeRaw || finalRefsRaw !== initialRefsRaw) {
    throw new Error("worktree or branch inventory changed during patrol");
  }

  const structuredRecords = tasks.tasks
    .map((task) => task.structured)
    .filter((record): record is StructuredMetadataRecord => record !== null);
  const validMetadata = structuredRecords
    .filter(
      (record): record is StructuredMetadataRecord & { metadata: WorktreeLifecycleMetadata } =>
        record.errors.length === 0 && record.metadata !== null,
    )
    .filter(
      (record) =>
        structuredRecords.filter((candidate) => candidate.branch === record.branch).length === 1,
    )
    .filter((record) =>
      units.some(
        (unit) =>
          unit.branch === record.branch &&
          (unit.kind === "branch-only" || record.path === unit.path),
      ),
    );
  const exceptions = validMetadata.flatMap((record) =>
    record.metadata.exception ? [record.metadata.exception] : [],
  );
  const budgets = calculateLifecycleBudgets({
    worktreeCount: entries.length,
    branchCount: localRefs.length,
    activeExceptions: exceptions.filter(
      (exception) => Date.parse(exception.expiresAt) > options.nowMs,
    ).length,
    expiredExceptions: exceptions.filter(
      (exception) => Date.parse(exception.expiresAt) <= options.nowMs,
    ).length,
  });

  return {
    items: observations.map((observation) =>
      classifyInventoryObservation(observation, options.nowMs),
    ),
    budgets,
    inventoryFingerprint: fingerprint(initialWorktreeRaw, initialRefsRaw),
  };
}
