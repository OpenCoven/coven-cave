export type WorktreeLifecycleLane =
  | "active"
  | "recovery"
  | "cooldown"
  | "retire-after-gate"
  | "uncertain"
  | "protected";

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

export type WorktreeObservation = {
  path: string;
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
};

export type WorktreeLifecycleItem = WorktreeObservation & {
  lane: WorktreeLifecycleLane;
  reasons: string[];
};

export type WorktreeLifecycleSummary = {
  items: WorktreeLifecycleItem[];
  counts: Record<WorktreeLifecycleLane, number>;
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

function activeReasons(observation: WorktreeObservation): string[] {
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
  return reasons;
}

export function classifyWorktree(
  observation: WorktreeObservation,
  nowMs = Date.now(),
): WorktreeLifecycleItem {
  if (observation.isPrimary || observation.protectedBranch) {
    return {
      ...observation,
      lane: "protected",
      reasons: [observation.isPrimary ? "primary checkout" : "protected branch"],
    };
  }

  const live = activeReasons(observation);
  if (live.length > 0) {
    return {
      ...observation,
      lane: "active",
      reasons: [
        ...live,
        ...observation.probeErrors.map((error) => `probe warning: ${error}`),
      ],
    };
  }

  if (observation.probeErrors.length > 0) {
    return {
      ...observation,
      lane: "uncertain",
      reasons: observation.probeErrors,
    };
  }

  if (!observation.branch) {
    return { ...observation, lane: "recovery", reasons: ["detached HEAD"] };
  }

  if (RECOVERY_BRANCH.test(observation.branch) || WIP_BRANCH.test(observation.branch)) {
    return {
      ...observation,
      lane: "recovery",
      reasons: ["branch name identifies a recovery or WIP snapshot"],
    };
  }

  if (observation.mergedPr && observation.mergedPr.headOid !== observation.head) {
    return {
      ...observation,
      lane: "recovery",
      reasons: [
        `local HEAD does not match merged PR #${observation.mergedPr.number} head`,
      ],
    };
  }

  const landed = observation.headOnDefaultBranch || observation.mergedPr !== null;
  if (!landed) {
    return {
      ...observation,
      lane: "recovery",
      reasons: ["HEAD is not proven landed on the default branch or an exact merged PR"],
    };
  }

  if (observation.updatedAtMs === null || !Number.isFinite(observation.updatedAtMs)) {
    return {
      ...observation,
      lane: "uncertain",
      reasons: ["branch/worktree recency is unavailable"],
    };
  }

  const ageMs = nowMs - observation.updatedAtMs;
  if (ageMs < DAY_MS) {
    return {
      ...observation,
      lane: "cooldown",
      reasons: ["landed work remains inside the mandatory 24-hour cooldown"],
    };
  }

  return {
    ...observation,
    lane: "retire-after-gate",
    reasons: [
      "clean landed work is older than 24 hours",
      "removal still requires the repository-wide maintenance gate and final deletion proof",
    ],
  };
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
): WorktreeLifecycleSummary {
  const counts = Object.fromEntries(LANE_ORDER.map((lane) => [lane, 0])) as Record<
    WorktreeLifecycleLane,
    number
  >;
  for (const item of items) counts[item.lane] += 1;
  return { items, counts };
}

function labelFor(item: WorktreeLifecycleItem): string {
  return item.branch ?? "(detached)";
}

export function renderWorktreeLifecycleReport(summary: WorktreeLifecycleSummary): string {
  const { counts } = summary;
  const lines = [
    `Worktree lifecycle: ${summary.items.length} registered | ${counts.active} active | ${counts.recovery} recovery | ${counts.cooldown} cooldown | ${counts["retire-after-gate"]} retire after gate | ${counts.uncertain} uncertain`,
    "Report only. No worktree or branch was changed.",
  ];

  for (const lane of LANE_ORDER) {
    const items = summary.items.filter((item) => item.lane === lane);
    if (items.length === 0) continue;
    lines.push("", lane);
    for (const item of items) {
      lines.push(`- ${labelFor(item)} @ ${item.path}`);
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
