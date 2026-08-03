import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { devNull } from "node:os";

import path from "node:path";
import {
  calculateLifecycleBudgets,
  classifyLifecycleUnit,
  classifyWorktree,
  isDisposableIgnoredPath,
  normalizeAbsoluteWorktreePath,
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
  /**
   * Failures of a whole probe rather than of one unit — GitHub unreachable, the
   * canonical repository unresolvable, the Beads or workflow inventory
   * unreadable. They are also folded into every unit's `probeErrors` so each
   * unit fails closed on its own, but callers that need to tell "the run could
   * not see the repo" apart from "this unit has an unprovable landing time"
   * read them here (cave-t9tlm).
   */
  globalErrors: string[];
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

type RemoteDefaultBranch = {
  branch: string | null;
  remoteRef: string | null;
  localTrackingRef: string | null;
  oid: string | null;
  error: string | null;
};

type OriginRepositoryIdentity = {
  repository: string | null;
  error: string | null;
};

type PullRequest = {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  mergedAt: string | null;
  headRefName: string;
  headRefOid: string;
  headRepository: string | null;
  baseRefName: string;
  baseRepository: string;
};

type PullRequestInventory = {
  byOid: Map<string, PullRequest[]>;
  byBranch: Map<string, PullRequest[]>;
  errorsByOid: Map<string, string>;
  errorsByBranch: Map<string, string>;
  globalErrors: string[];
  canonicalRepo: string | null;
};

type WorkflowRun = {
  id: number;
  status: string;
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
  structured: StructuredMetadataRecord[];
  structuredErrors: string[];
};

type StructuredMetadataRecord = {
  branch: string;
  path: string | null;
  metadata: WorktreeLifecycleMetadata | null;
  errors: string[];
};

type StructuredMetadataParse = {
  records: StructuredMetadataRecord[];
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
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/;
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HISTORY_OVERRIDE_DRIFT_ERROR = "history override inventory changed during patrol";

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
  env: NodeJS.ProcessEnv = process.env,
): CommandResult {
  try {
    const result = spawnSync(executable, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const spawnError = result.error instanceof Error ? result.error.message : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    return {
      ok: result.status === 0 && spawnError.length === 0,
      status: result.status,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: [stderr, spawnError].filter(Boolean).join(": "),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: `${executable} invocation failed: ${
        error instanceof Error ? error.message : "unknown spawn error"
      }`,
    };
  }
}

const UNSAFE_GIT_ENVIRONMENT = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_PREFIX",
  "GIT_EXEC_PATH",
  "GIT_OPTIONAL_LOCKS",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_QUARANTINE_PATH",
  "GIT_LITERAL_PATHSPECS",
  "GIT_GLOB_PATHSPECS",
  "GIT_NOGLOB_PATHSPECS",
  "GIT_ICASE_PATHSPECS",
  "GIT_ATTR_NOSYSTEM",
  "GIT_EXTERNAL_DIFF",
  "GIT_DIFF_OPTS",
  "GIT_REF_PARANOIA",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_COUNT",
]);

function sanitizedGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const canonicalKey = key.toUpperCase();
    if (
      UNSAFE_GIT_ENVIRONMENT.has(canonicalKey) ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(canonicalKey)

    ) {
      delete env[key];
    }
  }
  env.GIT_GRAFT_FILE = devNull;
  return env;
}

function git(root: string, args: string[], timeout?: number): CommandResult {
  const result = command(
    "git",
    [
      "--no-optional-locks",
      "--no-replace-objects",
      "-c",
      "advice.graftFileDeprecated=false",
      "-C",
      root,
      ...args,
    ],
    root,
    timeout,
    sanitizedGitEnvironment(),
  );
  if (result.status === 0 && result.stderr.length > 0) {
    return { ...result, ok: false };
  }
  return result;

}

function requiredGit(root: string, args: string[]): string {
  const result = git(root, args);
  if (!result.ok || result.stderr) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
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
  const normalizedCandidate = normalizeAbsoluteWorktreePath(candidate);
  if (normalizedCandidate === null) {
    throw new Error("invalid absolute worktree path");
  }
  try {
    const realPath = normalizeAbsoluteWorktreePath(realpathSync(normalizedCandidate));
    if (realPath === null) throw new Error("invalid resolved worktree path");
    return realPath;
  } catch {
    return normalizedCandidate;
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
      const normalizedWorktreePath = normalizeAbsoluteWorktreePath(worktreePath);
      const head = headFields[0]!.slice("HEAD ".length);
      if (normalizedWorktreePath === null || !OID.test(head)) {
        throw new Error("malformed git worktree inventory");
      }
      const ref = branchFields[0]?.slice("branch ".length) ?? null;
      if (ref === null) {
        return {
          path: normalizedWorktreePath,

          head,
          ref: null,
          branch: null,
          refError: null,
        };
      }
      const match = ref.match(/^refs\/heads\/(.+)$/);
      if (!match || !match[1]) {
        return {
          path: normalizedWorktreePath,
          head,
          ref,
          branch: null,
          refError: `worktree ref is not a direct refs/heads ref: ${ref}`,
        };
      }
      return {
        path: normalizedWorktreePath,
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
  const seen = new Set<string>();
  return chunks.map((chunk, index) => {
    const record = index === 0 ? chunk : chunk.startsWith("\n") ? chunk.slice(1) : "";
    const fields = record.split("\n");
    if (fields.length !== 2) throw new Error("malformed local branch inventory");
    const [ref, oid] = fields;
    const match = ref?.match(/^refs\/heads\/(.+)$/);
    if (!match || !match[1] || !oid || !OID.test(oid)) {
      throw new Error("malformed local branch inventory");
    }
    if (seen.has(ref)) {
      throw new Error(`duplicate local branch ref: ${ref}`);
    }
    seen.add(ref);
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
      const normalizedCwd = normalizeAbsoluteWorktreePath(cwd);
      if (!record || !record.sawCwdField || record.cwd !== null || normalizedCwd === null) {
        partial = true;
      } else {
        record.cwd = normalizePath(normalizedCwd);
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
    "status.relativePaths=false",
    "-c",
    "core.fileMode=true",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "core.ignoreStat=false",
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
    "--ignore-submodules=none",
    "--no-renames",
  ]);
  if (!result.ok || result.stderr) {
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
  if (!result.ok || result.stderr) {
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
  exactDefaultLandingAtMs: number | null,

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
  if (commit.ok && !commit.stderr && /^\d+$/.test(commit.stdout.trim())) {
    epochs.push(Number(commit.stdout.trim()) * 1000);
  }
  for (const reflog of reflogs) {
    const match = reflog.stdout.trim().match(/@\{(\d+)\}$/);
    if (reflog.ok && !reflog.stderr && match) epochs.push(Number(match[1]) * 1000);
  }
  if (exactMergeAt !== null) {
    const mergeEpoch = Date.parse(exactMergeAt);
    if (Number.isFinite(mergeEpoch)) epochs.push(mergeEpoch);
  }
  if (exactDefaultLandingAtMs !== null) {
    epochs.push(exactDefaultLandingAtMs);
  }

  if (
    epochs.length === 0 ||
    !commit.ok ||
    Boolean(commit.stderr) ||
    !/^\d+$/.test(commit.stdout.trim()) ||
    reflogs.some(
      (reflog) =>
        !reflog.ok ||
        Boolean(reflog.stderr) ||
        !/@\{(\d+)\}$/.test(reflog.stdout.trim()),
    )
  ) {
    return {
      value: epochs.length > 0 ? Math.max(...epochs) : null,
      error: "branch/worktree recency unavailable",
    };
  }
  return { value: Math.max(...epochs), error: null };
}

const ASSOCIATED_PULL_REQUESTS_QUERY = `
query($owner: String!, $name: String!, $oid: GitObjectID!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    object(oid: $oid) {
      ... on Commit {
        associatedPullRequests(first: 100, after: $endCursor) {
          totalCount
          nodes {
            number
            url
            state
            isDraft
            mergedAt
            headRefName
            headRefOid
            headRepository { nameWithOwner }
            baseRefName
            baseRepository { nameWithOwner }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
}`;

const EXACT_HEAD_PULL_REQUESTS_QUERY = `
query($searchQuery: String!, $endCursor: String) {
  search(query: $searchQuery, type: ISSUE, first: 100, after: $endCursor) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        url
        state
        isDraft
        mergedAt
        headRefName
        headRefOid
        headRepository { nameWithOwner }
        baseRefName
        baseRepository { nameWithOwner }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

function repositoryName(value: unknown): string | null {
  if (!isRecord(value) || typeof value.nameWithOwner !== "string") return null;
  return GITHUB_REPOSITORY.test(value.nameWithOwner) ? value.nameWithOwner : null;
}

function isPullRequestUrl(value: unknown, repo: string, number: number): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      parsed.port === "" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.pathname === `/${repo}/pull/${number}`
    );
  } catch {
    return false;
  }
}

function parsePullRequestNode(value: unknown, expectedOid: string | null): PullRequest {
  if (!isRecord(value)) throw new Error("pull request node is not an object");
  const baseRepository = repositoryName(value.baseRepository);
  const headRepository =
    value.headRepository === null ? null : repositoryName(value.headRepository);
  if (
    !Number.isInteger(value.number) ||
    (value.number as number) <= 0 ||
    (value.state !== "OPEN" && value.state !== "CLOSED" && value.state !== "MERGED") ||
    typeof value.isDraft !== "boolean" ||
    (value.state === "MERGED"
      ? typeof value.mergedAt === "string" &&
        isCanonicalRfc3339Instant(value.mergedAt)
      : value.mergedAt === null) === false ||
    typeof value.headRefName !== "string" ||
    value.headRefName.length === 0 ||
    typeof value.headRefOid !== "string" ||
    !OID.test(value.headRefOid) ||
    // Only an OPEN pull request still has its head where we are looking.
    //
    // The commit-association caller passes the oid it queried, and every oid it
    // queries is a TIP (a worktree HEAD or a branch tip), so for an open PR
    // "this commit is the PR's head" is a real invariant worth enforcing.
    //
    // For a MERGED PR it is never true under squash merges: GitHub associates
    // the squash commit on the base branch with the PR, but that PR's
    // headRefOid is the PRE-SQUASH branch tip, a commit that no longer heads
    // anything. Enforcing equality there rejected every squash-merged commit as
    // "malformed", and because the create gate aggregates inventory errors
    // repo-wide, one such commit blocked `beads:worktrees:create` for every
    // bead — worsening with each PR that landed. Confirmed against live GitHub
    // on three merges (#4256, #4264, #4252): head oid was the branch tip in
    // every case, never the squash commit (cave-c4f97).
    //
    // CLOSED-unmerged is excluded for the same reason: the head it names may
    // have been rewritten or deleted, so the oid carries no promise either.
    (expectedOid !== null && value.state === "OPEN" && value.headRefOid !== expectedOid) ||
    (value.headRepository !== null && headRepository === null) ||
    (value.state === "OPEN" && headRepository === null) ||
    typeof value.baseRefName !== "string" ||
    value.baseRefName.length === 0 ||
    baseRepository === null ||
    !isPullRequestUrl(value.url, baseRepository, value.number as number)
  ) {
    throw new Error("pull request node returned malformed fields or a mismatched head OID");
  }
  return {
    number: value.number as number,
    url: value.url,
    state: value.state,
    isDraft: value.isDraft,
    mergedAt: value.mergedAt as string | null,
    headRefName: value.headRefName,
    headRefOid: value.headRefOid,
    headRepository,
    baseRefName: value.baseRefName,
    baseRepository,
  };
}

function validatePageInfo(
  value: unknown,
  pageIndex: number,
  pageCount: number,
  cursors: Set<string>,
): void {
  if (
    !isRecord(value) ||
    typeof value.hasNextPage !== "boolean" ||
    !(
      value.endCursor === null ||
      (typeof value.endCursor === "string" && value.endCursor.length > 0)
    )
  ) {
    throw new Error("pagination returned malformed pageInfo");
  }
  const finalPage = pageIndex === pageCount - 1;
  if (finalPage ? value.hasNextPage : !value.hasNextPage) {
    throw new Error("pagination is incomplete");
  }
  if (!finalPage && typeof value.endCursor !== "string") {
    throw new Error("pagination omitted an intermediate cursor");
  }
  if (typeof value.endCursor === "string") {
    if (cursors.has(value.endCursor)) throw new Error("pagination repeated a cursor");
    cursors.add(value.endCursor);
  }
}

function samePullRequest(left: PullRequest, right: PullRequest): boolean {
  return (
    left.number === right.number &&
    left.url === right.url &&
    left.state === right.state &&
    left.isDraft === right.isDraft &&
    left.mergedAt === right.mergedAt &&
    left.headRefName === right.headRefName &&
    left.headRefOid === right.headRefOid &&
    left.headRepository === right.headRepository &&
    left.baseRefName === right.baseRefName &&
    left.baseRepository === right.baseRepository
  );
}

function dedupePullRequests(pullRequests: PullRequest[]): PullRequest[] {
  const deduped = new Map<string, PullRequest>();
  for (const pullRequest of pullRequests) {
    const key = `${pullRequest.baseRepository.toLowerCase()}#${pullRequest.number}`;
    const existing = deduped.get(key);
    if (existing && !samePullRequest(existing, pullRequest)) {
      throw new Error(`conflicting duplicate pull request ${key}`);
    }
    if (!existing) deduped.set(key, pullRequest);
  }
  return [...deduped.values()];
}

function assertUniqueConnectionPullRequest(
  pullRequest: PullRequest,
  identities: Set<string>,
  urls: Set<string>,
): void {
  const identity = `${pullRequest.baseRepository.toLowerCase()}#${pullRequest.number}`;
  if (identities.has(identity) || urls.has(pullRequest.url)) {
    throw new Error(`duplicate pull request ${identity}`);
  }
  identities.add(identity);
  urls.add(pullRequest.url);
}

function parseAssociatedPullRequestPages(
  raw: string,
  expectedRepo: string,
  oid: string,
): { canonicalRepo: string; pullRequests: PullRequest[] } {
  const pages = parseJson<unknown>(raw, "associated PR inventory");
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("pagination returned no pages");
  }
  const cursors = new Set<string>();
  let canonicalRepo: string | null = null;
  let totalCount: number | null = null;
  const identities = new Set<string>();
  const urls = new Set<string>();
  const pullRequests: PullRequest[] = [];
  pages.forEach((page, pageIndex) => {
    if (!isRecord(page) || "errors" in page || !isRecord(page.data)) {
      throw new Error("page returned malformed GraphQL data");
    }
    const repository = page.data.repository;
    const pageRepo = repositoryName(repository);
    if (
      !isRecord(repository) ||
      pageRepo === null ||
      pageRepo.toLowerCase() !== expectedRepo.toLowerCase()
    ) {
      throw new Error("canonical repository identity mismatch");
    }
    if (canonicalRepo !== null && pageRepo !== canonicalRepo) {
      throw new Error("canonical repository identity changed between pages");
    }
    canonicalRepo = pageRepo;
    if (!isRecord(repository.object) || !isRecord(repository.object.associatedPullRequests)) {
      throw new Error("commit association connection is unavailable");
    }
    const connection = repository.object.associatedPullRequests;
    if (
      !Number.isSafeInteger(connection.totalCount) ||
      (connection.totalCount as number) < 0 ||
      !Array.isArray(connection.nodes)
    ) {
      throw new Error("association nodes are malformed");
    }
    if (totalCount !== null && totalCount !== connection.totalCount) {
      throw new Error("association page totals are inconsistent");
    }
    totalCount = connection.totalCount as number;
    validatePageInfo(connection.pageInfo, pageIndex, pages.length, cursors);
    if (
      pageIndex < pages.length - 1 &&
      connection.nodes.length === 0
    ) {
      throw new Error("pagination returned an empty intermediate page");
    }
    for (const node of connection.nodes) {
      const pullRequest = parsePullRequestNode(node, oid);
      assertUniqueConnectionPullRequest(pullRequest, identities, urls);
      pullRequests.push(pullRequest);
    }
  });
  if (canonicalRepo === null) throw new Error("canonical repository identity is unavailable");
  if (totalCount === null || pullRequests.length !== totalCount) {
    throw new Error("association pagination is incomplete relative to totalCount");
  }
  return { canonicalRepo, pullRequests };
}

function parseExactHeadPullRequestPages(
  raw: string,
  canonicalRepo: string,
  branch: string,
): PullRequest[] {
  const pages = parseJson<unknown>(raw, "exact-head PR search");
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("pagination returned no pages");
  }
  const cursors = new Set<string>();
  let issueCount: number | null = null;
  const identities = new Set<string>();
  const urls = new Set<string>();
  const pullRequests: PullRequest[] = [];
  pages.forEach((page, pageIndex) => {
    if (!isRecord(page) || "errors" in page || !isRecord(page.data)) {
      throw new Error("page returned malformed GraphQL data");
    }
    const search = page.data.search;
    if (
      !isRecord(search) ||
      !Number.isSafeInteger(search.issueCount) ||
      (search.issueCount as number) < 0 ||
      !Array.isArray(search.nodes)
    ) {
      throw new Error("search page returned malformed data");
    }
    if ((search.issueCount as number) > 1_000) {
      throw new Error("reached GitHub's 1000-result cap");
    }
    if (issueCount !== null && issueCount !== search.issueCount) {
      throw new Error("search page totals are inconsistent");
    }
    issueCount = search.issueCount as number;
    validatePageInfo(search.pageInfo, pageIndex, pages.length, cursors);
    if (pageIndex < pages.length - 1 && search.nodes.length === 0) {
      throw new Error("pagination returned an empty intermediate page");
    }
    for (const node of search.nodes) {
      const pullRequest = parsePullRequestNode(node, null);
      assertUniqueConnectionPullRequest(pullRequest, identities, urls);
      pullRequests.push(pullRequest);
    }
  });
  if (issueCount === null || pullRequests.length !== issueCount) {
    throw new Error("search pagination is incomplete");
  }
  return pullRequests.filter(
    (pullRequest) =>
      pullRequest.headRepository?.toLowerCase() === canonicalRepo.toLowerCase() &&
      pullRequest.headRefName === branch,
  );
}

function fetchPullRequests(
  repo: string,
  root: string,
  heads: string[],
  branches: string[],
  defaultBranch: string | null,
): PullRequestInventory {
  const byOid = new Map<string, PullRequest[]>();
  const byBranch = new Map<string, PullRequest[]>();
  const errorsByOid = new Map<string, string>();
  const errorsByBranch = new Map<string, string>();
  const globalErrors: string[] = [];
  const repoMatch = repo.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!repoMatch) {
    return {
      byOid,
      byBranch,
      errorsByOid,
      errorsByBranch,
      globalErrors: ["pull request inventory has an invalid canonical repository"],
      canonicalRepo: null,
    };
  }
  const [, owner, name] = repoMatch;
  let canonicalRepo: string | null = null;
  for (const oid of [...new Set(heads)]) {
    const result = command(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "graphql",
        "--paginate",
        "--slurp",
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
        "-F",
        `oid=${oid}`,
        "-f",
        `query=${ASSOCIATED_PULL_REQUESTS_QUERY}`,
      ],
      root,
      120_000,
    );
    if (!result.ok || result.stderr) {
      errorsByOid.set(
        oid,
        `associated PR inventory query failed for ${oid}: ${
          result.stderr || `status ${result.status ?? "unknown"}`
        }`,
      );
      continue;
    }
    try {
      const parsed = parseAssociatedPullRequestPages(result.stdout, repo, oid);
      if (canonicalRepo !== null && parsed.canonicalRepo !== canonicalRepo) {
        globalErrors.push("pull request inventory canonical repository identity changed");
      } else if (canonicalRepo === null) {
        canonicalRepo = parsed.canonicalRepo;
      }
      byOid.set(oid, parsed.pullRequests);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "malformed response";
      const message = `associated PR inventory returned malformed data for ${oid}: ${detail}`;
      errorsByOid.set(oid, message);
      if (/canonical repository/i.test(detail)) {
        globalErrors.push(`pull request inventory canonical repository failure: ${detail}`);
      }
    }
  }
  if (canonicalRepo === null) {
    // Distinguish "GitHub did not answer" from "GitHub answered and the
    // repository identity was wrong". Both used to surface as the latter, which
    // sent the reader looking at repository configuration when the real cause
    // was an exhausted GraphQL budget (its 5000/hr pool is separate from REST,
    // so `gh api rate_limit` can look healthy while every graphql call fails).
    // The per-OID errors already carry the true reason; this promotes it
    // instead of overwriting it (cave-v59dk).
    const attempted = new Set(heads).size;
    const firstFailure = [...errorsByOid.values()][0] ?? null;
    globalErrors.push(
      attempted > 0 && errorsByOid.size === attempted && firstFailure !== null
        ? `pull request inventory could not query GitHub — all ${attempted} commit association ${
            attempted === 1 ? "query" : "queries"
          } failed: ${firstFailure}`
        : "pull request inventory canonical repository is unavailable",
    );
  }

  if (
    canonicalRepo !== null &&
    !globalErrors.some((error) => /canonical repository/i.test(error))
  ) {
    for (const branch of [...new Set(branches)].filter(
      (candidate) =>
        !PROTECTED_BRANCHES.has(candidate) && candidate !== defaultBranch,
    )) {
      const searchQuery = `is:pr head:${branch}`;
      const result = command(
        "gh",
        [
          "api",
          "--hostname",
          "github.com",
          "graphql",
          "--paginate",
          "--slurp",
          "-F",
          `searchQuery=${searchQuery}`,
          "-f",
          `query=${EXACT_HEAD_PULL_REQUESTS_QUERY}`,
        ],
        root,
        120_000,
      );
      if (!result.ok || result.stderr) {
        errorsByBranch.set(
          branch,
          `exact-head PR search failed for ${branch}: ${
            result.stderr || `status ${result.status ?? "unknown"}`
          }`,
        );
        continue;
      }
      try {
        byBranch.set(
          branch,
          parseExactHeadPullRequestPages(result.stdout, canonicalRepo, branch),
        );
      } catch (error) {
        errorsByBranch.set(
          branch,
          `exact-head PR search returned malformed or incomplete data for ${branch}: ${
            error instanceof Error ? error.message : "malformed response"
          }`,
        );
      }
    }
  }

  return {
    byOid,
    byBranch,
    errorsByOid,
    errorsByBranch,
    globalErrors: [...new Set(globalErrors)],
    canonicalRepo,
  };
}

/** Stable identity for a lifecycle unit within one patrol run. */
function lifecycleUnitKey(unit: { kind: string; path: string | null; ref: string | null }): string {
  return `${unit.kind}\0${unit.path ?? ""}\0${unit.ref ?? ""}`;
}

/**
 * Which units — if any — had their own inputs move while the patrol ran.
 *
 * Returns a reason per affected unit; an empty map means nothing a verdict
 * depends on changed. Throws only when a snapshot cannot be parsed, which the
 * caller escalates to a whole-run failure.
 */
function unitScopedDrift({
  units,
  initialWorktreeRaw,
  initialRefsRaw,
  finalWorktreeRaw,
  finalRefsRaw,
}: {
  units: Array<{ kind: string; path: string | null; ref: string | null; head: string }>;
  initialWorktreeRaw: string;
  initialRefsRaw: string;
  finalWorktreeRaw: string;
  finalRefsRaw: string;
}): Map<string, string> {
  const drift = new Map<string, string>();
  if (finalWorktreeRaw === initialWorktreeRaw && finalRefsRaw === initialRefsRaw) {
    return drift;
  }

  // Drift is measured INITIAL → FINAL, never against the unit's own fields. A
  // unit can start out inconsistent — a registered worktree whose ref is absent
  // from the branch inventory, or whose HEAD differs from that ref, both of
  // which `initialErrors` already reports — and comparing the final snapshot to
  // those fields would blame the patrol window for a discrepancy that predates
  // it. Only a real change between the two reads is drift.
  const initialEntries = parseWorktrees(initialWorktreeRaw);
  const finalEntries = parseWorktrees(finalWorktreeRaw);
  const initialOidByRef = new Map(
    parseLocalBranchRefs(initialRefsRaw).map((localRef) => [localRef.ref, localRef.oid]),
  );
  const finalOidByRef = new Map(
    parseLocalBranchRefs(finalRefsRaw).map((localRef) => [localRef.ref, localRef.oid]),
  );
  const initialEntryByPath = new Map(initialEntries.map((entry) => [entry.path, entry]));
  const finalEntryByPath = new Map(finalEntries.map((entry) => [entry.path, entry]));
  const pathsByRef = (entries: ReturnType<typeof parseWorktrees>) => {
    const byRef = new Map<string, string[]>();
    for (const entry of entries) {
      if (entry.ref === null) continue;
      byRef.set(entry.ref, [...(byRef.get(entry.ref) ?? []), entry.path].sort());
    }
    return byRef;
  };
  const initialPathsByRef = pathsByRef(initialEntries);
  const finalPathsByRef = pathsByRef(finalEntries);

  for (const unit of units) {
    const key = lifecycleUnitKey(unit);
    if (unit.kind === "worktree" && unit.path !== null) {
      const before = initialEntryByPath.get(unit.path);
      const after = finalEntryByPath.get(unit.path);
      if (before !== undefined) {
        if (after === undefined) {
          drift.set(key, "worktree was unregistered while the patrol was running");
          continue;
        }
        if (after.head !== before.head || after.ref !== before.ref) {
          drift.set(key, "worktree HEAD moved while the patrol was running");
          continue;
        }
      }
    }
    if (unit.ref !== null) {
      const oidBefore = initialOidByRef.get(unit.ref);
      const oidAfter = finalOidByRef.get(unit.ref);
      // A ref the initial snapshot never had is not something this window
      // changed; `initialErrors` already covers that inconsistency.
      if (oidBefore !== undefined) {
        if (oidAfter === undefined) {
          drift.set(key, "branch was deleted while the patrol was running");
          continue;
        }
        if (oidAfter !== oidBefore) {
          drift.set(key, "branch moved while the patrol was running");
          continue;
        }
      }
      // A ref gaining or losing a worktree changes what retiring it would mean,
      // even when the OID held still.
      const pathsBefore = (initialPathsByRef.get(unit.ref) ?? []).join("\0");
      const pathsAfter = (finalPathsByRef.get(unit.ref) ?? []).join("\0");
      if (pathsBefore !== pathsAfter) {
        drift.set(key, "the worktrees holding this branch changed while the patrol was running");
      }
    }
  }
  return drift;
}

function fetchWorkflowSweep(
  repo: string,
  root: string,
): { runs: WorkflowRun[]; error: string | null } {
  const runsById = new Map<number, WorkflowRun>();
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
    if (!result.ok || result.stderr) {
      return { runs: [], error: result.stderr || `workflow inventory failed for ${state}` };
    }
    try {
      const pages = parseJson<Array<{ total_count: number; workflow_runs: unknown[] }>>(
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
                typeof run.id === "number" &&
                Number.isSafeInteger(run.id) &&
                run.id > 0 &&
                run.status === state &&
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
      const stateRuns = pages.flatMap((page) => page.workflow_runs).map((run) => {
        const record = run as Record<string, unknown>;
        return {
          id: record.id as number,
          status: record.status as string,
          head_branch: record.head_branch as string | null,
          head_sha: record.head_sha as string,
          html_url: record.html_url as string,
        };
      });
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
      const stateIds = new Set<number>();
      for (const run of stateRuns) {
        if (stateIds.has(run.id)) {
          return {
            runs: [],
            error: `workflow inventory returned duplicate run ID ${run.id} for ${state}`,
          };
        }
        stateIds.add(run.id);
        const existing = runsById.get(run.id);
        if (existing) {
          return {
            runs: [],
            error: `workflow inventory returned conflicting status for run ID ${run.id}: ${existing.status} and ${run.status}`,
          };
        }
        runsById.set(run.id, {
          id: run.id,
          status: run.status,
          head_branch: run.head_branch,
          head_sha: run.head_sha,
          html_url: run.html_url,
        });
      }
    } catch {
      return { runs: [], error: `workflow inventory returned malformed data for ${state}` };
    }
  }
  return {
    runs: [...runsById.values()].sort((left, right) => left.id - right.id),
    error: null,
  };
}

/**
 * Errors that mean "the repository moved while we were reading it", as opposed
 * to "the data is wrong". Runs start, finish and change state continuously, so
 * a paginated read on a busy repo routinely lands mid-flight: pages disagree on
 * total_count, the collected rows fall short of the total, or two verification
 * sweeps see different sets. None of these indicate a problem with the
 * inventory — they indicate CI is running — and every one of them is expected
 * to resolve on a re-read.
 */
const RETRYABLE_SWEEP_ERROR =
  /(returned partial data|returned inconsistent totals|changed between verification sweeps)/;

/**
 * How many times to attempt a stable read before giving up.
 *
 * An attempt is one sweep, plus a second confirming sweep only if the first
 * succeeded — a first sweep that fails with retryable drift ends the attempt
 * immediately, since there is nothing to confirm against.
 *
 * Deliberately no backoff between attempts. Each sweep is itself several
 * round-trips to GitHub, so a re-read is already far enough after the last one
 * to see a settled state; adding a sleep would only lengthen the window during
 * which the repository can change again. It would also be the one blocking
 * primitive in an otherwise spawn-bound script, which is a poor thing to
 * introduce into a path that runs while a maintenance gate is held.
 */
const WORKFLOW_SWEEP_ATTEMPTS = 4;

/**
 * A stable snapshot of the active workflow runs.
 *
 * The safety requirement is unchanged: two consecutive sweeps must agree before
 * the result is trusted, because a partial inventory could miss a run that is
 * live against a worktree and let it be retired. What changed is that ordinary
 * churn no longer *ends* the attempt — a disagreement is retried rather than
 * reported. On a repo with runs in flight the first pair almost never agrees,
 * which is why this previously reported "partial data" whenever CI was busy and
 * left every unit `uncertain` (cave-v59dk).
 *
 * Genuine inconsistencies — a duplicate run ID, conflicting statuses, malformed
 * JSON, the 1000-run cap, a failed `gh` call — are NOT retried. Those do not
 * settle on a second read, and retrying them would only delay a real report.
 */
function fetchWorkflows(
  repo: string,
  root: string,
): { runs: WorkflowRun[]; error: string | null } {
  let lastError = "workflow inventory did not stabilize";
  for (let attempt = 1; attempt <= WORKFLOW_SWEEP_ATTEMPTS; attempt += 1) {
    const first = fetchWorkflowSweep(repo, root);
    if (first.error) {
      if (!RETRYABLE_SWEEP_ERROR.test(first.error)) return first;
      lastError = first.error;
    } else {
      const second = fetchWorkflowSweep(repo, root);
      if (second.error) {
        if (!RETRYABLE_SWEEP_ERROR.test(second.error)) return second;
        lastError = second.error;
      } else if (JSON.stringify(first.runs) === JSON.stringify(second.runs)) {
        return first;
      } else {
        lastError = "workflow inventory changed between verification sweeps";
      }
    }
  }
  // Still moving after every attempt. Report the last reason AND the fact that
  // it was retried, so the reader knows this is sustained churn rather than a
  // one-off — otherwise the message invites exactly the wrong diagnosis.
  return {
    runs: [],
    error: `${lastError} (unstable across ${WORKFLOW_SWEEP_ATTEMPTS} verification attempts — CI is likely busy)`,
  };
}

function fetchClaims(root: string): {
  claims: Array<{ branch: string; agent_id: string; state: string; head: string | null }>;
  error: string | null;
} {
  const result = command("coven", ["claim", "status", "--json"], root);
  if (!result.ok || result.stderr) {
    return { claims: [], error: result.stderr || "Coven claims unavailable" };
  }
  try {
    const parsed = parseJson<{
      claims: Array<{ branch: string; agent_id: string; state: string; head?: unknown }>;
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
          CLAIM_STATES.has(claim.state) &&
          (claim.head === undefined ||
            claim.head === null ||
            (typeof claim.head === "string" && OID.test(claim.head))) &&
          (claim.state !== "active" ||
            (typeof claim.head === "string" && OID.test(claim.head))),
      )
    ) {
      throw new Error();
    }
    return {
      claims: parsed.claims.map((claim) => ({
        branch: claim.branch,
        agent_id: claim.agent_id,
        state: claim.state,
        head: typeof claim.head === "string" ? claim.head : null,
      })),
      error: null,
    };
  } catch {
    return { claims: [], error: "Coven claims returned malformed data" };
  }
}

function fetchSessions(root: string): { sessions: CovenSession[]; error: string | null } {
  const result = command("coven", ["sessions", "--json"], root);
  if (!result.ok || result.stderr) {
    return { sessions: [], error: result.stderr || "Coven sessions unavailable" };
  }
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
          normalizeAbsoluteWorktreePath(session.project_root) !== null &&
          typeof session.status === "string" &&
          session.status.length > 0,
      )
    ) {
      throw new Error();
    }
    return {
      sessions: parsed.sessions.map((session) => ({
        id: session.id,
        projectRoot: normalizePath(
          normalizeAbsoluteWorktreePath(session.project_root)!,
        ),
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
  const normalizedAdditionalPaths = Array.isArray(additionalPaths)
    ? additionalPaths.map((candidate) =>
        typeof candidate === "string"
          ? normalizeAbsoluteWorktreePath(candidate)
          : null,
      )
    : null;
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
    additionalPaths.length === 0 ||
    normalizedAdditionalPaths === null ||
    normalizedAdditionalPaths.some((candidate) => candidate === null)
  ) {
    errors.push("exception additionalPaths must contain absolute paths");
  }
  if (
    typeof owner !== "string" ||
    typeof reason !== "string" ||
    typeof expiresAt !== "string" ||
    normalizedAdditionalPaths === null
  ) {
    return undefined;
  }
  return {
    owner,
    reason,
    expiresAt,
    additionalPaths: normalizedAdditionalPaths.filter(
      (candidate): candidate is string => candidate !== null,
    ),
  };
}

function parseStructuredRecord(
  taskId: string,
  value: unknown,
  location: string,
  root: string,
): StructuredMetadataRecord {
  const prefix = `Bead ${taskId} ${location} metadata`;
  if (!isRecord(value)) {
    return {
      branch: "",
      path: null,
      metadata: null,
      errors: [`${prefix}: record must be an object`],
    };
  }
  const worktree = value;
  const branch = typeof worktree.branch === "string" ? worktree.branch : "";
  const metadataPath =
    typeof worktree.path === "string"
      ? normalizeAbsoluteWorktreePath(worktree.path)
      : null;
  const errors: string[] = [];
  const metadataErrors = (message: string) => errors.push(`${prefix}: ${message}`);
  if (
    branch.trim().length === 0 ||
    branch.startsWith("refs/heads/") ||
    branch.trim() !== branch
  ) {
    metadataErrors("branch must be an exact local branch name");
  } else {
    const branchCheck = git(root, ["check-ref-format", "--branch", branch]);
    if (!branchCheck.ok || branchCheck.stdout.trim() !== branch) {
      metadataErrors("branch must be a valid exact local branch name");
    }
  }
  if (metadataPath === null) {
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

function parseStructuredMetadata(
  taskId: string,
  value: unknown,
  root: string,
): StructuredMetadataParse {
  if (value === undefined || value === null) return { records: [], errors: [] };
  if (!isRecord(value)) throw new Error();
  if (value.coven === undefined || value.coven === null) {
    return { records: [], errors: [] };
  }
  if (!isRecord(value.coven)) throw new Error();

  const records: StructuredMetadataRecord[] = [];
  const errors: string[] = [];
  const primaryPresent =
    value.coven.worktree !== undefined && value.coven.worktree !== null;
  if (primaryPresent) {
    const primary = parseStructuredRecord(
      taskId,
      value.coven.worktree,
      "worktree",
      root,
    );
    records.push(primary);
    errors.push(...primary.errors);
  }

  if (value.coven.worktrees !== undefined) {
    if (!Array.isArray(value.coven.worktrees)) {
      errors.push(`Bead ${taskId} worktrees metadata: worktrees must be an array`);
    } else {
      if (!primaryPresent && value.coven.worktrees.length > 0) {
        errors.push(
          `Bead ${taskId} worktrees metadata: additional records require a primary worktree`,
        );
      }
      value.coven.worktrees.forEach((record, index) => {
        const parsed = parseStructuredRecord(
          taskId,
          record,
          `worktrees[${index}]`,
          root,
        );
        records.push(parsed);
        errors.push(...parsed.errors);
      });
    }
  }

  return { records, errors };
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
  if (!result.ok || result.stderr) {
    return { tasks: [], error: result.stderr || "Beads inventory unavailable" };
  }
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
      tasks: parsed.map((task) => {
        const structured = parseStructuredMetadata(task.id, task.metadata, root);
        return {
          id: task.id,
          status: task.status,
          text: [
            task.title ?? "",
            task.description ?? "",
            task.notes ?? "",
            task.external_ref ?? "",
          ].join("\n"),
          structured: structured.records,
          structuredErrors: structured.errors,
        };
      }),
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

function onDefaultBranch(root: string, head: string, authoritativeDefaultOid: string): {
  value: boolean;
  error: string | null;
} {
  const result = git(root, ["merge-base", "--is-ancestor", head, authoritativeDefaultOid]);
  if (result.status === 0 && result.ok) return { value: true, error: null };
  if (result.status === 1 && result.stderr.length === 0) return { value: false, error: null };
  return { value: false, error: result.stderr || "default-branch ancestry check failed" };
}

function exactDefaultLandingAt(
  root: string,
  head: string,
  authoritativeDefaultOid: string,
  exactMergedAt: string | null,
): { value: number | null; error: string | null } {
  if (!OID.test(head) || !OID.test(authoritativeDefaultOid)) {
    return { value: null, error: "default branch landing evidence has malformed OIDs" };
  }

  if (head === authoritativeDefaultOid) {
    if (exactMergedAt === null) {
      return {
        value: null,
        error:
          "default branch landing time is unprovable when candidate equals captured default: remote ref-move time is unavailable without an exact merged PR timestamp",
      };
    }
    const exactMergedAtMs = Date.parse(exactMergedAt);
    if (!Number.isFinite(exactMergedAtMs)) {
      return { value: null, error: "default branch landing timestamp is malformed" };
    }
    return { value: exactMergedAtMs, error: null };
  }

  const ancestryPath = git(root, [
    "rev-list",
    "--ancestry-path",
    "--first-parent",
    "--reverse",
    "--parents",
    `${head}..${authoritativeDefaultOid}`,
  ]);
  if (!ancestryPath.ok || ancestryPath.stderr) {
    return {
      value: null,
      error: `default branch landing ancestry path unavailable: ${
        ancestryPath.stderr || `status ${ancestryPath.status ?? "unknown"}`
      }`,
    };
  }
  const lines = strictOutputLines(ancestryPath.stdout);
  if (!lines) {
    return { value: null, error: "default branch landing evidence is malformed" };
  }
  const seen = new Set<string>();
  const records: Array<{ oid: string; parents: string[] }> = [];
  for (const line of lines) {
    const fields = line.split(" ");
    const [oid, ...parents] = fields;
    if (
      fields.some((field) => !OID.test(field)) ||
      !oid ||
      parents.length === 0 ||
      seen.has(oid) ||
      new Set(fields).size !== fields.length
    ) {
      return { value: null, error: "default branch landing evidence is malformed" };
    }
    seen.add(oid);
    records.push({ oid, parents });
  }
  if (records.at(-1)?.oid !== authoritativeDefaultOid) {
    return { value: null, error: "default branch landing evidence is malformed" };
  }
  for (let index = 1; index < records.length; index += 1) {
    if (records[index]!.parents[0] !== records[index - 1]!.oid) {
      return { value: null, error: "default branch landing evidence is ambiguous" };
    }
  }
  const landingOid = records[0]!.oid;

  const timestamp = git(root, [
    "show",
    "-s",
    "--format=%H%x00%ct",
    landingOid,
  ]);
  if (!timestamp.ok || timestamp.stderr) {
    return {
      value: null,
      error: `default branch landing timestamp unavailable: ${
        timestamp.stderr || `status ${timestamp.status ?? "unknown"}`
      }`,
    };
  }
  if (!timestamp.stdout.endsWith("\n") || timestamp.stdout.includes("\r")) {
    return { value: null, error: "default branch landing timestamp is malformed" };
  }
  const fields = timestamp.stdout.slice(0, -1).split("\0");
  if (
    fields.length !== 2 ||
    fields[0] !== landingOid ||
    !/^(?:0|[1-9]\d*)$/.test(fields[1] ?? "")
  ) {
    return { value: null, error: "default branch landing timestamp is malformed" };
  }
  const epochSeconds = Number(fields[1]);
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds > Number.MAX_SAFE_INTEGER / 1_000) {
    return { value: null, error: "default branch landing timestamp is malformed" };
  }
  return { value: epochSeconds * 1_000, error: null };
}

function directRefError(root: string, ref: string): string | null {
  const result = git(root, ["symbolic-ref", "-q", ref]);
  if (result.status === 1 && result.stderr.length === 0) return null;
  if (result.status === 0 && result.ok) return `local branch ref is symbolic: ${ref}`;
  return result.stderr || `local ref directness check failed for ${ref}`;
}

type HistoryOverrideProbe = {
  replaceRefsState: string;
  graftState: string;
  errors: string[];
};

function historyOverrideProbe(root: string, commonGitDir: string): HistoryOverrideProbe {
  const errors: string[] = [];
  const replaceRefs = git(root, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/replace",
  ]);
  let replaceRefsState: string;
  if (!replaceRefs.ok || replaceRefs.stderr) {
    replaceRefsState = `error:${replaceRefs.status ?? "unknown"}:${replaceRefs.stderr}`;
    errors.push(
      `Git replacement ref inventory failed: ${
        replaceRefs.stderr || `status ${replaceRefs.status ?? "unknown"}`
      }`,
    );
  } else {
    replaceRefsState = replaceRefs.stdout;
    const refs = replaceRefs.stdout.split("\n").filter(Boolean);
    if (refs.some((ref) => !ref.startsWith("refs/replace/"))) {
      errors.push("Git replacement ref inventory returned malformed data");
    } else if (refs.length > 0) {
      errors.push(`Git replacement refs are present: ${refs.join(", ")}`);
    }
  }

  const graftPath = path.join(commonGitDir, "info", "grafts");
  let graftState: string;
  try {
    const grafts = readFileSync(graftPath);
    graftState = `present:${createHash("sha256").update(grafts).digest("hex")}`;
    if (grafts.length > 0) {
      errors.push(`legacy Git graft file is nonempty: ${graftPath}`);
    }
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      graftState = "absent";
    } else {
      const detail = error instanceof Error ? error.message : "unknown read error";
      graftState = `unreadable:${detail}`;
      errors.push(`legacy Git graft file is unreadable: ${graftPath}: ${detail}`);
    }
  }

  return { replaceRefsState, graftState, errors };
}

function exactRemoteRef(
  root: string,
  ref: string,
  options: { required?: boolean; label?: string } = {},
): {
  remoteRef: WorktreeRemoteRef | null;
  error: string | null;
} {
  const label = options.label ?? "same-named remote ref";
  const result = git(root, ["ls-remote", "--exit-code", "--heads", "origin", ref], 60_000);
  if (result.stderr) {
    return {
      remoteRef: null,
      error: `${label} probe failed for ${ref}: ${result.stderr}`,
    };
  }
  if (result.status === 2) {

    return {
      remoteRef: null,
      error: options.required ? `${label} is missing for ${ref}` : null,
    };
  }
  if (!result.ok) {
    return {
      remoteRef: null,
      error: `${label} probe failed for ${ref}: ${result.stderr || "command unavailable"}`,
    };
  }
  const match = result.stdout.match(/^((?:[0-9a-f]{40}|[0-9a-f]{64}))\t([^\n]+)\n?$/);
  if (!match || match[2] !== ref) {
    return {
      remoteRef: null,
      error: `${label} probe returned malformed data for ${ref}`,
    };
  }
  return { remoteRef: { ref: match[2], oid: match[1] }, error: null };
}

function strictOutputLines(raw: string): string[] | null {
  const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (!body || body.endsWith("\n") || body.includes("\r")) return null;
  const lines = body.split("\n");
  return lines.every((line) => line.length > 0) ? lines : null;
}

function parseGitHubRepositoryUrl(
  value: string,
): { repository: string | null; error: "malformed" | "non-github" | null } {
  const scpMatch = value.match(
    /^git@([^:/]+):([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  );
  if (scpMatch) {
    return scpMatch[1]!.toLowerCase() === "github.com"
      ? { repository: `${scpMatch[2]}/${scpMatch[3]}`, error: null }
      : { repository: null, error: "non-github" };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { repository: null, error: "malformed" };
  }
  const supportedProtocol = parsed.protocol === "https:" || parsed.protocol === "ssh:";
  if (!supportedProtocol || parsed.hostname.toLowerCase() !== "github.com") {
    return { repository: null, error: "non-github" };
  }
  if (
    parsed.port !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.protocol === "https:" && parsed.username !== "") ||
    (parsed.protocol === "ssh:" && parsed.username !== "git")
  ) {
    return { repository: null, error: "malformed" };
  }
  const pathMatch = parsed.pathname.match(
    /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  );
  return pathMatch
    ? { repository: `${pathMatch[1]}/${pathMatch[2]}`, error: null }
    : { repository: null, error: "malformed" };
}

function originRepositoryIdentity(root: string, requestedRepo: string): OriginRepositoryIdentity {
  const fail = (detail: string): OriginRepositoryIdentity => ({
    repository: null,
    error: `origin remote identity ${detail}`,
  });
  const fetchUrls = git(root, ["remote", "get-url", "--all", "origin"]);
  if (!fetchUrls.ok) {
    return fail(`fetch URL probe failed: ${fetchUrls.stderr || "command unavailable"}`);
  }
  const pushUrls = git(root, ["remote", "get-url", "--push", "--all", "origin"]);
  if (!pushUrls.ok) {
    return fail(`push URL probe failed: ${pushUrls.stderr || "command unavailable"}`);
  }
  const fetchLines = strictOutputLines(fetchUrls.stdout);
  const pushLines = strictOutputLines(pushUrls.stdout);
  if (!fetchLines) return fail("has malformed fetch URL inventory");
  if (!pushLines) return fail("has malformed push URL inventory");
  if (pushLines.length !== 1) return fail("has multiple or ambiguous push destinations");

  const repositories: string[] = [];
  for (const [kind, urls] of [
    ["fetch", fetchLines],
    ["push", pushLines],
  ] as const) {
    for (const url of urls) {
      const parsed = parseGitHubRepositoryUrl(url);
      if (parsed.error === "non-github") return fail(`has a non-GitHub ${kind} URL`);
      if (parsed.error !== null || parsed.repository === null) {
        return fail(`has a malformed ${kind} URL`);
      }
      repositories.push(parsed.repository);
    }
  }
  const identities = new Map(repositories.map((repository) => [repository.toLowerCase(), repository]));
  if (identities.size !== 1) return fail("has differing fetch and push repositories");
  const repository = [...identities.values()][0]!;
  if (repository.toLowerCase() !== requestedRepo.toLowerCase()) {
    return fail(`mismatch: expected ${requestedRepo}, received ${repository}`);
  }
  return { repository, error: null };
}

function remoteDefaultBranch(root: string): RemoteDefaultBranch {
  const fail = (message: string): RemoteDefaultBranch => ({
    branch: null,
    remoteRef: null,
    localTrackingRef: null,
    oid: null,
    error: `default branch inventory ${message}`,
  });
  const head = git(root, ["ls-remote", "--symref", "origin", "HEAD"], 60_000);
  if (!head.ok || head.stderr) {
    return fail(`origin HEAD probe failed: ${head.stderr || "command unavailable"}`);
  }
  const headLines = strictOutputLines(head.stdout);
  const symrefs =
    headLines?.flatMap((line) => {
      const match = line.match(/^ref: (refs\/heads\/[^\t]+)\tHEAD$/);
      return match ? [match[1]!] : [];
    }) ?? [];
  const headOids =
    headLines?.flatMap((line) => {
      const match = line.match(/^((?:[0-9a-f]{40}|[0-9a-f]{64}))\tHEAD$/);
      return match ? [match[1]!] : [];
    }) ?? [];
  if (!headLines || headLines.length !== 2 || symrefs.length !== 1 || headOids.length !== 1) {
    return fail("returned malformed origin HEAD symref data");
  }

  const remoteRef = symrefs[0]!;
  const branch = remoteRef.slice("refs/heads/".length);
  const refCheck = git(root, ["check-ref-format", remoteRef]);
  if (!branch || !refCheck.ok || refCheck.stdout !== "" || refCheck.stderr) {
    return fail(`returned malformed remote default ref ${remoteRef}`);
  }

  const target = git(root, ["ls-remote", "--exit-code", "origin", remoteRef], 60_000);
  if (!target.ok || target.stderr) {
    return fail(
      `target ref ${remoteRef} probe failed: ${target.stderr || `status ${target.status ?? "unknown"}`}`,
    );
  }
  const targetLines = strictOutputLines(target.stdout);
  const targetMatch =
    targetLines?.length === 1
      ? targetLines[0]!.match(
          /^((?:[0-9a-f]{40}|[0-9a-f]{64}))\t([^\t\n]+)$/,
        )
      : null;
  if (!targetMatch || targetMatch[2] !== remoteRef) {
    return fail(`target ref ${remoteRef} returned malformed data`);
  }
  if (targetMatch[1] !== headOids[0]) {
    return fail(`target OID mismatch for ${remoteRef}`);
  }

  const localTrackingRef = `refs/remotes/origin/${branch}`;
  const direct = git(root, ["symbolic-ref", "-q", localTrackingRef]);
  if (direct.status === 0 && direct.ok) {
    return fail(`tracking ref ${localTrackingRef} is symbolic`);
  }
  if (direct.status !== 1 || direct.stderr.length > 0) {
    return fail(
      `tracking ref ${localTrackingRef} directness probe failed: ${
        direct.stderr || `status ${direct.status ?? "unknown"}`
      }`,
    );
  }
  const tracking = git(root, ["rev-parse", "--verify", `${localTrackingRef}^{commit}`]);
  if (!tracking.ok || tracking.stderr) {
    return fail(
      `tracking ref ${localTrackingRef} is unavailable: ${
        tracking.stderr || `status ${tracking.status ?? "unknown"}`
      }`,
    );
  }
  const trackingLines = strictOutputLines(tracking.stdout);
  const trackingOid =
    trackingLines?.length === 1 && OID.test(trackingLines[0]!) ? trackingLines[0]! : null;
  if (!trackingOid) {
    return fail(`tracking ref ${localTrackingRef} returned malformed data`);
  }
  if (trackingOid !== targetMatch[1]) {
    return fail(
      `tracking ref ${localTrackingRef} is stale or mismatched with authoritative ${remoteRef}`,
    );
  }
  return {
    branch,
    remoteRef,
    localTrackingRef,
    oid: trackingOid,
    error: null,
  };
}

function matchingTasks(
  branch: string | null,
  worktreePath: string | null,
  head: string,
  tasks: BeadTask[],
): string[] {
  const matchedBranch =
    branch !== null && !PROTECTED_BRANCHES.has(branch) ? branch : null;
  const branchBeadIds = new Set(matchedBranch ? beadIdsInText(matchedBranch) : []);
  const normalizedWorktreePath =
    worktreePath === null ? null : normalizeAbsoluteWorktreePath(worktreePath);

  const exactOid = new RegExp(`(?:^|[^0-9a-f])${head}(?:$|[^0-9a-f])`, "i");
  return tasks
    .filter((task) => task.status !== "closed")
    .filter(
      (task) =>
        task.structured.some(
          (record) =>
            (matchedBranch !== null && record.branch === matchedBranch) ||
            (normalizedWorktreePath !== null &&
              normalizeAbsoluteWorktreePath(record.path) === normalizedWorktreePath),
        ) ||
        branchBeadIds.has(task.id.toLowerCase()) ||
        exactOid.test(task.text) ||
        (matchedBranch !== null && task.text.includes(matchedBranch)) ||
        (matchedBranch !== null &&
          worktreePath !== null &&
          task.text.includes(worktreePath)),
    )
    .map((task) => task.id);
}

function metadataFor(
  branch: string | null,
  worktreePath: string | null,
  tasks: BeadTask[],
): { metadata: WorktreeLifecycleMetadata | null; errors: string[] } {
  if (!branch) return { metadata: null, errors: [] };
  const globalErrors = tasks.flatMap((task) => task.structuredErrors);
  const allRecords = tasks.flatMap((task) => task.structured);
  const records = allRecords.filter((record) => record.branch === branch);
  const normalizedWorktreePath = normalizeAbsoluteWorktreePath(worktreePath);
  const conflictingPathRecords =
    normalizedWorktreePath === null
      ? []
      : allRecords.filter(
          (record) =>
            record.branch !== branch &&
            normalizeAbsoluteWorktreePath(record.path) === normalizedWorktreePath,
        );
  const ownershipErrors =
    conflictingPathRecords.length === 0
      ? []
      : [
          `conflicting structured path ownership for ${worktreePath}: ${[
            ...new Set(conflictingPathRecords.map((record) => record.branch || "<invalid branch>")),
          ].join(", ")}`,
        ];
  const inventoryErrors = [...new Set([...globalErrors, ...ownershipErrors])];
  if (inventoryErrors.length > 0) {
    return { metadata: null, errors: inventoryErrors };
  }
  if (records.length > 1) {
    return {
      metadata: null,
      errors: [`duplicate structured worktree metadata records for ${branch}`],
    };
  }
  const record = records[0];
  if (!record) return { metadata: null, errors: [] };
  const normalizedRecordPath = normalizeAbsoluteWorktreePath(record.path);
  if (
    normalizedRecordPath !== null &&
    allRecords.filter(
      (candidate) =>
        normalizeAbsoluteWorktreePath(candidate.path) === normalizedRecordPath,
    ).length > 1
  ) {
    return {
      metadata: null,
      errors: [`duplicate structured worktree metadata paths for ${record.path}`],
    };
  }
  if (record.errors.length > 0 || !record.metadata) {
    return { metadata: null, errors: record.errors };
  }
  if (
    normalizedWorktreePath !== null &&
    normalizedRecordPath !== normalizedWorktreePath
  ) {
    return {
      metadata: null,
      errors: [`structured worktree metadata path does not match ${branch}`],
    };
  }
  return { metadata: record.metadata, errors: [] };
}

function pathContains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function pathDepth(candidate: string): number {
  const parsed = path.parse(candidate);
  return candidate
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean).length;
}

function assignActiveSessions(
  worktreePaths: string[],
  sessions: CovenSession[],
): {
  sessionIdsByPath: Map<string, string[]>;
  probeErrorsByPath: Map<string, string[]>;
} {
  const registered = worktreePaths.map((worktreePath) => {
    const normalized = normalizePath(worktreePath);
    return {
      worktreePath,
      normalized,
      depth: pathDepth(normalized),
    };
  });
  const sessionIdsByPath = new Map<string, string[]>();
  const probeErrorsByPath = new Map<string, string[]>();

  for (const session of sessions) {
    if (TERMINAL_SESSION_STATUSES.has(session.status)) continue;
    const matches = registered.filter((entry) =>
      pathContains(entry.normalized, session.projectRoot),
    );
    if (matches.length === 0) continue;
    const deepest = Math.max(...matches.map((entry) => entry.depth));
    const owners = matches.filter((entry) => entry.depth === deepest);
    if (owners.length > 1) {
      const error = `Coven session ${session.id} has ambiguous equally deep registered worktree ownership: ${owners
        .map((owner) => owner.worktreePath)
        .join(", ")}`;
      for (const owner of owners) {
        const errors = probeErrorsByPath.get(owner.worktreePath) ?? [];
        errors.push(error);
        probeErrorsByPath.set(owner.worktreePath, errors);
      }
      continue;
    }
    const owner = owners[0]!;
    const ids = sessionIdsByPath.get(owner.worktreePath) ?? [];
    ids.push(session.id);
    sessionIdsByPath.set(owner.worktreePath, ids);
  }

  return { sessionIdsByPath, probeErrorsByPath };
}

type GraftInventory = {
  snapshot: string;
  error: string | null;
};

function statIdentity(stats: Stats): string {
  return [
    stats.dev,
    stats.ino,
    stats.mode,
    stats.size,
    stats.mtimeMs,
    stats.ctimeMs,
  ].join(":");
}

function graftInventory(commonGitDir: string): GraftInventory {
  const graftPath = path.join(commonGitDir, "info", "grafts");
  let initialStats: Stats;
  try {
    initialStats = lstatSync(graftPath);
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "UNKNOWN";
    if (code === "ENOENT") return { snapshot: "absent", error: null };
    return {
      snapshot: `unreadable-state:${code}`,
      error:
        "Git history override inventory is unsafe: shared git common dir info/grafts state is unreadable",
    };
  }

  const initialIdentity = statIdentity(initialStats);
  if (!initialStats.isFile()) {
    return {
      snapshot: `non-regular:${initialIdentity}`,
      error:
        "Git history override inventory is unsafe: shared git common dir info/grafts is not a regular file",
    };
  }

  let raw: Buffer;
  try {
    raw = readFileSync(graftPath);
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "UNKNOWN";
    return {
      snapshot: `unreadable-file:${initialIdentity}:${code}`,
      error:
        "Git history override inventory is unsafe: shared git common dir info/grafts is unreadable",
    };
  }

  let finalStats: Stats;
  try {
    finalStats = lstatSync(graftPath);
  } catch {
    throw new Error(HISTORY_OVERRIDE_DRIFT_ERROR);
  }
  const finalIdentity = statIdentity(finalStats);
  if (!finalStats.isFile() || finalIdentity !== initialIdentity) {
    throw new Error(HISTORY_OVERRIDE_DRIFT_ERROR);
  }

  return {
    snapshot: `regular:${initialIdentity}:${createHash("sha256").update(raw).digest("hex")}`,
    error:
      raw.length === 0
        ? null
        : "Git history override inventory is unsafe: shared git common dir info/grafts is nonempty",
  };
}

function fingerprint(...evidence: string[]): string {
  const hash = createHash("sha256");
  for (const value of evidence) {
    hash.update(String(Buffer.byteLength(value))).update("\0").update(value);
  }
  return hash.digest("hex");
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
  const requestedRoot = normalizeAbsoluteWorktreePath(options.root);
  if (requestedRoot === null) throw new Error("root must be an absolute worktree path");
  const root = realpathSync(requestedRoot);
  const commonGitDir = requiredGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]).trim();
  const initialGrafts = graftInventory(commonGitDir);
  const initialReplacementRefsRaw = requiredGit(root, [
    "for-each-ref",
    "--format=%(refname)%0a%(objectname)%00",
    "refs/replace",
  ]);
  const primaryPath = normalizePath(path.dirname(commonGitDir));
  const initialHistoryOverrides = historyOverrideProbe(root, commonGitDir);
  const initialWorktreeRaw = requiredGit(root, ["worktree", "list", "--porcelain", "-z"]);
  const initialRefsRaw = requiredGit(root, [
    "for-each-ref",
    "--format=%(refname)%0a%(objectname)%00",
    "refs/heads",
  ]);
  const entries = parseWorktrees(initialWorktreeRaw);
  const localRefs = parseLocalBranchRefs(initialRefsRaw);
  const localRefByName = new Map(localRefs.map((localRef) => [localRef.ref, localRef]));
  const registeredPathsByRef = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.ref === null || entry.refError !== null) continue;
    const paths = registeredPathsByRef.get(entry.ref) ?? [];
    paths.push(entry.path);
    registeredPathsByRef.set(entry.ref, paths);
  }
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
        entry.ref &&
        entry.refError === null &&
        (registeredPathsByRef.get(entry.ref)?.length ?? 0) > 1
          ? `registered local branch ref ${entry.ref} appears in more than one worktree: ${registeredPathsByRef
              .get(entry.ref)!
              .join(", ")}`
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

  const originIdentity = originRepositoryIdentity(root, options.repo);
  const defaultBranch =
    originIdentity.error === null
      ? remoteDefaultBranch(root)
      : {
          branch: null,
          remoteRef: null,
          localTrackingRef: null,
          oid: null,
          error: originIdentity.error,
        };
  const prs = fetchPullRequests(
    options.repo,
    root,
    units.map((unit) => unit.head),
    units.flatMap((unit) => (unit.branch ? [unit.branch] : [])),
    defaultBranch.branch,
  );
  const workflows = fetchWorkflows(options.repo, root);
  const claims = fetchClaims(root);
  const sessions = fetchSessions(root);
  const tasks = fetchTasks(root);
  const processes = fetchProcessOwners();
  const sessionOwnership =
    sessions.error === null
      ? assignActiveSessions(
          units.flatMap((unit) => (unit.path === null ? [] : [unit.path])),
          sessions.sessions,
        )
      : {
          sessionIdsByPath: new Map<string, string[]>(),
          probeErrorsByPath: new Map<string, string[]>(),
        };
  const branchGlobalErrors = [
    ...initialHistoryOverrides.errors,
    initialGrafts.error,
    originIdentity.error,

    ...prs.globalErrors,
    workflows.error,
    claims.error,
    tasks.error,
  ].filter((error): error is string => typeof error === "string");

  const observations: WorktreeLifecycleObservation[] = units.map((unit) => {
    const state = unit.path
      ? statusState(unit.path)
      : { changes: [], ignoredPaths: [], nonDisposableIgnoredPaths: [], error: null };
    const flags = unit.path ? indexFlags(unit.path) : { flags: [], error: null };
    const remoteRefs = refsContaining(root, unit.head);
    const ancestry =
      defaultBranch.oid === null
        ? {
            value: false,
            error: defaultBranch.error ?? "default branch inventory verification failed",
          }
        : onDefaultBranch(root, unit.head, defaultBranch.oid);
    let pullRequestMergeError: string | null = null;
    let unitPullRequests: PullRequest[] = [];
    try {
      unitPullRequests = dedupePullRequests([
        ...(prs.byOid.get(unit.head) ?? []),
        ...(unit.branch ? (prs.byBranch.get(unit.branch) ?? []) : []),
      ]);
    } catch (error) {
      pullRequestMergeError = `pull request inventory returned conflicting duplicates: ${
        error instanceof Error ? error.message : "malformed duplicate"
      }`;
    }
    const exactMerged =
      defaultBranch.branch !== null && prs.canonicalRepo !== null
        ? unitPullRequests
            .filter(
              (pullRequest) =>
                pullRequest.state === "MERGED" &&
                pullRequest.headRefOid === unit.head &&
                pullRequest.baseRepository.toLowerCase() ===
                  prs.canonicalRepo!.toLowerCase() &&
                pullRequest.baseRefName === defaultBranch.branch,
            )
            .sort(
              (left, right) =>
                Date.parse(right.mergedAt!) - Date.parse(left.mergedAt!),
            )[0] ?? null
        : null;
    const landing =
      unit.branch !== null && ancestry.value && defaultBranch.oid !== null
        ? exactDefaultLandingAt(
            root,
            unit.head,
            defaultBranch.oid,
            exactMerged?.mergedAt ?? null,
          )
        : { value: null, error: null };
    const recency = updatedAt(
      unit.path ?? root,
      unit.ref,
      exactMerged?.mergedAt ?? null,
      landing.value,

      unit.path !== null,
    );
    const remote = unit.ref && originIdentity.error === null
      ? exactRemoteRef(root, unit.ref)
      : { remoteRef: null, error: null };
    const metadata = metadataFor(unit.branch, unit.path, tasks.tasks);
    const openPrs = unitPullRequests
      .filter((pullRequest) => pullRequest.state === "OPEN" || pullRequest.isDraft)
      .map((pullRequest) => ({
        number: pullRequest.number,
        url: pullRequest.url,
      }));
    const activeWorkflowUrls = workflows.runs
      .filter(
        (run) =>
          run.head_sha === unit.head ||
          (unit.branch !== null && run.head_branch === unit.branch),
      )
      .map((run) => run.html_url);
    const pathErrors = unit.path ? [state.error, flags.error, processes.error, sessions.error] : [];
    const probeErrors = [
      ...new Set(
        [
          ...unit.initialErrors,
          ...branchGlobalErrors,
          prs.errorsByOid.get(unit.head),
          ...(unit.branch ? [prs.errorsByBranch.get(unit.branch)] : []),
          pullRequestMergeError,
          ...pathErrors,
          ...(unit.path ? (sessionOwnership.probeErrorsByPath.get(unit.path) ?? []) : []),
          recency.error,
          landing.error,
          remoteRefs.error,
          ancestry.error,
          remote.error,
          ...(unit.ref ? [directRefError(root, unit.ref)] : []),
        ].filter((error): error is string => typeof error === "string"),
      ),
    ];


    return {
      kind: unit.kind,
      path: unit.path,
      ref: unit.ref,
      branch: unit.branch,
      head: unit.head,
      isPrimary: unit.path !== null && normalizePath(unit.path) === primaryPath,
      protectedBranch:
        unit.branch !== null &&
        (PROTECTED_BRANCHES.has(unit.branch) || unit.branch === defaultBranch.branch),
      changes: state.changes,
      ignoredPaths: state.ignoredPaths,
      nonDisposableIgnoredPaths: state.nonDisposableIgnoredPaths,
      indexFlags: flags.flags,
      processOwners: unit.path ? processOwnersFor(unit.path, processes.owners) : [],
      claimOwners: [
        ...new Set(
          claims.claims
            .filter(
              (claim) =>
                claim.state === "active" &&
                (claim.branch === unit.branch || claim.head === unit.head),
            )
            .map((claim) => claim.agent_id),
        ),
      ],
      taskIds: matchingTasks(unit.branch, unit.path, unit.head, tasks.tasks),
      openPrs,
      mergedPr: exactMerged
        ? {
            number: exactMerged.number,
            url: exactMerged.url,
            headOid: exactMerged.headRefOid,
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
      sessionIds: unit.path
        ? (sessionOwnership.sessionIdsByPath.get(unit.path) ?? [])
        : [],
    };
  });

  const finalWorktreeRaw = requiredGit(root, ["worktree", "list", "--porcelain", "-z"]);
  const finalRefsRaw = requiredGit(root, [
    "for-each-ref",
    "--format=%(refname)%0a%(objectname)%00",
    "refs/heads",
  ]);
  const finalReplacementRefsRaw = requiredGit(root, [
    "for-each-ref",
    "--format=%(refname)%0a%(objectname)%00",
    "refs/replace",
  ]);
  const finalGrafts = graftInventory(commonGitDir);
  const finalHistoryOverrides = historyOverrideProbe(root, commonGitDir);
  // Local git state moving during the patrol used to abort the entire run. On a
  // checkout shared by several agents that fires constantly — one session
  // committing on its own branch discarded a multi-minute inventory of every
  // other unit — so the patrol could not be run to completion at all
  // (cave-63m12).
  //
  // Drift is now scoped to the units it can actually affect. What each unit's
  // verdict rests on is its OWN ref OID, its OWN worktree registration, and the
  // set of worktrees holding its ref. Nothing else in `refs/heads` can change a
  // conclusion about it: default-branch ancestry is measured against the
  // REMOTE-tracking ref, which this snapshot does not even cover.
  //
  // Two asymmetries make this safe rather than merely convenient:
  //   - A unit that gained drift is marked `uncertain`, never retired. Losing a
  //     verdict is free; acting on a stale one is not.
  //   - Refs and worktrees that APPEAR mid-run are simply absent from this
  //     report. A unit that is not reported is never retired, so an incomplete
  //     snapshot is conservative by construction.
  //
  // A snapshot that cannot be parsed is still a global failure: that is an
  // integrity problem rather than ordinary churn.
  let driftReasonByUnitKey: Map<string, string>;
  try {
    driftReasonByUnitKey = unitScopedDrift({
      units,
      initialWorktreeRaw,
      initialRefsRaw,
      finalWorktreeRaw,
      finalRefsRaw,
    });
  } catch (error) {
    // Keep the parse failure attached: this is now the ONLY whole-run abort, so
    // "changed during patrol" with no detail would be the least diagnosable
    // message in the script.
    throw new Error("worktree or branch inventory changed during patrol", { cause: error });
  }
  if (
    finalHistoryOverrides.replaceRefsState !== initialHistoryOverrides.replaceRefsState ||
    finalHistoryOverrides.graftState !== initialHistoryOverrides.graftState ||
    finalReplacementRefsRaw !== initialReplacementRefsRaw ||
    finalGrafts.snapshot !== initialGrafts.snapshot
  ) {
    throw new Error(HISTORY_OVERRIDE_DRIFT_ERROR);
  }

  const structuredRecords = tasks.tasks
    .flatMap((task) => task.structured);
  const validMetadata = structuredRecords
    .filter(
      (record): record is StructuredMetadataRecord & { metadata: WorktreeLifecycleMetadata } =>
        record.errors.length === 0 && record.metadata !== null,
    )
    .filter(() => tasks.tasks.every((task) => task.structuredErrors.length === 0))
    .filter(
      (record) =>
        structuredRecords.filter((candidate) => candidate.branch === record.branch).length === 1,
    )
    .filter(
      (record) => {
        const recordPath = normalizeAbsoluteWorktreePath(record.path);
        return (
          recordPath !== null &&
          structuredRecords.filter(
            (candidate) =>
              normalizeAbsoluteWorktreePath(candidate.path) === recordPath,
          ).length === 1
        );
      },
    )
    .filter((record) => {
      const recordPath = normalizeAbsoluteWorktreePath(record.path);
      if (recordPath === null) return false;
      return units.some((unit) => {
        if (unit.branch !== record.branch) return false;
        if (unit.kind === "branch-only") return true;
        const unitPath = normalizeAbsoluteWorktreePath(unit.path);
        return unitPath !== null && unitPath === recordPath;
      });
    });
  const exceptions = [
    ...new Map(
      validMetadata
        .flatMap((record) =>
          record.metadata.exception ? [record.metadata.exception] : [],
        )
        .map((exception) => [
          JSON.stringify({
            owner: exception.owner,
            reason: exception.reason,
            expiresAt: exception.expiresAt,
            additionalPaths: [
              ...new Set(
                exception.additionalPaths.flatMap((candidate) => {
                  const normalized = normalizeAbsoluteWorktreePath(candidate);
                  return normalized === null ? [] : [normalized];
                }),
              ),
            ].sort(),
          }),
          exception,
        ]),
    ).values(),
  ];
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

  // A unit whose own inputs moved carries that as a probe error, which lands it
  // in `uncertain` — the same posture the whole-run abort had, applied only
  // where it is warranted.
  const driftedObservations = observations.map((observation) => {
    const reason = driftReasonByUnitKey.get(lifecycleUnitKey(observation));
    return reason === undefined
      ? observation
      : { ...observation, probeErrors: [...observation.probeErrors, reason] };
  });

  return {
    items: driftedObservations.map((observation) =>
      classifyInventoryObservation(observation, options.nowMs),
    ),
    budgets,
    globalErrors: [...new Set(branchGlobalErrors)],
    inventoryFingerprint: fingerprint(
      initialWorktreeRaw,
      initialRefsRaw,
      initialHistoryOverrides.replaceRefsState,
      initialHistoryOverrides.graftState,
    ),
  };
}
