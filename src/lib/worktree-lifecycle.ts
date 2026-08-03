import {
  isAbsolute,
  normalize as normalizePath,
  parse as parsePath,
  sep as pathSeparator,
} from "node:path";

export type WorktreeLifecycleLane =
  | "active"
  | "recovery"
  | "cooldown"
  | "retire-after-gate"
  | "uncertain"
  | "protected";

export type LifecycleUnitKind = "worktree" | "branch-only";
export type LifecycleDisposition = "active" | "pr" | "recovery" | "archive";

export type WorktreeProcessOwner = {
  pid: number;
  command: string;
};

export type WorktreePrRef = {
  number: number;
  url: string;
};

export type WorktreeMergedPrRef = WorktreePrRef & {
  headOid: string;
};

export type ManagedCreationException = {
  owner: string;
  reason: string;
  expiresAt: string;
  additionalPaths: string[];
};

export type WorktreeLifecycleMetadata = {
  beadId: string;
  owner: string;
  purpose: string;
  disposition: LifecycleDisposition;
  createdAt: string;
  reason?: string;
  reviewAfter?: string;
  exception?: ManagedCreationException | null;
};

export type WorktreeRemoteRef = {
  ref: string;
  oid: string;
};

export type WorktreeLifecycleObservation = {
  kind: LifecycleUnitKind;
  path: string | null;
  ref: string | null;
  branch: string | null;
  head: string;
  isPrimary: boolean;
  protectedBranch: boolean;
  changes: string[];
  ignoredPaths: string[];
  nonDisposableIgnoredPaths: string[];
  indexFlags: string[];
  processOwners: WorktreeProcessOwner[];
  claimOwners: string[];
  taskIds: string[];
  openPrs: WorktreePrRef[];
  mergedPr: WorktreeMergedPrRef | null;
  activeWorkflowUrls: string[];
  headOnDefaultBranch: boolean;
  remoteRefsContainingHead: string[];
  updatedAtMs: number | null;
  probeErrors: string[];
  metadata: WorktreeLifecycleMetadata | null;
  metadataErrors: string[];
  remoteRef: WorktreeRemoteRef | null;
  sessionIds: string[];
};

type LegacyWorktreeObservation = Pick<
  WorktreeLifecycleObservation,
  | "branch"
  | "head"
  | "isPrimary"
  | "protectedBranch"
  | "changes"
  | "ignoredPaths"
  | "nonDisposableIgnoredPaths"
  | "indexFlags"
  | "processOwners"
  | "claimOwners"
  | "taskIds"
  | "openPrs"
  | "mergedPr"
  | "activeWorkflowUrls"
  | "headOnDefaultBranch"
  | "remoteRefsContainingHead"
  | "updatedAtMs"
  | "probeErrors"
> & {
  path: string;
};

type WorktreeObservationCompatibilityFields = Partial<
  Pick<
    WorktreeLifecycleObservation,
    "kind" | "ref" | "metadata" | "metadataErrors" | "remoteRef" | "sessionIds"
  >
>;

export type WorktreeObservation = LegacyWorktreeObservation &
  WorktreeObservationCompatibilityFields;

export type WorktreeLifecycleItem = WorktreeLifecycleObservation & {
  lane: WorktreeLifecycleLane;
  reasons: string[];
};

export type WorktreeLifecycleSummary = {
  items: WorktreeLifecycleItem[];
  counts: Record<WorktreeLifecycleLane, number>;
  budgets: WorktreeLifecycleBudgets;
};

export type WorktreeLifecycleRenderOptions = {
  includeFooter?: boolean;
};

// These thresholds serve two surfaces with deliberately different arithmetic.
// The patrol reports `exceeded` as `count > budget` — "the repository is over
// its budget right now". Managed creation refuses at `count >= budget`, because
// one more unit is what would take it over. So at exactly the budget the patrol
// reports nothing while creation is refused; that is the intended reading of
// "creating a worktree WOULD exceed", not an off-by-one.
//
// For the patrol the number is advisory, which is what "warning" names. For
// creation it is a hard refusal, so the refusal text in
// {@link assessManagedWorktreeCreation} deliberately does not call it a warning.
export const WORKTREE_WARNING_BUDGET = 12;
export const BRANCH_WARNING_BUDGET = 30;

export type WorktreeLifecycleBudgets = {
  worktrees: {
    count: number;
    warning: typeof WORKTREE_WARNING_BUDGET;
    exceeded: boolean;
  };
  branches: {
    count: number;
    warning: typeof BRANCH_WARNING_BUDGET;
    exceeded: boolean;
  };
  exceptions: {
    active: number;
    expired: number;
  };
};

export const RETIREMENT_COOLDOWN_MS = 8 * 60 * 60 * 1000;
const RECOVERY_BRANCH = /^(?:backup|archive|rescue)\//i;
const WIP_BRANCH = /(?:^|[/-])wip(?:$|[/-])/i;
const DISPOSABLE_IGNORED_ROOTS = [
  ".next",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "public/sandbox",
  "src-tauri/gen",
  "src-tauri/resources",
  "src-tauri/target",
  "target",
  "test-results",
];
const HUMAN_LANE_LABELS: Record<WorktreeLifecycleLane, string> = {
  active: "active",
  recovery: "recovery",
  cooldown: "cooldown",
  "retire-after-gate": "cleanup-ready",
  uncertain: "uncertain",
  protected: "protected",
};

export function isDisposableIgnoredPath(candidate: string): boolean {
  const platformPath = pathSeparator === "\\" ? candidate.replace(/\\/g, "/") : candidate;
  const normalized = platformPath.replace(/^\.\/|\/+$/g, "");
  if (
    normalized === ".DS_Store" ||
    normalized === "next-env.d.ts" ||
    normalized.endsWith(".tsbuildinfo")
  ) {
    return true;
  }
  return DISPOSABLE_IGNORED_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

function activeReasons(observation: WorktreeLifecycleObservation): string[] {
  const reasons: string[] = [];
  if (observation.changes.length > 0) {
    reasons.push(
      `${observation.changes.length} tracked or untracked change${
        observation.changes.length === 1 ? "" : "s"
      }`,
    );
  }
  if (observation.nonDisposableIgnoredPaths.length > 0) {
    reasons.push(
      `${observation.nonDisposableIgnoredPaths.length} non-disposable ignored path${
        observation.nonDisposableIgnoredPaths.length === 1 ? "" : "s"
      }`,
    );
  }
  if (observation.indexFlags.length > 0) {
    reasons.push(`${observation.indexFlags.length} assume-unchanged or skip-worktree index flag(s)`);
  }
  if (observation.processOwners.length > 0) {
    const owners = observation.processOwners
      .slice(0, 3)
      .map((owner) => `pid ${owner.pid} (${owner.command || "unknown"})`)
      .join(", ");
    reasons.push(`live process cwd: ${owners}`);
  }
  if (observation.claimOwners.length > 0) {
    reasons.push(`active claim: ${observation.claimOwners.join(", ")}`);
  }
  if (observation.taskIds.length > 0) {
    reasons.push(`non-closed Beads: ${observation.taskIds.join(", ")}`);
  }
  if (observation.openPrs.length > 0) {
    reasons.push(`open PR ${observation.openPrs.map((pr) => `#${pr.number}`).join(", ")}`);
  }
  if (observation.activeWorkflowUrls.length > 0) {
    reasons.push(`${observation.activeWorkflowUrls.length} active workflow run(s)`);
  }
  if (observation.sessionIds.length > 0) {
    reasons.push(`active session: ${observation.sessionIds.join(", ")}`);
  }
  return reasons;
}

function reviewAfterReasons(metadata: WorktreeLifecycleMetadata, nowMs: number): string[] {
  const { reviewAfter } = metadata;
  if (!reviewAfter) return [];
  const reviewAfterMs = Date.parse(reviewAfter);
  if (!Number.isFinite(reviewAfterMs) || reviewAfterMs >= nowMs) return [];
  return [`owner follow-up: ${metadata.owner} reviewAfter ${reviewAfter} is overdue`];
}

export function normalizeAbsoluteWorktreePath(
  candidate: string | null | undefined,
): string | null {
  if (typeof candidate !== "string" || candidate.includes("\0")) return null;
  if (candidate.length === 0 || !isAbsolute(candidate)) return null;
  try {
    let normalized = normalizePath(candidate);
    if (normalized.length === 0 || !isAbsolute(normalized)) return null;
    const root = parsePath(normalized).root;
    while (normalized.length > root.length && normalized.endsWith(pathSeparator)) {
      normalized = normalized.slice(0, -pathSeparator.length);
    }
    return normalized;
  } catch {
    return null;
  }
}

function applicableManagedCreationException({
  exception,
  requestedPath,
  nowMs,
}: {
  exception?: ManagedCreationException | null;
  requestedPath: string | null;
  nowMs: number;
}): ManagedCreationException | null {
  if (!exception) return null;
  if (exception.owner.trim().length === 0 || exception.reason.trim().length === 0) {
    return null;
  }
  const expiresAtMs = Date.parse(exception.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null;
  const normalizedRequestedPath = normalizeAbsoluteWorktreePath(requestedPath);
  if (normalizedRequestedPath === null) return null;
  return exception.additionalPaths.some(
    (additionalPath) =>
      normalizeAbsoluteWorktreePath(additionalPath) === normalizedRequestedPath,
  )
    ? exception
    : null;
}

function managedCreationExceptionReasons(exception: ManagedCreationException): string[] {
  return [`owner exception active until ${exception.expiresAt}: ${exception.owner} — ${exception.reason}`];
}

function recoveryDispositionReasons(
  metadata: WorktreeLifecycleMetadata,
  nowMs: number,
): string[] {
  const reasons = [`lifecycle disposition ${metadata.disposition} requires preservation inventory`];
  if (metadata.reason) reasons.push(`metadata note: ${metadata.reason}`);
  return [...reasons, ...reviewAfterReasons(metadata, nowMs)];
}

function metadataBackfillReason(): string {
  return "structured lifecycle metadata backfill required before automated retirement can proceed";
}

function withReasons(item: WorktreeLifecycleObservation, lane: WorktreeLifecycleLane, reasons: string[]) {
  return {
    ...item,
    lane,
    reasons,
  };
}

function divergentRemoteRefReason(remoteRef: WorktreeRemoteRef): string {
  return `same-named remote ref ${remoteRef.ref} diverges from local HEAD`;
}

type ClassifyLifecycleUnitOptions = {
  allowLegacyMissingMetadata: boolean;
};

function classifyLifecycleUnitInternal(
  observation: WorktreeLifecycleObservation,
  nowMs: number,
  options: ClassifyLifecycleUnitOptions,
): WorktreeLifecycleItem {
  if (observation.isPrimary || observation.protectedBranch) {
    return withReasons(observation, "protected", [
      observation.isPrimary ? "primary checkout" : "protected branch",
    ]);
  }

  const live = activeReasons(observation);
  if (live.length > 0) {
    return withReasons(observation, "active", [
      ...live,
      ...observation.probeErrors.map((error) => `probe warning: ${error}`),
    ]);
  }

  if (observation.probeErrors.length > 0) {
    return withReasons(observation, "uncertain", observation.probeErrors);
  }

  if (observation.metadataErrors.length > 0) {
    return withReasons(observation, "uncertain", observation.metadataErrors);
  }

  const legacyMissingMetadata = options.allowLegacyMissingMetadata && observation.metadata === null;
  if (!observation.metadata) {
    if (legacyMissingMetadata) {
      return classifyLifecycleUnitWithoutMetadata(observation, nowMs);
    }
    return withReasons(observation, "uncertain", [metadataBackfillReason()]);
  }

  if (!observation.branch) {
    return withReasons(observation, "recovery", [
      "detached HEAD",
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  if (RECOVERY_BRANCH.test(observation.branch) || WIP_BRANCH.test(observation.branch)) {
    return withReasons(observation, "recovery", [
      "branch name identifies a recovery or WIP snapshot",
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  if (
    observation.metadata.disposition === "recovery" ||
    observation.metadata.disposition === "archive"
  ) {
    return withReasons(
      observation,
      "recovery",
      recoveryDispositionReasons(observation.metadata, nowMs),
    );
  }

  if (observation.mergedPr && observation.mergedPr.headOid !== observation.head) {
    return withReasons(observation, "recovery", [
      `local HEAD does not match merged PR #${observation.mergedPr.number} head`,
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  const landed = observation.headOnDefaultBranch || observation.mergedPr !== null;
  if (!landed) {
    return withReasons(observation, "recovery", [
      "HEAD is not proven landed on the default branch or an exact merged PR",
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  const activeException = applicableManagedCreationException({
    exception: observation.metadata.exception,
    requestedPath: observation.path,
    nowMs,
  });
  if (activeException) {
    return withReasons(observation, "active", managedCreationExceptionReasons(activeException));
  }

  if (observation.remoteRef && observation.remoteRef.oid !== observation.head) {
    return withReasons(observation, "recovery", [
      divergentRemoteRefReason(observation.remoteRef),
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  if (observation.updatedAtMs === null || !Number.isFinite(observation.updatedAtMs)) {
    return withReasons(observation, "uncertain", [
      "branch/worktree recency is unavailable",
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  const ageMs = nowMs - observation.updatedAtMs;
  if (ageMs < RETIREMENT_COOLDOWN_MS) {
    return withReasons(observation, "cooldown", [
      "landed work remains inside the mandatory 8-hour cooldown",
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  return withReasons(observation, "retire-after-gate", [
    "clean landed work is older than 8 hours",
    "removal still requires the repository-wide maintenance gate and final deletion proof",
    ...reviewAfterReasons(observation.metadata, nowMs),
  ]);
}

function classifyLifecycleUnitWithoutMetadata(
  observation: WorktreeLifecycleObservation,
  nowMs: number,
): WorktreeLifecycleItem {
  if (!observation.branch) {
    return withReasons(observation, "recovery", ["detached HEAD"]);
  }

  if (RECOVERY_BRANCH.test(observation.branch) || WIP_BRANCH.test(observation.branch)) {
    return withReasons(observation, "recovery", [
      "branch name identifies a recovery or WIP snapshot",
    ]);
  }

  if (observation.mergedPr && observation.mergedPr.headOid !== observation.head) {
    return withReasons(observation, "recovery", [
      `local HEAD does not match merged PR #${observation.mergedPr.number} head`,
    ]);
  }

  const landed = observation.headOnDefaultBranch || observation.mergedPr !== null;
  if (!landed) {
    return withReasons(observation, "recovery", [
      "HEAD is not proven landed on the default branch or an exact merged PR",
    ]);
  }

  if (observation.remoteRef && observation.remoteRef.oid !== observation.head) {
    return withReasons(observation, "recovery", [divergentRemoteRefReason(observation.remoteRef)]);
  }

  if (observation.updatedAtMs === null || !Number.isFinite(observation.updatedAtMs)) {
    return withReasons(observation, "uncertain", ["branch/worktree recency is unavailable"]);
  }

  const ageMs = nowMs - observation.updatedAtMs;
  if (ageMs < RETIREMENT_COOLDOWN_MS) {
    return withReasons(observation, "cooldown", [
      "landed work remains inside the mandatory 8-hour cooldown",
    ]);
  }

  return withReasons(observation, "retire-after-gate", [
    "clean landed work is older than 8 hours",
    "removal still requires the repository-wide maintenance gate and final deletion proof",
  ]);
}

export function classifyLifecycleUnit(
  observation: WorktreeLifecycleObservation,
  nowMs = Date.now(),
): WorktreeLifecycleItem {
  return classifyLifecycleUnitInternal(observation, nowMs, {
    allowLegacyMissingMetadata: false,
  });
}

function normalizeLegacyRef(branch: string | null, ref: string | null | undefined): string | null {
  return ref ?? (branch ? `refs/heads/${branch}` : null);
}

function hasOwnProperty(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeWorktreeObservation(
  observation: WorktreeObservation,
): {
  observation: WorktreeLifecycleObservation;
  allowLegacyMissingMetadata: boolean;
} {
  const allowLegacyMissingMetadata = !hasOwnProperty(observation, "metadata");
  return {
    allowLegacyMissingMetadata,
    observation: {
      kind: observation.kind ?? "worktree",
      path: observation.path,
      ref: normalizeLegacyRef(observation.branch, observation.ref),
      branch: observation.branch,
      head: observation.head,
      isPrimary: observation.isPrimary,
      protectedBranch: observation.protectedBranch,
      changes: observation.changes,
      ignoredPaths: observation.ignoredPaths,
      nonDisposableIgnoredPaths: observation.nonDisposableIgnoredPaths,
      indexFlags: observation.indexFlags,
      processOwners: observation.processOwners,
      claimOwners: observation.claimOwners,
      taskIds: observation.taskIds,
      openPrs: observation.openPrs,
      mergedPr: observation.mergedPr,
      activeWorkflowUrls: observation.activeWorkflowUrls,
      headOnDefaultBranch: observation.headOnDefaultBranch,
      remoteRefsContainingHead: observation.remoteRefsContainingHead,
      updatedAtMs: observation.updatedAtMs,
      probeErrors: observation.probeErrors,
      metadata: observation.metadata ?? null,
      metadataErrors: observation.metadataErrors ?? [],
      remoteRef: observation.remoteRef ?? null,
      sessionIds: observation.sessionIds ?? [],
    },
  };
}

export function classifyWorktree(
  observation: WorktreeObservation,
  nowMs = Date.now(),
): WorktreeLifecycleItem {
  const normalized = normalizeWorktreeObservation(observation);
  return classifyLifecycleUnitInternal(normalized.observation, nowMs, {
    allowLegacyMissingMetadata: normalized.allowLegacyMissingMetadata,
  });
}

const LANE_ORDER: WorktreeLifecycleLane[] = [
  "active",
  "recovery",
  "cooldown",
  "retire-after-gate",
  "uncertain",
  "protected",
];

export function summarizeWorktreeLifecycle(
  items: WorktreeLifecycleItem[],
  budgets: WorktreeLifecycleBudgets,
): WorktreeLifecycleSummary {
  const counts = Object.fromEntries(LANE_ORDER.map((lane) => [lane, 0])) as Record<
    WorktreeLifecycleLane,
    number
  >;
  for (const item of items) counts[item.lane] += 1;
  return { items, counts, budgets };
}

function assertNonnegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
}

export function calculateLifecycleBudgets({
  worktreeCount,
  branchCount,
  activeExceptions,
  expiredExceptions,
}: {
  worktreeCount: number;
  branchCount: number;
  activeExceptions: number;
  expiredExceptions: number;
}): WorktreeLifecycleBudgets {
  assertNonnegativeInteger("worktreeCount", worktreeCount);
  assertNonnegativeInteger("branchCount", branchCount);
  assertNonnegativeInteger("activeExceptions", activeExceptions);
  assertNonnegativeInteger("expiredExceptions", expiredExceptions);

  return {
    worktrees: {
      count: worktreeCount,
      warning: WORKTREE_WARNING_BUDGET,
      exceeded: worktreeCount > WORKTREE_WARNING_BUDGET,
    },
    branches: {
      count: branchCount,
      warning: BRANCH_WARNING_BUDGET,
      exceeded: branchCount > BRANCH_WARNING_BUDGET,
    },
    exceptions: {
      active: activeExceptions,
      expired: expiredExceptions,
    },
  };
}

/**
 * Every reason this returns is lifted by a valid exception — each one is guarded
 * on `!validException` below. Callers may therefore present the `--exception-*`
 * invocation as a real remedy for any refusal from here, which is not true of
 * refusals assembled elsewhere.
 */
export function assessManagedWorktreeCreation({
  beadId,
  requestedPath,
  nowMs,
  existingPaths,
  budgets,
  exception,
}: {
  beadId: string;
  requestedPath: string;
  nowMs: number;
  existingPaths: string[];
  budgets: WorktreeLifecycleBudgets;
  exception?: ManagedCreationException | null;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const validException = applicableManagedCreationException({ exception, requestedPath, nowMs });

  if (existingPaths.length > 0 && !validException) {
    reasons.push(`active Bead ${beadId} already owns a registered worktree`);
  }
  if (!validException && budgets.worktrees.count >= budgets.worktrees.warning) {
    reasons.push(
      `creating a worktree would exceed the ${WORKTREE_WARNING_BUDGET}-worktree budget`,
    );
  }
  if (!validException && budgets.branches.count >= budgets.branches.warning) {
    reasons.push(
      `creating a branch would exceed the ${BRANCH_WARNING_BUDGET}-local-branch budget`,
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

function labelFor(item: WorktreeLifecycleItem): string {
  return item.branch ?? item.ref ?? "(detached)";
}

function humanReason(item: WorktreeLifecycleItem, reason: string): string {
  if (
    item.lane === "recovery" &&
    reason.startsWith("owner follow-up:") &&
    reason.endsWith(" is overdue")
  ) {
    return `overdue recovery review: ${reason}`;
  }
  if (reason.startsWith("duplicate structured worktree metadata records for ")) {
    return `duplicate Bead ownership: ${reason}`;
  }
  return reason;
}

export function renderWorktreeLifecycleReport(
  summary: WorktreeLifecycleSummary,
  options: WorktreeLifecycleRenderOptions = {},
): string {
  const { includeFooter = true } = options;
  const { counts } = summary;
  const lines = [
    `Worktree lifecycle: ${summary.items.length} registered | ${counts.active} active | ${counts.recovery} recovery | ${counts.cooldown} cooldown | ${counts["retire-after-gate"]} cleanup-ready | ${counts.uncertain} uncertain | ${counts.protected} protected`,
    `Worktree budget: ${summary.budgets.worktrees.count}/${summary.budgets.worktrees.warning} (${summary.budgets.worktrees.exceeded ? "exceeded" : "within budget"})`,
    `Local branch budget: ${summary.budgets.branches.count}/${summary.budgets.branches.warning} (${summary.budgets.branches.exceeded ? "exceeded" : "within budget"})`,
    `Managed exceptions: ${summary.budgets.exceptions.active} active | ${summary.budgets.exceptions.expired} expired`,
  ];

  for (const lane of LANE_ORDER) {
    const items = summary.items.filter((item) => item.lane === lane);
    if (items.length === 0) continue;
    lines.push("", HUMAN_LANE_LABELS[lane]);
    for (const item of items) {
      const location = item.kind === "branch-only" || !item.path ? "" : ` @ ${item.path}`;
      const kind = item.kind === "branch-only" ? " [branch-only]" : "";
      lines.push(`- ${labelFor(item)}${kind}${location}`);
      for (const reason of item.reasons) lines.push(`  ${humanReason(item, reason)}`);
      for (const change of item.changes) lines.push(`  change: ${change}`);
      for (const ignoredPath of item.nonDisposableIgnoredPaths) {
        lines.push(`  non-disposable ignored: ${ignoredPath}`);
      }
      for (const indexFlag of item.indexFlags) lines.push(`  index flag: ${indexFlag}`);
    }
  }

  if (includeFooter) {
    lines.push("", "Report only. No worktree or branch was changed.");
  }
  return lines.join("\n");
}
