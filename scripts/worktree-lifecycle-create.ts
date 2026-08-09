#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  assessManagedWorktreeCreation,
  calculateLifecycleBudgets,
  isDisposableIgnoredPath,
  type LifecycleDisposition,
  type ManagedCreationException,
  type WorktreeLifecycleBudgets,
  type WorktreeLifecycleItem,
} from "../src/lib/worktree-lifecycle.ts";
import {
  collectWorktreeLifecycleInventory,
  type WorktreeMetadataClaimError,
} from "./worktree-lifecycle-inventory.ts";
import {
  heartbeatWriterIntent,
  registerWriterIntent,
  releaseWriterIntent,
  repositoryMaintenanceCapabilities,
} from "./maintenance-gate.mjs";

const REPOSITORY = "OpenCoven/coven-cave";
const INTENT_TTL_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 120_000;
const OID = /^[0-9a-f]{40,64}$/;
const REVIEW_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-](\d{2}):(\d{2}))$/;
const DISPOSITIONS = new Set<LifecycleDisposition>([
  "active",
  "pr",
  "recovery",
  "archive",
]);
const BEAD_STATUSES = new Set(["open", "in_progress", "blocked", "deferred"]);

type JsonRecord = Record<string, unknown>;

type CommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
};

type ManagedCreateOptions = {
  root: string;
  beadId: string;
  branch: string;
  owner: string;
  purpose: string;
  disposition: LifecycleDisposition;
  reason: string | null;
  reviewAfter: string | null;
  exception: ManagedCreationException | null;
  startPoint: string;
};

type ExactBead = {
  id: string;
  status: string;
  metadata: JsonRecord;
  raw: JsonRecord;
};

type ParsedRecord = {
  raw: JsonRecord;
  branch: string;
  path: string;
  exception: ManagedCreationException | null;
};

type ParsedCoven = {
  raw: JsonRecord;
  primary: ParsedRecord | null;
  additional: ParsedRecord[];
};

type WorktreeRegistration = {
  path: string;
  fullRef: string | null;
  branch: string | null;
  head: string;
};

type PartialState = {
  pathEntry: {
    exists: boolean;
    kind: "absent" | "symbolic-link" | "directory" | "file" | "other";
  };
  registrations: WorktreeRegistration[];
  ref: { fullRef: string; oid: string } | null;
  worktreeHead: string | null;
  probeErrors: string[];
};

type CreationEvidence = {
  path: string;
  ref: string;
  oid: string;
};

type CreatedReport = {
  beadId: string;
  branch: string;
  fullRef: string;
  path: string;
  head: string;
  metadata: JsonRecord;
  warning?: string;
};

type Outcome = {
  status: number;
  stdout: string | null;
  stderr: string[];
  createdReport: CreatedReport | null;
};

type WriterLease = {
  writerId: string;
  token: string;
  root: string;
};

const registerIntent = registerWriterIntent as unknown as (options: {
  writerId: string;
  purpose: string;
  repoDir: string;
  ttlMs: number;
}) =>
  | { ok: true; lease: WriterLease }
  | { ok: false; reason: string };

class CliError extends Error {
  readonly exitCode: number;

  constructor(
    message: string,
    exitCode = 1,
  ) {
    super(message);
    this.exitCode = exitCode;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function command(
  executable: string,
  args: string[],
  cwd: string,
  timeout = COMMAND_TIMEOUT_MS,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const errorMessage =
    result.error instanceof Error ? result.error.message : "";
  const stderr = [
    typeof result.stderr === "string" ? result.stderr.trim() : "",
    errorMessage,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr,
  };
}

function git(root: string, args: string[], timeout?: number): CommandResult {
  return command("git", ["-C", root, ...args], root, timeout);
}

function nonblank(name: string, value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new CliError(`${name} is required`);
  }
  return value;
}

function realCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    leap ? 29 : 28,
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
  return day <= days[month - 1]!;
}

function strictReviewDate(value: string): boolean {
  const match = value.match(REVIEW_DATE);
  return (
    match !== null &&
    realCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  );
}

function validInstantMatch(
  value: string,
  expression: RegExp,
  utcOnly: boolean,
): boolean {
  const match = value.match(expression);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    !realCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (!utcOnly) {
    const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
    const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function strictUtcInstant(value: string): boolean {
  return validInstantMatch(value, UTC_INSTANT, true);
}

function validStoredInstant(value: string): boolean {
  return validInstantMatch(value, RFC3339_INSTANT, false);
}

function parseArgs(argv: string[]): ManagedCreateOptions {
  const values = new Map<string, string>();
  const exceptionPaths: string[] = [];
  const allowed = new Set([
    "--root",
    "--bead",
    "--branch",
    "--owner",
    "--purpose",
    "--disposition",
    "--reason",
    "--review-after",
    "--start-point",
    "--exception-owner",
    "--exception-reason",
    "--exception-expires-at",
    "--exception-path",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!allowed.has(flag)) throw new CliError(`unknown option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`${flag} requires a value`);
    }
    index += 1;
    if (flag === "--exception-path") {
      exceptionPaths.push(value);
      continue;
    }
    if (values.has(flag)) throw new CliError(`${flag} may be supplied only once`);
    values.set(flag, value);
  }

  const beadId = nonblank("--bead", values.get("--bead"));
  const branch = nonblank("--branch", values.get("--branch"));
  const owner = nonblank("--owner", values.get("--owner"));
  const purpose = nonblank("--purpose", values.get("--purpose"));
  const dispositionValue = values.get("--disposition") ?? "active";
  if (!DISPOSITIONS.has(dispositionValue as LifecycleDisposition)) {
    throw new CliError("--disposition must be active, pr, recovery, or archive");
  }
  const disposition = dispositionValue as LifecycleDisposition;
  const reason = values.has("--reason")
    ? nonblank("--reason", values.get("--reason"))
    : null;
  const reviewAfter = values.has("--review-after")
    ? nonblank("--review-after", values.get("--review-after"))
    : null;
  if (reviewAfter !== null && !strictReviewDate(reviewAfter)) {
    throw new CliError("--review-after must be a real YYYY-MM-DD calendar date");
  }
  if (
    (disposition === "recovery" || disposition === "archive") &&
    (reason === null || reviewAfter === null)
  ) {
    throw new CliError(
      `${disposition} disposition requires --reason and --review-after`,
    );
  }

  const exceptionOwner = values.get("--exception-owner");
  const exceptionReason = values.get("--exception-reason");
  const exceptionExpiresAt = values.get("--exception-expires-at");
  const hasException =
    exceptionOwner !== undefined ||
    exceptionReason !== undefined ||
    exceptionExpiresAt !== undefined ||
    exceptionPaths.length > 0;
  let exception: ManagedCreationException | null = null;
  if (hasException) {
    const parsedOwner = nonblank("--exception-owner", exceptionOwner);
    const parsedReason = nonblank("--exception-reason", exceptionReason);
    const parsedExpiry = nonblank(
      "--exception-expires-at",
      exceptionExpiresAt,
    );
    if (exceptionPaths.length === 0) {
      throw new CliError("at least one --exception-path is required");
    }
    if (!strictUtcInstant(parsedExpiry)) {
      throw new CliError(
        "--exception-expires-at must be a real canonical UTC ISO timestamp",
      );
    }
    if (Date.parse(parsedExpiry) <= Date.now()) {
      throw new CliError("--exception-expires-at must be in the future");
    }
    if (!exceptionPaths.every((candidate) => path.isAbsolute(candidate))) {
      throw new CliError("--exception-path values must be absolute");
    }
    exception = {
      owner: parsedOwner,
      reason: parsedReason,
      expiresAt: parsedExpiry,
      additionalPaths: [
        ...new Set(exceptionPaths.map((candidate) => path.normalize(candidate))),
      ],
    };
  }

  return {
    root: values.get("--root") ?? process.cwd(),
    beadId,
    branch,
    owner,
    purpose,
    disposition,
    reason,
    reviewAfter,
    exception,
    startPoint: nonblank(
      "--start-point",
      values.get("--start-point") ?? "origin/main",
    ),
  };
}

function pathEntry(candidate: string): PartialState["pathEntry"] {
  try {
    const stat = lstatSync(candidate);
    return {
      exists: true,
      kind: stat.isSymbolicLink()
        ? "symbolic-link"
        : stat.isDirectory()
          ? "directory"
          : stat.isFile()
            ? "file"
            : "other",
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { exists: false, kind: "absent" };
    }
    throw error;
  }
}

function validateBranchAndPath(
  root: string,
  branch: string,
): { fullRef: string; worktreePath: string } {
  if (branch.startsWith("refs/")) {
    throw new CliError(`full ref is not a valid local branch name: ${branch}`);
  }
  const branchCheck = git(root, ["check-ref-format", "--branch", branch]);
  if (!branchCheck.ok || branchCheck.stdout.trim() !== branch) {
    throw new CliError(
      branchCheck.stderr || `invalid exact local branch name: ${branch}`,
    );
  }
  const fullRef = `refs/heads/${branch}`;
  const slug = branch
    .replace(/^(?:feat|fix|docs|chore)\//, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  const managedRoot = path.resolve(root, ".worktrees");
  const worktreePath = path.resolve(managedRoot, slug);
  if (!worktreePath.startsWith(`${managedRoot}${path.sep}`)) {
    throw new CliError("managed worktree path escapes .worktrees");
  }
  return { fullRef, worktreePath };
}

function assertRefAndPathAbsent(
  root: string,
  fullRef: string,
  worktreePath: string,
): void {
  const ref = git(root, ["show-ref", "--verify", "--quiet", fullRef]);
  if (ref.status === 0) throw new CliError(`local branch already exists: ${fullRef}`);
  if (ref.status !== 1) {
    throw new CliError(
      ref.stderr || `could not prove local branch absence: ${fullRef}`,
    );
  }
  const entry = pathEntry(worktreePath);
  if (entry.exists) {
    throw new CliError(`managed worktree path already exists: ${worktreePath}`);
  }
}

function parseJson(stdout: string, label: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new CliError(`${label} returned malformed JSON`);
  }
}

function candidateFromWrapper(value: JsonRecord): unknown {
  const wrapperKeys = ["issue", "issues"].filter((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
  const looksLikeIssue =
    Object.prototype.hasOwnProperty.call(value, "id") ||
    Object.prototype.hasOwnProperty.call(value, "status");
  if (looksLikeIssue && wrapperKeys.length > 0) {
    throw new CliError("exact Bead response is ambiguous");
  }
  if (looksLikeIssue) return value;
  if (wrapperKeys.length !== 1) {
    throw new CliError("exact Bead response is malformed");
  }
  return value[wrapperKeys[0]!];
}

function exactSingleCandidate(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new CliError("exact Bead response must contain one issue");
    }
    return value[0];
  }
  if (!isRecord(value)) {
    throw new CliError("exact Bead response is malformed");
  }
  const candidate = candidateFromWrapper(value);
  if (Array.isArray(candidate)) {
    if (candidate.length !== 1) {
      throw new CliError("exact Bead response must contain one issue");
    }
    return candidate[0];
  }
  return candidate;
}

function parseExactBead(
  stdout: string,
  requestedId: string,
): ExactBead {
  const candidate = exactSingleCandidate(parseJson(stdout, "bd show"));
  if (!isRecord(candidate)) {
    throw new CliError("exact Bead response is malformed");
  }
  if (candidate.id !== requestedId) {
    throw new CliError(`bd show did not return exact Bead ${requestedId}`);
  }
  if (typeof candidate.status !== "string") {
    throw new CliError("exact Bead status is malformed");
  }
  if (candidate.status === "closed") {
    throw new CliError(`Bead ${requestedId} is closed; a non-closed Bead is required`);
  }
  if (!BEAD_STATUSES.has(candidate.status)) {
    throw new CliError(`Bead ${requestedId} has unrecognized status ${candidate.status}`);
  }
  if (
    candidate.metadata !== undefined &&
    candidate.metadata !== null &&
    !isRecord(candidate.metadata)
  ) {
    throw new CliError("Bead metadata must be an object or null");
  }
  return {
    id: requestedId,
    status: candidate.status,
    metadata: isRecord(candidate.metadata) ? candidate.metadata : {},
    raw: candidate,
  };
}

function loadExactBead(root: string, beadId: string): ExactBead {
  const result = command("bd", ["show", beadId, "--json"], root);
  if (!result.ok) {
    throw new CliError(result.stderr || `bd show ${beadId} failed`);
  }
  return parseExactBead(result.stdout, beadId);
}

function parseStoredException(
  value: unknown,
  label: string,
): ManagedCreationException | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new CliError(`${label} exception must be an object`);
  const { owner, reason, expiresAt, additionalPaths } = value;
  if (typeof owner !== "string" || owner.trim().length === 0) {
    throw new CliError(`${label} exception owner must be nonblank`);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new CliError(`${label} exception reason must be nonblank`);
  }
  if (typeof expiresAt !== "string" || !validStoredInstant(expiresAt)) {
    throw new CliError(`${label} exception expiresAt must be an RFC3339 timestamp`);
  }
  if (
    !Array.isArray(additionalPaths) ||
    additionalPaths.length === 0 ||
    !additionalPaths.every(
      (candidate) =>
        typeof candidate === "string" && path.isAbsolute(candidate),
    )
  ) {
    throw new CliError(`${label} exception additionalPaths must be absolute paths`);
  }
  return {
    owner,
    reason,
    expiresAt,
    additionalPaths: additionalPaths as string[],
  };
}

function canonicalExistingCandidate(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return normalizeCandidate(candidate);
  }
}

function managedRecordPath(
  root: string,
  recordPath: string,
  label: string,
): string {
  const managedRoot = canonicalExistingCandidate(
    path.resolve(root, ".worktrees"),
  );
  const candidate = canonicalExistingCandidate(recordPath);
  if (!candidate.startsWith(`${managedRoot}${path.sep}`)) {
    throw new CliError(`${label} path must be inside the managed .worktrees root`);
  }
  return candidate;
}

function parseFullRecord(
  value: unknown,
  label: string,
  root: string,
): ParsedRecord {
  if (!isRecord(value)) throw new CliError(`${label} must be an object`);
  const {
    branch,
    path: recordPath,
    owner,
    purpose,
    disposition,
    createdAt,
    reason,
    reviewAfter,
  } = value;
  if (
    typeof branch !== "string" ||
    branch.trim().length === 0 ||
    branch.trim() !== branch ||
    branch.startsWith("refs/heads/")
  ) {
    throw new CliError(`${label} branch is unusable`);
  }
  const branchCheck = git(root, ["check-ref-format", "--branch", branch]);
  if (!branchCheck.ok || branchCheck.stdout.trim() !== branch) {
    throw new CliError(`${label} branch is unusable`);
  }
  if (typeof recordPath !== "string" || !path.isAbsolute(recordPath)) {
    throw new CliError(`${label} path must be absolute`);
  }
  const parsedPath = managedRecordPath(root, recordPath, label);
  if (typeof owner !== "string" || owner.trim().length === 0) {
    throw new CliError(`${label} owner must be nonblank`);
  }
  if (typeof purpose !== "string" || purpose.trim().length === 0) {
    throw new CliError(`${label} purpose must be nonblank`);
  }
  if (
    typeof disposition !== "string" ||
    !DISPOSITIONS.has(disposition as LifecycleDisposition)
  ) {
    throw new CliError(`${label} disposition is invalid`);
  }
  if (typeof createdAt !== "string" || !validStoredInstant(createdAt)) {
    throw new CliError(`${label} createdAt must be an RFC3339 timestamp`);
  }
  if (
    reason !== undefined &&
    (typeof reason !== "string" || reason.trim().length === 0)
  ) {
    throw new CliError(`${label} reason must be nonblank`);
  }
  if (
    reviewAfter !== undefined &&
    (typeof reviewAfter !== "string" || !strictReviewDate(reviewAfter))
  ) {
    throw new CliError(`${label} reviewAfter must be a real YYYY-MM-DD date`);
  }
  if (
    (disposition === "recovery" || disposition === "archive") &&
    (typeof reason !== "string" || typeof reviewAfter !== "string")
  ) {
    throw new CliError(`${label} recovery/archive record requires reason and reviewAfter`);
  }
  return {
    raw: value,
    branch,
    path: parsedPath,
    exception: parseStoredException(value.exception, label),
  };
}

function parseCoven(metadata: JsonRecord, root: string): ParsedCoven {
  const value = metadata.coven;
  if (value === undefined || value === null) {
    return { raw: {}, primary: null, additional: [] };
  }
  if (!isRecord(value)) throw new CliError("metadata.coven must be an object");
  const primary =
    value.worktree === undefined || value.worktree === null
      ? null
      : parseFullRecord(value.worktree, "metadata.coven.worktree", root);
  let additional: ParsedRecord[] = [];
  if (value.worktrees !== undefined) {
    if (!Array.isArray(value.worktrees)) {
      throw new CliError("metadata.coven.worktrees must be an array");
    }
    additional = value.worktrees.map((record, index) =>
      parseFullRecord(record, `metadata.coven.worktrees[${index}]`, root),
    );
    if (primary === null && additional.length > 0) {
      throw new CliError("metadata.coven.worktrees requires a primary worktree record");
    }
  }
  const records = [...(primary ? [primary] : []), ...additional];
  const branches = new Set<string>();
  const paths = new Set<string>();
  for (const record of records) {
    if (branches.has(record.branch)) {
      throw new CliError(`duplicate managed worktree branch: ${record.branch}`);
    }
    if (paths.has(record.path)) {
      throw new CliError(`duplicate managed worktree path: ${record.path}`);
    }
    branches.add(record.branch);
    paths.add(record.path);
  }
  return { raw: value, primary, additional };
}

function normalizeCandidate(candidate: string): string {
  return path.normalize(path.resolve(candidate));
}

function exceptionKey(exception: ManagedCreationException): string {
  return JSON.stringify({
    owner: exception.owner,
    reason: exception.reason,
    expiresAt: exception.expiresAt,
    additionalPaths: [
      ...new Set(exception.additionalPaths.map(normalizeCandidate)),
    ].sort(),
  });
}

function exceptionForAssessment(
  exception: ManagedCreationException | null,
): ManagedCreationException | null {
  if (exception === null) return null;
  return {
    ...exception,
    additionalPaths: [
      ...new Set(exception.additionalPaths.map(normalizeCandidate)),
    ],
  };
}

function exceptionForPath(
  parsed: ParsedCoven,
  requestedPath: string,
  nowMs: number,
): ManagedCreationException | null {
  const normalized = normalizeCandidate(requestedPath);
  const candidates = [
    ...(parsed.primary?.exception ? [parsed.primary.exception] : []),
    ...parsed.additional.flatMap((record) =>
      record.exception ? [record.exception] : [],
    ),
  ].filter(
    (exception) =>
      Date.parse(exception.expiresAt) > nowMs &&
      exception.additionalPaths
        .map(normalizeCandidate)
        .includes(normalized),
  );
  const unique = new Map(candidates.map((exception) => [exceptionKey(exception), exception]));
  if (unique.size > 1) {
    throw new CliError("multiple conflicting worktree exceptions authorize the requested path");
  }
  return unique.values().next().value ?? null;
}

/**
 * Errors that can actually make a CREATION decision wrong.
 *
 * Creation reads exactly two things out of the inventory: the paths this bead
 * already owns ({@link existingOwnedPaths}) and the budget counts. The first is
 * derived from each item's path, taskIds and bead metadata, so a metadata error
 * can hide an owned path and let creation past a budget it should have hit —
 * that stays a hard stop, repo-wide. The second comes from local git facts
 * (worktree count, branch count, exception counts) and no probe touches it.
 *
 * `probeErrors` are deliberately NOT included. They answer "is this unit safe to
 * RETIRE" — landing time, PR association, ref recency — which creation never
 * asks. Aggregating them here meant one unrelated unit denied `create` to every
 * bead, and the units that tripped it were ones creation has no opinion about:
 * the `__dolt_remote_info__` bookkeeping ref (protected, local commits GitHub has
 * never seen, no reflog), and any branch whose HEAD still equals the default tip
 * — which is every freshly-created worktree, so each new worktree blocked the
 * next one. The inventory already reports probe failures per unit and lands that
 * unit in `uncertain`; this makes the create gate agree with that posture instead
 * of re-aborting the whole run (cave-c4f97).
 */
function inventoryErrors(items: WorktreeLifecycleItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.metadataErrors))];
}

/**
 * The malformed metadata records that stand in the way of *this* creation.
 *
 * A record that fails validation still names the branch and path it claims, so
 * it can be charged to the unit it describes instead of to the repository. That
 * scoping is the whole point of cave-g9byt — one bead's bad `disposition` had
 * been failing `--bead` for every other bead in the checkout — but it must not
 * become a way to create *over* a claim: a record already holding this branch
 * or this path is exactly the collision the abort was protecting, and a
 * malformed one is no less a claim than a valid one. A record naming neither a
 * usable branch nor a usable path claims something unnameable, so it keeps
 * blocking everything until someone repairs it.
 */
function claimErrorsForRequest(
  claims: WorktreeMetadataClaimError[],
  branch: string,
  worktreePath: string,
): string[] {
  const requested = normalizeCandidate(worktreePath);
  return [
    ...new Set(
      claims
        .filter((claim) => {
          const unattributable = claim.branch.trim().length === 0 && claim.path === null;
          return (
            unattributable ||
            claim.branch === branch ||
            (claim.path !== null && normalizeCandidate(claim.path) === requested)
          );
        })
        .flatMap((claim) => claim.errors),
    ),
  ];
}

function existingOwnedPaths(
  items: WorktreeLifecycleItem[],
  beadId: string,
): string[] {
  const normalizedId = beadId.toLowerCase();
  return [
    ...new Set(
      items
        .filter((item) => item.path !== null)
        .filter(
          (item) =>
            item.taskIds.some((taskId) => taskId.toLowerCase() === normalizedId) ||
            item.metadata?.beadId.toLowerCase() === normalizedId,
        )
        .map((item) => normalizeCandidate(item.path!)),
    ),
  ];
}

const EXCEPTION_SUGGESTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The `--exception-*` rerun that this refusal would admit.
 *
 * A gate that does not name its own escape hatch gets routed around: the only
 * workaround the prose docs used to offer was a bare `git worktree add`, which
 * produces a unit with no lifecycle metadata that automated retirement can never
 * remove. That is how a budget meant to cap sprawl came to feed it. Printing the
 * admissible command makes the sanctioned path the easy one.
 *
 * Only pass this for refusals an exception genuinely lifts — see
 * {@link assessManagedWorktreeCreation}, whose every reason qualifies.
 */
function exceptionSuggestion(options: ManagedCreateOptions, worktreePath: string): string[] {
  const expiresAt = new Date(Date.now() + EXCEPTION_SUGGESTION_WINDOW_MS).toISOString();
  return [
    "",
    "This admission refusal can be lifted with an attributed, expiring exception",
    "that applies to this worktree path. The same gate admits it and the unit",
    "stays retirable:",
    "",
    "Do not fall back to a bare `git worktree add`: a worktree created that way",
    "carries no lifecycle metadata, so the patrol reports it `uncertain`",
    "permanently and `pnpm beads:worktrees:apply` can never retire it.",
    "",
    "  pnpm beads:worktrees:create \\",
    `    --bead ${shellQuote(options.beadId)} \\`,
    `    --branch ${shellQuote(options.branch)} \\`,
    `    --owner ${shellQuote(options.owner)} \\`,
    `    --purpose ${shellQuote(options.purpose)} \\`,
    `    --exception-owner ${shellQuote(options.owner)} \\`,
    "    --exception-reason 'why this exception is needed' \\",
    `    --exception-expires-at ${expiresAt} \\`,
    `    --exception-path ${shellQuote(worktreePath)}`,
  ];
}

/**
 * Only suggest the patrol's `--apply` when it can actually run.
 *
 * This line used to be unconditional, on EVERY refusal this script emits —
 * budget, duplicate metadata, orphaned record alike. But `--apply` refuses
 * outright whenever any maintenance plane is unenforced, and
 * `repositoryMaintenanceCapabilities()` has three of the four hard-coded to
 * `false` against unbuilt work, so the suggestion has never been runnable in
 * this repository (cave-wmkn4).
 *
 * A refusal that prints an impossible next step is worse than one that prints
 * none: it sends the operator through a command that exits 2, and the documented
 * escapes they reach for next are the ones the guard rules exist to forbid — a
 * bare `git worktree add`, which yields a permanently `uncertain` unit, or
 * hand-editing the bead, which is the forgery cave-l52dt rules out.
 *
 * Uses `capabilities.complete` to gate the suggestion — the same field the
 * patrol itself uses — rather than counting per-plane `enforced === false`.
 * A newly added unenforced plane, or any other condition that sets
 * `complete=false`, will suppress the suggestion even if the listed-plane scan
 * would have wrongly cleared it.
 *
 * `includeRetireByHand` controls whether the hand-retirement route is printed.
 * It is only relevant for budget refusals; non-budget refusals (duplicate
 * metadata, missing primary registration) should omit it.
 */
function maintenanceSuggestion(
  capabilities = repositoryMaintenanceCapabilities(),
  includeRetireByHand = true,
): string[] {
  if (capabilities?.complete) return ["Suggestion: pnpm beads:worktrees:apply"];
  const planes = ["coven", "beads", "github", "local"] as const;
  const missing = capabilities
    ? planes.filter((plane) => capabilities[plane]?.enforced === false)
    : [];
  const planeSummary =
    missing.length > 0 ? missing.join(", ") : "unknown (capabilities unavailable)";
  const lines: string[] = [
    `Note: pnpm beads:worktrees:apply cannot run here — unenforced maintenance planes: ${planeSummary}.`,
  ];
  if (includeRetireByHand) {
    lines.push(
      "Retire by hand instead: prove retention (a remote branch, or a pushed archive tag —",
      "a merged PR is not retention, since a squash leaves the branch's commits on no remote ref),",
      "then `git worktree unlock <path> && git worktree remove <path> && git branch -d <branch>`.",
    );
  }
  return lines;
}

function refusalOutcome(
  reasons: string[],
  suggestion: string[] = [],
  includeRetireByHand = true,
): Outcome {
  return {
    status: 2,
    stdout: null,
    stderr: [
      ...reasons.map((reason) => `worktree-lifecycle-create: ${reason}`),
      ...maintenanceSuggestion(undefined, includeRetireByHand),
      ...suggestion,
    ],
    createdReport: null,
  };
}

function errorOutcome(message: string): Outcome {
  return {
    status: 1,
    stdout: null,
    stderr: [`worktree-lifecycle-create: ${message}`],
    createdReport: null,
  };
}

function createdOutcome(
  report: CreatedReport,
  status = 0,
  warnings: string[] = [],
): Outcome {
  return {
    status,
    stdout: JSON.stringify(report),
    stderr: warnings.map((warning) => `worktree-lifecycle-create: ${warning}`),
    createdReport: report,
  };
}

function heartbeatBoth(leases: WriterLease[], stage: string): void {
  if (leases.length !== 2) {
    throw new CliError(`writer leases unavailable during ${stage}`);
  }
  const failures: string[] = [];
  for (const lease of leases) {
    const result = heartbeatWriterIntent(lease);
    if (!result.ok) failures.push(`${lease.writerId}: ${result.reason}`);
  }
  if (failures.length > 0) {
    throw new CliError(`writer lease heartbeat failed during ${stage}: ${failures.join(", ")}`);
  }
}

function parseWorktreeRegistrations(stdout: string): WorktreeRegistration[] {
  return stdout
    .split("\0\0")
    .map((record) => record.split("\0").filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const fields = new Map<string, string>();
      for (const line of lines) {
        const separator = line.indexOf(" ");
        fields.set(
          separator < 0 ? line : line.slice(0, separator),
          separator < 0 ? "" : line.slice(separator + 1),
        );
      }
      const fullRef = fields.get("branch") || null;
      return {
        path: path.normalize(fields.get("worktree") ?? ""),
        fullRef,
        branch:
          fullRef?.startsWith("refs/heads/") === true
            ? fullRef.slice("refs/heads/".length)
            : null,
        head: fields.get("HEAD") ?? "",
      };
    });
}

function assessLocalRefusalPreflight(
  root: string,
  beadId: string,
  parsed: ParsedCoven,
  requestedPath: string,
  exception: ManagedCreationException | null,
  nowMs: number,
): {
  assessment: { allowed: boolean; reasons: string[] };
  registeredPaths: Set<string>;
} {
  const worktreeList = git(root, ["worktree", "list", "--porcelain", "-z"]);
  if (!worktreeList.ok) {
    throw new CliError(
      worktreeList.stderr || "local worktree admission preflight failed",
    );
  }
  const registrations = parseWorktreeRegistrations(worktreeList.stdout);
  if (registrations.some((registration) => registration.path.length === 0)) {
    throw new CliError("local worktree admission preflight was malformed");
  }
  const registeredPaths = new Set(
    registrations.map((registration) =>
      canonicalExistingCandidate(registration.path),
    ),
  );
  const structuredPaths = [
    ...(parsed.primary ? [parsed.primary.path] : []),
    ...parsed.additional.map((record) => record.path),
  ].filter((recordPath) =>
    registeredPaths.has(canonicalExistingCandidate(recordPath)),
  );

  const branchList = git(root, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
  ]);
  if (!branchList.ok) {
    throw new CliError(
      branchList.stderr || "local branch admission preflight failed",
    );
  }
  const branches = branchList.stdout
    .split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean);
  if (branches.some((branch) => !branch.startsWith("refs/heads/"))) {
    throw new CliError("local branch admission preflight was malformed");
  }

  const branchCount = new Set(branches).size;
  return {
    assessment: assessManagedWorktreeCreation({
      beadId,
      requestedPath,
      nowMs,
      existingPaths: structuredPaths,
      // Routed through the shared calculation rather than repeating the
      // arithmetic here. This preflight is the surface that actually issues the
      // refusal, so a second copy of the rule is a second place for it to drift
      // — which is how the detached-unit exclusion (cave-oenag) could have
      // landed in the report while the refusal kept the old count.
      budgets: calculateLifecycleBudgets({
        worktreeCount: registrations.length,
        detachedWorktreeCount: registrations.filter(
          (registration) => registration.branch === null,
        ).length,
        branchCount,
        activeExceptions: 0,
        expiredExceptions: 0,
      }),
      exception: exceptionForAssessment(exception),
    }),
    registeredPaths,
  };
}

function probePartialState(
  root: string,
  worktreePath: string,
  fullRef: string,
): PartialState {
  const probeErrors: string[] = [];
  let registrations: WorktreeRegistration[] = [];
  const worktrees = git(root, ["worktree", "list", "--porcelain", "-z"]);
  if (worktrees.ok) {
    const normalized = normalizeCandidate(worktreePath);
    registrations = parseWorktreeRegistrations(worktrees.stdout).filter(
      (record) => normalizeCandidate(record.path) === normalized,
    );
  } else {
    probeErrors.push(worktrees.stderr || "worktree registration probe failed");
  }

  let ref: PartialState["ref"] = null;
  const refPresence = git(root, ["show-ref", "--verify", "--quiet", fullRef]);
  if (refPresence.status === 0) {
    const symbolic = git(root, ["symbolic-ref", "-q", fullRef]);
    if (symbolic.status === 0) {
      probeErrors.push(`local ref is symbolic: ${fullRef}`);
    } else if (symbolic.status !== 1) {
      probeErrors.push(
        symbolic.stderr || `local ref directness probe failed for ${fullRef}`,
      );
    }
    const refProbe = git(root, ["rev-parse", "--verify", `${fullRef}^{commit}`]);
    if (refProbe.ok && OID.test(refProbe.stdout.trim())) {
      ref = { fullRef, oid: refProbe.stdout.trim() };
    } else {
      probeErrors.push(refProbe.stderr || `local ref OID probe failed for ${fullRef}`);
    }
  } else if (refPresence.status !== 1) {
    probeErrors.push(
      refPresence.stderr || `local ref probe failed for ${fullRef}`,
    );
  }

  let head: string | null = null;
  if (pathEntry(worktreePath).exists) {
    const headProbe = git(worktreePath, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (headProbe.ok && OID.test(headProbe.stdout.trim())) {
      head = headProbe.stdout.trim();
    } else {
      probeErrors.push(headProbe.stderr || "worktree HEAD probe failed");
    }
  }
  return {
    pathEntry: pathEntry(worktreePath),
    registrations,
    ref,
    worktreeHead: head,
    probeErrors,
  };
}

function hasArtifacts(state: PartialState): boolean {
  return (
    state.pathEntry.exists ||
    state.registrations.length > 0 ||
    state.ref !== null ||
    state.worktreeHead !== null
  );
}

function partialOutcome(
  message: string,
  state: PartialState,
  original: CreationEvidence,
): Outcome {
  const evidence = `path=${original.path} ref=${original.ref} oid=${original.oid}`;
  return {
    status: 1,
    stdout: JSON.stringify({
      error: message,
      rollback: "rollback-incomplete",
      original,
      partialState: state,
    }),
    stderr: [
      `worktree-lifecycle-create: ${message}`,
      `worktree-lifecycle-create: rollback-incomplete; preserved current state; original ${evidence}`,
    ],
    createdReport: null,
  };
}

function cleanForCompensation(
  worktreePath: string,
): { ok: boolean; reason: string | null } {
  const status = git(worktreePath, [
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
  if (!status.ok) {
    return { ok: false, reason: status.stderr || "git status failed" };
  }
  const entries = status.stdout.split("\0").filter(Boolean);
  const changes = entries.filter(
    (entry) => !entry.startsWith("# ") && !entry.startsWith("! "),
  );
  const nonDisposableIgnored = entries
    .filter((entry) => entry.startsWith("! "))
    .map((entry) => entry.slice(2))
    .filter((entry) => !isDisposableIgnoredPath(entry));
  if (changes.length > 0 || nonDisposableIgnored.length > 0) {
    return {
      ok: false,
      reason: "worktree has non-disposable status state",
    };
  }
  const flags = git(worktreePath, ["ls-files", "-v", "-z"]);
  if (!flags.ok) {
    return { ok: false, reason: flags.stderr || "git index flag probe failed" };
  }
  if (
    flags.stdout
      .split("\0")
      .filter(Boolean)
      .some((entry) => /^[a-zS] /.test(entry))
  ) {
    return {
      ok: false,
      reason: "worktree has assume-unchanged or skip-worktree index flags",
    };
  }
  return { ok: true, reason: null };
}

function compensationProof(
  state: PartialState,
  branch: string,
  fullRef: string,
  createdOid: string,
): string | null {
  if (state.probeErrors.length > 0) return state.probeErrors.join("; ");
  if (!state.pathEntry.exists || state.pathEntry.kind !== "directory") {
    return "worktree path entry is not the created directory";
  }
  if (state.registrations.length !== 1) {
    return "expected exactly one literal worktree registration";
  }
  const registration = state.registrations[0]!;
  if (
    registration.branch !== branch ||
    registration.fullRef !== fullRef ||
    registration.head !== createdOid
  ) {
    return "registered worktree identity changed";
  }
  if (state.ref?.fullRef !== fullRef || state.ref.oid !== createdOid) {
    return "local ref identity changed";
  }
  if (state.worktreeHead !== createdOid) {
    return "worktree HEAD identity changed";
  }
  return null;
}

function compensate(
  root: string,
  branch: string,
  fullRef: string,
  worktreePath: string,
  createdOid: string,
  leases: WriterLease[],
  originalMessage: string,
  completedStatus = 1,
  completedStderr: string[] = [],
): Outcome {
  const original = {
    path: worktreePath,
    ref: fullRef,
    oid: createdOid,
  };
  try {
    heartbeatBoth(leases, "compensation proof");
  } catch (error) {
    const message =
      error instanceof Error ? `${originalMessage}; ${error.message}` : originalMessage;
    return partialOutcome(
      message,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }
  const before = probePartialState(root, worktreePath, fullRef);
  const proofError = compensationProof(
    before,
    branch,
    fullRef,
    createdOid,
  );
  if (proofError !== null) {
    return partialOutcome(
      `${originalMessage}; compensation refused: ${proofError}`,
      before,
      original,
    );
  }
  const clean = cleanForCompensation(worktreePath);
  if (!clean.ok) {
    return partialOutcome(
      `${originalMessage}; compensation refused: ${clean.reason}`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }

  const remove = git(root, ["worktree", "remove", worktreePath]);
  if (!remove.ok) {
    return partialOutcome(
      `${originalMessage}; worktree compensation failed: ${
        remove.stderr || "git worktree remove failed"
      }`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }
  try {
    heartbeatBoth(leases, "after worktree compensation");
  } catch (error) {
    return partialOutcome(
      `${originalMessage}; ${
        error instanceof Error ? error.message : "writer lease heartbeat failed"
      }`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }

  try {
    heartbeatBoth(leases, "before local ref compensation");
  } catch (error) {
    return partialOutcome(
      `${originalMessage}; ${
        error instanceof Error ? error.message : "writer lease heartbeat failed"
      }`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }
  const currentRef = git(root, ["show-ref", "--verify", "--hash", fullRef]);
  if (!currentRef.ok || currentRef.stdout.trim() !== createdOid) {
    return partialOutcome(
      `${originalMessage}; local ref moved before compare-delete`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }
  const currentDirectness = git(root, ["symbolic-ref", "-q", fullRef]);
  if (currentDirectness.status !== 1) {
    return partialOutcome(
      `${originalMessage}; local ref directness changed before compare-delete`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }
  const deleteRef = git(root, [
    "update-ref",
    "--no-deref",
    "-d",
    fullRef,
    createdOid,
  ]);
  if (!deleteRef.ok) {
    return partialOutcome(
      `${originalMessage}; local ref compensation failed: ${
        deleteRef.stderr || "git update-ref failed"
      }`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }
  try {
    heartbeatBoth(leases, "after local ref compensation");
  } catch (error) {
    return partialOutcome(
      `${originalMessage}; ${
        error instanceof Error ? error.message : "writer lease heartbeat failed"
      }`,
      probePartialState(root, worktreePath, fullRef),
      original,
    );
  }
  const finalState = probePartialState(root, worktreePath, fullRef);
  if (hasArtifacts(finalState) || finalState.probeErrors.length > 0) {
    return partialOutcome(
      `${originalMessage}; compensation postconditions failed`,
      finalState,
      original,
    );
  }
  return {
    status: completedStatus,
    stdout: null,
    stderr:
      completedStderr.length > 0
        ? completedStderr
        : [`worktree-lifecycle-create: ${originalMessage}`],
    createdReport: null,
  };
}

function recoverCreatedOid(
  state: PartialState,
  branch: string,
  fullRef: string,
): string | null {
  if (state.probeErrors.length > 0 || state.registrations.length !== 1) {
    return null;
  }
  const registration = state.registrations[0]!;
  const candidates = [
    registration.head,
    state.ref?.oid ?? "",
    state.worktreeHead ?? "",
  ];
  if (
    registration.branch !== branch ||
    registration.fullRef !== fullRef ||
    !candidates.every((candidate) => OID.test(candidate)) ||
    new Set(candidates).size !== 1
  ) {
    return null;
  }
  return candidates[0]!;
}

function observedCreationEvidence(
  state: PartialState,
  branch: string,
  fullRef: string,
  worktreePath: string,
): CreationEvidence {
  return {
    path: worktreePath,
    ref: fullRef,
    oid: recoverCreatedOid(state, branch, fullRef) ?? "unknown",
  };
}

function intendedRecord(
  options: ManagedCreateOptions,
  worktreePath: string,
  createdAt: string,
  exception: ManagedCreationException | null,
): JsonRecord {
  return {
    branch: options.branch,
    path: worktreePath,
    owner: options.owner,
    purpose: options.purpose,
    disposition: options.disposition,
    createdAt,
    ...(options.reason === null ? {} : { reason: options.reason }),
    ...(options.reviewAfter === null
      ? {}
      : { reviewAfter: options.reviewAfter }),
    ...(exception === null ? {} : { exception }),
  };
}

function buildFreshMetadata(
  bead: ExactBead,
  parsed: ParsedCoven,
  intended: JsonRecord,
  validException: ManagedCreationException | null,
): JsonRecord {
  let coven: JsonRecord;
  if (parsed.primary === null) {
    if (parsed.additional.length > 0) {
      throw new CliError("additional worktree metadata exists without a primary record");
    }
    coven = {
      ...parsed.raw,
      worktree: intended,
    };
  } else {
    if (validException === null) {
      throw new CliError(
        "a current worktree exception is required to append an additional record",
        2,
      );
    }
    const records = [parsed.primary, ...parsed.additional];
    if (
      records.some(
        (record) =>
          record.branch === intended.branch ||
          record.path === normalizeCandidate(intended.path as string),
      )
    ) {
      throw new CliError("intended worktree duplicates existing metadata");
    }
    const appended = {
      ...intended,
      exception: validException,
    };
    coven = {
      ...parsed.raw,
      worktree: parsed.primary.raw,
      worktrees: [
        ...parsed.additional.map((record) => record.raw),
        appended,
      ],
    };
  }
  return {
    ...bead.metadata,
    coven,
  };
}

function intendedRecordState(
  bead: ExactBead,
  intended: JsonRecord,
  root: string,
): "exact" | "absent" | "different" {
  let parsed: ParsedCoven;
  try {
    parsed = parseCoven(bead.metadata, root);
  } catch {
    return "different";
  }
  const records = [
    ...(parsed.primary ? [parsed.primary] : []),
    ...parsed.additional,
  ];
  const intendedPath = normalizeCandidate(intended.path as string);
  const identityMatches = records.filter(
    (record) =>
      record.branch === intended.branch ||
      record.path === intendedPath,
  );
  const exactMatches = records.filter((record) =>
    isDeepStrictEqual(record.raw, intended),
  );
  if (exactMatches.length === 1 && identityMatches.length === 1) return "exact";
  if (exactMatches.length === 0 && identityMatches.length === 0) return "absent";
  return "different";
}

function expectedMetadataPreserved(
  actual: JsonRecord,
  expected: JsonRecord,
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "coven") continue;
    if (
      !Object.prototype.hasOwnProperty.call(actual, key) ||
      !isDeepStrictEqual(actual[key], value)
    ) {
      return false;
    }
  }
  const expectedCoven = expected.coven;
  if (!isRecord(expectedCoven)) return expectedCoven === actual.coven;
  if (!isRecord(actual.coven)) return false;
  for (const [key, value] of Object.entries(expectedCoven)) {
    if (
      !Object.prototype.hasOwnProperty.call(actual.coven, key) ||
      !isDeepStrictEqual(actual.coven[key], value)
    ) {
      return false;
    }
  }
  return true;
}

function execute(
  options: ManagedCreateOptions,
  leases: WriterLease[],
): Outcome {
  const root = realpathSync(path.resolve(options.root));
  const { fullRef, worktreePath } = validateBranchAndPath(root, options.branch);
  assertRefAndPathAbsent(root, fullRef, worktreePath);

  const purpose = `beads:worktrees:create for Bead ${options.beadId}`;
  const global = registerIntent({
    writerId: "worktree-create",
    purpose,
    repoDir: root,
    ttlMs: INTENT_TTL_MS,
  });
  if (!global.ok) {
    throw new CliError(`global writer intent failed: ${global.reason}`);
  }
  leases.push(global.lease as WriterLease);
  const specific = registerIntent({
    writerId: `worktree-create:${options.beadId}`,
    purpose,
    repoDir: root,
    ttlMs: INTENT_TTL_MS,
  });
  if (!specific.ok) {
    throw new CliError(`Bead writer intent failed: ${specific.reason}`);
  }
  leases.push(specific.lease as WriterLease);

  const initialBead = loadExactBead(root, options.beadId);
  const initialCoven = parseCoven(initialBead.metadata, root);
  heartbeatBoth(leases, "after initial Bead read");
  const initialNowMs = Date.now();
  const initialException =
    options.exception ??
    exceptionForPath(initialCoven, worktreePath, initialNowMs);
  const localPreflight = assessLocalRefusalPreflight(
    root,
    options.beadId,
    initialCoven,
    worktreePath,
    initialException,
    initialNowMs,
  );
  const initialRecords = [
    ...(initialCoven.primary ? [initialCoven.primary] : []),
    ...initialCoven.additional,
  ];
  if (
    initialRecords.some(
      (record) =>
        record.branch === options.branch ||
        normalizeCandidate(record.path) === normalizeCandidate(worktreePath),
    )
  ) {
    throw new CliError("intended worktree duplicates existing metadata");
  }
  const requiresCurrentException =
    initialCoven.primary !== null && initialException === null;
  const primaryRegistrationMissing =
    initialCoven.primary !== null &&
    !localPreflight.registeredPaths.has(
      canonicalExistingCandidate(initialCoven.primary.path),
    );

  const inventory = collectWorktreeLifecycleInventory({
    repo: REPOSITORY,
    root,
    nowMs: Date.now(),
  });
  heartbeatBoth(leases, "after lifecycle inventory");
  // Global failures still abort: if GitHub was unreachable or the canonical
  // repository could not be resolved, the run did not see the repository at all
  // and no admission decision it makes is trustworthy. Per-unit probe errors do
  // not abort — see {@link inventoryErrors} — and neither do malformed metadata
  // records describing some other unit; see {@link claimErrorsForRequest}.
  const errors = [
    ...inventory.globalErrors,
    ...inventoryErrors(inventory.items),
    ...claimErrorsForRequest(inventory.metadataClaimErrors, options.branch, worktreePath),
  ];
  if (errors.length > 0) {
    throw new CliError(`lifecycle inventory is incomplete: ${errors.join("; ")}`);
  }
  // A local admission preflight can identify a refusal cheaply, but it cannot
  // replace the complete inventory. Check the inventory first so an outage
  // remains an exit-1 error rather than advertising an exception that cannot
  // reach admission.
  if (!localPreflight.assessment.allowed) {
    return refusalOutcome(
      localPreflight.assessment.reasons,
      exceptionSuggestion(options, worktreePath),
    );
  }
  if (requiresCurrentException) {
    return refusalOutcome(
      [
        `Bead ${options.beadId} already has structured worktree metadata; a current worktree exception is required to append another record`,
      ],
      exceptionSuggestion(options, worktreePath),
      false,
    );
  }
  if (primaryRegistrationMissing) {
    return refusalOutcome(
      [`Bead ${options.beadId} primary structured worktree metadata is not currently registered`],
      [],
      false,
    );
  }
  const existingPaths = existingOwnedPaths(inventory.items, options.beadId);

  const admissionBead = loadExactBead(root, options.beadId);
  heartbeatBoth(leases, "after admission Bead reread");
  const admissionCoven = parseCoven(admissionBead.metadata, root);
  const admissionException =
    options.exception ??
    exceptionForPath(admissionCoven, worktreePath, Date.now());
  const assessment = assessManagedWorktreeCreation({
    beadId: options.beadId,
    requestedPath: worktreePath,
    nowMs: Date.now(),
    existingPaths,
    budgets: inventory.budgets,
    exception: exceptionForAssessment(admissionException),
  });
  if (!assessment.allowed) {
    return refusalOutcome(assessment.reasons, exceptionSuggestion(options, worktreePath));
  }

  assertRefAndPathAbsent(root, fullRef, worktreePath);
  heartbeatBoth(leases, "before git worktree add");
  const add = git(root, [
    "worktree",
    "add",
    "-b",
    options.branch,
    worktreePath,
    options.startPoint,
  ]);
  let addHeartbeatError: string | null = null;
  try {
    heartbeatBoth(leases, "after git worktree add");
  } catch (error) {
    addHeartbeatError =
      error instanceof Error ? error.message : "writer lease heartbeat failed";
  }
  if (!add.ok) {
    const state = probePartialState(root, worktreePath, fullRef);
    const message = add.stderr || "git worktree add failed";
    if (hasArtifacts(state) || state.probeErrors.length > 0) {
      return partialOutcome(
        `${message}${addHeartbeatError ? `; ${addHeartbeatError}` : ""}`,
        state,
        observedCreationEvidence(
          state,
          options.branch,
          fullRef,
          worktreePath,
        ),
      );
    }
    return errorOutcome(message);
  }
  if (addHeartbeatError !== null) {
    const state = probePartialState(root, worktreePath, fullRef);
    return partialOutcome(
      addHeartbeatError,
      state,
      observedCreationEvidence(
        state,
        options.branch,
        fullRef,
        worktreePath,
      ),
    );
  }

  const refOid = git(root, [
    "rev-parse",
    "--verify",
    `${fullRef}^{commit}`,
  ]);
  const localHead = git(worktreePath, [
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]);
  if (
    !refOid.ok ||
    !localHead.ok ||
    !OID.test(refOid.stdout.trim()) ||
    refOid.stdout.trim() !== localHead.stdout.trim()
  ) {
    const state = probePartialState(root, worktreePath, fullRef);
    const recovered = recoverCreatedOid(state, options.branch, fullRef);
    const message = [
      refOid.stderr,
      localHead.stderr,
      "could not capture the exact created OID",
    ]
      .filter(Boolean)
      .join("; ");
    if (recovered === null) {
      return partialOutcome(
        message,
        state,
        observedCreationEvidence(
          state,
          options.branch,
          fullRef,
          worktreePath,
        ),
      );
    }
    return compensate(
      root,
      options.branch,
      fullRef,
      worktreePath,
      recovered,
      leases,
      message,
    );
  }
  const createdOid = refOid.stdout.trim();
  const capturedCreation: CreationEvidence = {
    path: worktreePath,
    ref: fullRef,
    oid: createdOid,
  };

  let persistenceBead: ExactBead;
  try {
    persistenceBead = loadExactBead(root, options.beadId);
    heartbeatBoth(leases, "after persistence Bead reread");
  } catch (error) {
    return compensate(
      root,
      options.branch,
      fullRef,
      worktreePath,
      createdOid,
      leases,
      error instanceof Error ? error.message : "just-in-time Bead reread failed",
    );
  }

  let persistenceCoven: ParsedCoven;
  let persistenceException: ManagedCreationException | null;
  try {
    persistenceCoven = parseCoven(persistenceBead.metadata, root);
    persistenceException =
      options.exception ??
      exceptionForPath(persistenceCoven, worktreePath, Date.now());
  } catch (error) {
    return compensate(
      root,
      options.branch,
      fullRef,
      worktreePath,
      createdOid,
      leases,
      error instanceof Error ? error.message : "fresh lifecycle metadata is malformed",
    );
  }
  const freshAssessment = assessManagedWorktreeCreation({
    beadId: options.beadId,
    requestedPath: worktreePath,
    nowMs: Date.now(),
    existingPaths,
    budgets: inventory.budgets as WorktreeLifecycleBudgets,
    exception: exceptionForAssessment(persistenceException),
  });
  if (!freshAssessment.allowed) {
    return compensate(
      root,
      options.branch,
      fullRef,
      worktreePath,
      createdOid,
      leases,
      freshAssessment.reasons.join("; "),
      2,
      [
        ...freshAssessment.reasons.map(
          (reason) => `worktree-lifecycle-create: ${reason}`,
        ),
        // Same gate as refusalOutcome (cave-wmkn4): never advertise a command
        // the maintenance planes make unrunnable. This is the compensate path —
        // a refusal found AFTER the worktree was created — so it reaches the
        // user in exactly the situation where a dead next step is most costly.
        ...maintenanceSuggestion(),
        ...exceptionSuggestion(options, worktreePath),
      ],
    );
  }

  const createdAt = new Date().toISOString();
  const intended = intendedRecord(
    options,
    worktreePath,
    createdAt,
    persistenceCoven.primary === null
      ? options.exception
      : persistenceException,
  );
  let completeMetadata: JsonRecord;
  try {
    completeMetadata = buildFreshMetadata(
      persistenceBead,
      persistenceCoven,
      intended,
      persistenceException,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "could not build fresh lifecycle metadata";
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    return compensate(
      root,
      options.branch,
      fullRef,
      worktreePath,
      createdOid,
      leases,
      message,
      exitCode,
      exitCode === 2
        ? [
            `worktree-lifecycle-create: ${message}`,
            // Gated for the same reason as above. `includeRetireByHand` is
            // false here: this is compensate's generic exit-2 message, which
            // covers refusals that are not about the worktree budget, and
            // retire-by-hand advice is only a remedy for the budget ones.
            ...maintenanceSuggestion(undefined, false),
          ]
        : [],
    );
  }

  heartbeatBoth(leases, "before Beads persistence");
  const update = command(
    "bd",
    [
      "update",
      options.beadId,
      "--metadata",
      JSON.stringify({ coven: completeMetadata.coven }),
      "--json",
    ],
    root,
  );
  let updateHeartbeatError: string | null = null;
  try {
    heartbeatBoth(leases, "after Beads persistence");
  } catch (error) {
    updateHeartbeatError =
      error instanceof Error ? error.message : "writer lease heartbeat failed";
  }
  const report: CreatedReport = {
    beadId: options.beadId,
    branch: options.branch,
    fullRef,
    path: worktreePath,
    head: createdOid,
    metadata: completeMetadata,
  };
  if (update.ok) {
    let verification: ExactBead;
    try {
      verification = loadExactBead(root, options.beadId);
    } catch (error) {
      return partialOutcome(
        `persistence-verification warning: bd update reported success but the exact Bead reread failed: ${
          error instanceof Error ? error.message : "bd show failed"
        }${updateHeartbeatError ? `; ${updateHeartbeatError}` : ""}`,
        probePartialState(root, worktreePath, fullRef),
        capturedCreation,
      );
    }
    let verificationHeartbeatError: string | null = null;
    try {
      heartbeatBoth(leases, "after successful persistence verification read");
    } catch (error) {
      verificationHeartbeatError =
        error instanceof Error ? error.message : "writer lease heartbeat failed";
    }
    const recordState = intendedRecordState(verification, intended, root);
    const metadataPreserved = expectedMetadataPreserved(
      verification.metadata,
      completeMetadata,
    );
    const heartbeatWarning =
      updateHeartbeatError ?? verificationHeartbeatError;
    if (recordState !== "exact" || !metadataPreserved) {
      return partialOutcome(
        `persistence-verification warning: bd update reported success but the intended record was ${recordState} and expected fresh metadata was ${
          metadataPreserved ? "preserved" : "not preserved"
        }${heartbeatWarning ? `; ${heartbeatWarning}` : ""}`,
        probePartialState(root, worktreePath, fullRef),
        capturedCreation,
      );
    }
    if (heartbeatWarning !== null) {
      return createdOutcome(
        {
          ...report,
          metadata: verification.metadata,
          warning: `persistence-verification warning: ${heartbeatWarning}`,
        },
        1,
        [`persistence-verification warning: ${heartbeatWarning}`],
      );
    }
    return createdOutcome({
      ...report,
      metadata: verification.metadata,
    });
  }

  let verification: ExactBead;
  try {
    verification = loadExactBead(root, options.beadId);
  } catch (error) {
    return partialOutcome(
      `${
        update.stderr || "Beads persistence failed"
      }; persistence unverifiable: ${
        error instanceof Error ? error.message : "bd show failed"
      }`,
      probePartialState(root, worktreePath, fullRef),
      capturedCreation,
    );
  }
  let verificationHeartbeatError: string | null = null;
  try {
    heartbeatBoth(leases, "after failed persistence verification read");
  } catch (error) {
    verificationHeartbeatError =
      error instanceof Error ? error.message : "writer lease heartbeat failed";
  }
  const recordState = intendedRecordState(verification, intended, root);
  const completeMetadataPreserved = expectedMetadataPreserved(
    verification.metadata,
    completeMetadata,
  );
  if (recordState === "exact" && completeMetadataPreserved) {
    const warning = [
      `persistence warning: bd update reported failure after the intended record landed: ${
        update.stderr || "unknown error"
      }`,
      verificationHeartbeatError,
    ]
      .filter(Boolean)
      .join("; ");
    return createdOutcome(
      {
        ...report,
        metadata: verification.metadata,
        warning,
      },
      1,
      [warning],
    );
  }
  const leaseError = updateHeartbeatError ?? verificationHeartbeatError;
  const unchangedFromFreshSnapshot = isDeepStrictEqual(
    verification.metadata,
    persistenceBead.metadata,
  );
  if (
    leaseError !== null ||
    recordState === "different" ||
    (recordState === "exact" && !completeMetadataPreserved) ||
    (recordState === "absent" && !unchangedFromFreshSnapshot)
  ) {
    return partialOutcome(
      `${
        update.stderr || "Beads persistence failed"
      }; persistence verification is uncertain: intended record ${recordState}, expected metadata ${
        recordState === "absent"
          ? unchangedFromFreshSnapshot
            ? "unchanged"
            : "changed"
          : completeMetadataPreserved
            ? "preserved"
            : "not preserved"
      }${leaseError ? `; ${leaseError}` : ""}`,
      probePartialState(root, worktreePath, fullRef),
      capturedCreation,
    );
  }
  return compensate(
    root,
    options.branch,
    fullRef,
    worktreePath,
    createdOid,
    leases,
    update.stderr || "Beads persistence failed",
  );
}

function render(outcome: Outcome): never {
  if (outcome.stdout !== null) process.stdout.write(`${outcome.stdout}\n`);
  if (outcome.stderr.length > 0) {
    process.stderr.write(`${outcome.stderr.join("\n")}\n`);
  }
  process.exit(outcome.status);
}

function main(): never {
  const leases: WriterLease[] = [];
  let outcome: Outcome;
  try {
    outcome = execute(parseArgs(process.argv.slice(2)), leases);
  } catch (error) {
    if (error instanceof CliError) {
      outcome = {
        ...errorOutcome(error.message),
        status: error.exitCode,
      };
    } else {
      outcome = errorOutcome(
        error instanceof Error ? error.message : "unexpected creator failure",
      );
    }
  } finally {
    // Release is handled below so a created-state outcome remains available.
  }

  const releaseFailures: string[] = [];
  for (const lease of [...leases].reverse()) {
    const released = releaseWriterIntent(lease);
    if (!released.ok) {
      releaseFailures.push(`${lease.writerId}: ${released.reason}`);
    }
  }
  if (releaseFailures.length > 0) {
    const warning = `writer intent release failed: ${releaseFailures.join(", ")}`;
    outcome.status = 1;
    outcome.stderr.push(`worktree-lifecycle-create: ${warning}`);
    if (outcome.createdReport !== null) {
      outcome.createdReport.warning = outcome.createdReport.warning
        ? `${outcome.createdReport.warning}; ${warning}`
        : warning;
      outcome.stdout = JSON.stringify(outcome.createdReport);
    }
  }
  return render(outcome);
}

main();
