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
  exception?: ManagedCreationException;
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

export type WorktreeObservation = WorktreeLifecycleObservation;

export type WorktreeLifecycleItem = WorktreeLifecycleObservation & {
  lane: WorktreeLifecycleLane;
  reasons: string[];
};

export type WorktreeLifecycleSummary = {
  items: WorktreeLifecycleItem[];
  counts: Record<WorktreeLifecycleLane, number>;
};

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

const DAY_MS = 24 * 60 * 60 * 1000;
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
  const normalized = candidate.replace(/\\/g, "/").replace(/^\.\/|\/+$/g, "");
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

export function classifyLifecycleUnit(
  observation: WorktreeLifecycleObservation,
  nowMs = Date.now(),
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

  if (!observation.metadata) {
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

  if (observation.updatedAtMs === null || !Number.isFinite(observation.updatedAtMs)) {
    return withReasons(observation, "uncertain", [
      "branch/worktree recency is unavailable",
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  const ageMs = nowMs - observation.updatedAtMs;
  if (ageMs < DAY_MS) {
    return withReasons(observation, "cooldown", [
      "landed work remains inside the mandatory 24-hour cooldown",
      ...reviewAfterReasons(observation.metadata, nowMs),
    ]);
  }

  return withReasons(observation, "retire-after-gate", [
    "clean landed work is older than 24 hours",
    "removal still requires the repository-wide maintenance gate and final deletion proof",
    ...reviewAfterReasons(observation.metadata, nowMs),
  ]);
}

export const classifyWorktree = classifyLifecycleUnit;

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
): WorktreeLifecycleSummary {
  const counts = Object.fromEntries(LANE_ORDER.map((lane) => [lane, 0])) as Record<
    WorktreeLifecycleLane,
    number
  >;
  for (const item of items) counts[item.lane] += 1;
  return { items, counts };
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

function hasValidManagedCreationException({
  exception,
  requestedPath,
  nowMs,
}: {
  exception?: ManagedCreationException;
  requestedPath: string;
  nowMs: number;
}): boolean {
  if (!exception) return false;
  if (exception.owner.trim().length === 0 || exception.reason.trim().length === 0) {
    return false;
  }
  const expiresAtMs = Date.parse(exception.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return false;
  return exception.additionalPaths.includes(requestedPath);
}

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
  exception?: ManagedCreationException;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const validException = hasValidManagedCreationException({ exception, requestedPath, nowMs });

  if (existingPaths.length > 0 && !validException) {
    reasons.push(`active Bead ${beadId} already owns a registered worktree`);
  }
  if (budgets.worktrees.count >= budgets.worktrees.warning) {
    reasons.push(`creating a worktree would exceed the ${WORKTREE_WARNING_BUDGET}-worktree warning budget`);
  }
  if (budgets.branches.count >= budgets.branches.warning) {
    reasons.push(
      `creating a branch would exceed the ${BRANCH_WARNING_BUDGET}-local-branch warning budget`,
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

export function renderWorktreeLifecycleReport(summary: WorktreeLifecycleSummary): string {
  const { counts } = summary;
  const lines = [
    `Worktree lifecycle: ${summary.items.length} registered | ${counts.active} active | ${counts.recovery} recovery | ${counts.cooldown} cooldown | ${counts["retire-after-gate"]} cleanup-ready | ${counts.uncertain} uncertain | ${counts.protected} protected`,
    "Report only. No worktree or branch was changed.",
  ];

  for (const lane of LANE_ORDER) {
    const items = summary.items.filter((item) => item.lane === lane);
    if (items.length === 0) continue;
    lines.push("", HUMAN_LANE_LABELS[lane]);
    for (const item of items) {
      const location = item.kind === "branch-only" || !item.path ? "" : ` @ ${item.path}`;
      lines.push(`- ${labelFor(item)}${location}`);
      for (const reason of item.reasons) lines.push(`  ${reason}`);
      for (const change of item.changes) lines.push(`  change: ${change}`);
      for (const ignoredPath of item.nonDisposableIgnoredPaths) {
        lines.push(`  non-disposable ignored: ${ignoredPath}`);
      }
      for (const indexFlag of item.indexFlags) lines.push(`  index flag: ${indexFlag}`);
    }
  }

  return lines.join("\n");
}
