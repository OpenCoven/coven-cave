#!/usr/bin/env node --experimental-strip-types
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderWorktreeLifecycleReport,
  summarizeWorktreeLifecycle,
} from "../src/lib/worktree-lifecycle.ts";
import {
  acquireMaintenanceGate,
  createFenceRenewal,
  heartbeatMaintenanceGate,
  releaseMaintenanceGate,
  repositoryMaintenanceCapabilities,
  verifyMaintenanceGateOwnership,
} from "./maintenance-gate.mjs";
import {
  assessMaintenancePlaneAdmission,
  type MaintenancePlaneCapabilities,
} from "../src/lib/maintenance-plane-admission.ts";
import { collectWorktreeLifecycleInventory } from "./worktree-lifecycle-inventory.ts";
import {
  createGitRetirementOperations,
  parseMaxRetire,
  retireLifecycleUnits,
} from "./worktree-lifecycle-retirement.ts";
import {
  createMetadataRepairOperations,
  repairOrphanedWorktreeMetadata,
} from "./worktree-lifecycle-metadata-repair.ts";

type Options = {
  repo: string | null;
  root: string;
  json: boolean;
  nowMs: number;
  apply: boolean;
  maxRetire: number;
  /**
   * Opt in to running --apply while the known-pending maintenance planes
   * (coven/beads/github, cave-wqa0b.2/.3/.4) are unenforced. Never implicit:
   * absent this, --apply behaves exactly as it did. The local plane is still
   * required — see assessMaintenancePlaneAdmission.
   */
  allowUnenforcedPlanes: boolean;
};

type PatrolInventory = ReturnType<typeof collectWorktreeLifecycleInventory>;
type PatrolSummary = ReturnType<typeof summarizeWorktreeLifecycle>;
type MaintenanceCapabilities = ReturnType<typeof repositoryMaintenanceCapabilities>;
type RetirementReport = ReturnType<typeof retireLifecycleUnits>;
type MetadataRepairReport = ReturnType<typeof repairOrphanedWorktreeMetadata>;
type PatrolItem = PatrolSummary["items"][number];
type RetirementBlock = RetirementReport["blocked"][number];
type RemoteDeletionProposal = RetirementReport["remoteDeletionProposals"][number];
type MaintenanceGateHandle = object;
type AcquireMaintenanceGateResult =
  | {
      ok: true;
      handle: MaintenanceGateHandle;
    }
  | {
      ok: false;
      reason?: string;
    };

type RetirementApplyDependencies = {
  acquireMaintenanceGate: (options: {
    ownerId: string;
    purpose: string;
    repoDir: string;
  }) => AcquireMaintenanceGateResult;
  releaseMaintenanceGate: (handle: MaintenanceGateHandle) => {
    ok: boolean;
    reason?: string;
  };
  heartbeatMaintenanceGate: (handle: MaintenanceGateHandle) => {
    ok: boolean;
    reason?: string;
  };
  verifyMaintenanceGateOwnership: (handle: MaintenanceGateHandle) => {
    ok: boolean;
    reason?: string;
  };
  createGitRetirementOperations: typeof createGitRetirementOperations;
  retireLifecycleUnits: typeof retireLifecycleUnits;
  createMetadataRepairOperations: typeof createMetadataRepairOperations;
  repairOrphanedWorktreeMetadata: typeof repairOrphanedWorktreeMetadata;
  collectWorktreeLifecycleInventory: typeof collectWorktreeLifecycleInventory;
  /**
   * Optional, and injected so a test can observe renewal without waiting out
   * the throttle.
   *
   * Optional because the existing apply tests build explicit dependency
   * literals rather than spreading the defaults, so a required field would
   * arrive undefined in every one of them and fail as a TypeError inside the
   * inventory try/catch — which surfaces as a confusing postInventoryError
   * rather than as the missing wiring it actually is.
   *
   * The real {@link createFenceRenewal} deliberately skips the first call and
   * then renews at most every FENCE_RENEWAL_INTERVAL_MS, which is correct in
   * production and invisible in a test that finishes in milliseconds — every
   * call would be throttled, so a missing renewal and a working one look
   * identical. Injecting the factory lets a test supply an unthrottled one.
   */
  createFenceRenewal?: typeof createFenceRenewal;
};

const APPLY_OWNER_ID = "worktree-lifecycle-patrol";
const APPLY_PURPOSE = "worktree lifecycle metadata repair and retirement apply";
const defaultRetirementApplyDependencies: RetirementApplyDependencies = {
  acquireMaintenanceGate: acquireMaintenanceGate as unknown as RetirementApplyDependencies["acquireMaintenanceGate"],
  heartbeatMaintenanceGate: heartbeatMaintenanceGate as unknown as RetirementApplyDependencies["heartbeatMaintenanceGate"],
  releaseMaintenanceGate: releaseMaintenanceGate as unknown as RetirementApplyDependencies["releaseMaintenanceGate"],
  verifyMaintenanceGateOwnership: verifyMaintenanceGateOwnership as unknown as RetirementApplyDependencies["verifyMaintenanceGateOwnership"],
  createGitRetirementOperations,
  retireLifecycleUnits,
  createMetadataRepairOperations,
  repairOrphanedWorktreeMetadata,
  collectWorktreeLifecycleInventory,
  createFenceRenewal,
};

type RetirementApplyResult = {
  metadataRepair: MetadataRepairReport;
  retirement: RetirementReport;
  postInventory?: PatrolInventory;
  postInventoryError?: string;
  warning?: string;
};

type ApplyFailureReason =
  | "metadata-repair-blocked"
  | "retirement-blocked"
  | "maintenance-gate-release-failed"
  | "post-apply-inventory-failed";

type RetirementApplyOutcomeReason = string;

type RetirementApplyOutcome = {
  ok: boolean;
  status: 0 | 1;
  reason?: RetirementApplyOutcomeReason;
};

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: null,
    root: process.cwd(),
    json: false,
    nowMs: Date.now(),
    apply: false,
    maxRetire: parseMaxRetire(undefined),
    allowUnenforcedPlanes: false,
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
      case "--apply":
        options.apply = true;
        break;
      case "--allow-unenforced-planes":
        options.allowUnenforcedPlanes = true;
        break;
      case "--max-retire": {
        const value = argv[++index];
        if (value === undefined) {
          throw new Error("--max-retire requires an integer from 1 through 10");
        }
        options.maxRetire = parseMaxRetire(value);
        break;
      }
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
  console.log(`Usage: node --experimental-strip-types scripts/worktree-lifecycle-patrol.ts --repo OWNER/REPO [--root PATH] [--json] [--apply] [--max-retire 1..10]

Builds a read-only lifecycle report for every registered worktree and direct
local branch. The patrol correlates local state with claims, Beads, Coven
sessions, pull requests, workflow runs, and live process cwd ownership. It never
repairs metadata, removes worktrees, or removes branches unless --apply becomes
maintenance planes are enforced.

--apply refuses with exit 2 before assessing any unit while the Beads or GitHub
maintenance planes are unenforced (cave-3aqvr). The coven plane is
opportunistic -- enforced when Coven's released maintenance protocol is
available, unenforced when it is not -- so it may be missing too. Retire
cleanup-ready units by hand through the archive-tag route in CLAUDE.md, or opt
in below.

--allow-unenforced-planes opts in to running --apply while the known-pending
planes (coven/beads/github, cave-wqa0b.2/.3/.4) are unenforced. The local plane
is still required and is never waivable: it performs the exclusion that stops
two actors retiring the same unit. Every degraded run is announced on stderr
naming the waived planes before any unit is touched (cave-s03wp).`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeInventory(inventory: PatrolInventory): PatrolSummary {
  return summarizeWorktreeLifecycle(inventory.items, inventory.budgets, inventory.globalErrors);
}

/**
 * Malformed metadata records that describe no unit the patrol can see.
 *
 * A record is charged to the branch and path it names (cave-g9byt), so one
 * whose worktree was removed outside the lifecycle lands on nothing and would
 * report as clean. It is still a defect on someone's bead — and the record that
 * caused cave-g9byt was exactly this shape — so the patrol names it without
 * moving any unit into a lane over it.
 */
function orphanedMetadataClaims(inventory: PatrolInventory): string[] {
  return [
    ...new Set(
      inventory.metadataClaimErrors
        .filter((claim) => {
          // A record naming neither a usable branch nor a usable path is not
          // orphaned — it is unnameable, so it stays charged to every unit and
          // is already visible in their lanes. Reporting it here would say the
          // opposite of what the header promises: that nothing is blocked by it.
          if (claim.branch.length === 0 && claim.path === null) return false;
          return !inventory.items.some(
            (item) =>
              (claim.branch.length > 0 && item.branch === claim.branch) ||
              (claim.path !== null && item.path === claim.path),
          );
        })
        .flatMap((claim) => claim.errors),
    ),
  ];
}

function renderOrphanedMetadataClaims(inventory: PatrolInventory): string {
  const claims = orphanedMetadataClaims(inventory);
  if (claims.length === 0) return "";
  return [
    "",
    "Malformed worktree metadata on beads whose units are gone (no unit is blocked by these;",
    "the owning bead should repair or drop the record):",
    ...claims.map((claim) => `- ${claim}`),
  ].join("\n");
}

function buildJsonReport(
  options: Options,
  inventory: PatrolInventory,
  summary: PatrolSummary,
  extras: Record<string, unknown> = {},
) {
  const orphanedClaims = orphanedMetadataClaims(inventory);
  return {
    ok: true,
    generatedAt: new Date(options.nowMs).toISOString(),
    ...summary,
    orphanedMetadata: inventory.orphanedMetadata,
    orphanedMetadataCount: inventory.orphanedMetadata.length,
    orphanedMetadataErrors: inventory.orphanedMetadataErrors,
    orphanedMetadataErrorCount: inventory.orphanedMetadataErrors.length,
    inventoryFingerprint: inventory.inventoryFingerprint,
    ...(orphanedClaims.length > 0 ? { orphanedMetadataClaims: orphanedClaims } : {}),
    ...extras,
  };
}

function renderJsonReport(
  options: Options,
  inventory: PatrolInventory,
  summary: PatrolSummary,
  extras: Record<string, unknown> = {},
): string {
  return JSON.stringify(buildJsonReport(options, inventory, summary, extras), null, 2);
}

function renderApplyUnavailable(
  options: Options,
  inventory: PatrolInventory,
  summary: PatrolSummary,
  capabilities: MaintenanceCapabilities,
): number {
  const missingPlanes = (["local", "coven", "beads", "github"] as const).filter(
    (plane) => capabilities[plane].enforced === false,
  );
  if (options.json) {
    console.log(
      renderJsonReport(options, inventory, summary, {
        ok: false,
        reason: "gate-incomplete",
        missingPlanes,
        ...capabilities,
      }),
    );
  } else {
    // Name the blocking work and the route that does function. Bare
    // "missing maintenance planes" reads as a local fault, so sessions retry
    // it, then reach for `git worktree add` -- the unmanaged fallback whose
    // worktrees carry no lifecycle metadata and can never be retired at all
    // (cave-l52dt). The planes are unimplemented, not unavailable (cave-3aqvr).
    // The blocking Bead per plane is read from the capability's own `source`
    // rather than a second map here, so this cannot drift from the gate.
    console.error(
      [
        `worktree-lifecycle-patrol: --apply unavailable; missing maintenance planes: ${missingPlanes.join(", ")}`,
        "",
        "This is not a local fault and a retry will not clear it. These planes are",
        "not yet enforced by their listed maintenance-plane owners:",
        ...missingPlanes.map(
          (plane) => `  ${plane.padEnd(7)} blocked on ${capabilities[plane].source || "an unfiled Bead"}`,
        ),
        "",
        "Until those land, automated retirement is unavailable and hand-retirement",
        "is the expected path -- NOT a workaround. Retire a cleanup-ready unit via",
        "the archive-tag route in CLAUDE.md (worktree-guard section), and prove",
        "retention BEFORE removing anything: a merged PR is not retention, because",
        "a squash-merge leaves the branch commits on no remote ref. Tag the exact",
        "head, push the tag, confirm it is on the REMOTE, then remove.",
        "",
        "Tracked by cave-3aqvr.",
      ].join("\n"),
    );
  }
  return 2;
}

export function evaluateRetirementApplyOutcome(
  result: Pick<
    RetirementApplyResult,
    "retirement" | "metadataRepair" | "warning" | "postInventoryError"
  > & { metadataRepair?: MetadataRepairReport },
): RetirementApplyOutcome {
  const failures: ApplyFailureReason[] = [];
  if (
    result.metadataRepair &&
    (result.metadataRepair.blocked.length > 0 ||
      result.metadataRepair.partial.length > 0)
  ) {
    failures.push("metadata-repair-blocked");
  }
  if (result.retirement.blocked.length > 0) failures.push("retirement-blocked");
  if (result.warning) failures.push("maintenance-gate-release-failed");
  if (result.postInventoryError) failures.push("post-apply-inventory-failed");
  if (failures.length === 0) {
    return { ok: true, status: 0 };
  }
  return {
    ok: false,
    status: 1,
    reason: failures.join("-and-") as RetirementApplyOutcomeReason,
  };
}

export function renderApplyReport(
  summary: PatrolSummary,
  retirement: RetirementReport,
  warning?: string,
  postInventoryError?: string,
  metadataRepair: MetadataRepairReport = emptyMetadataRepairReport(),
) {
  const outcome = evaluateRetirementApplyOutcome({
    metadataRepair,
    retirement,
    warning,
    postInventoryError,
  });
  const retired = [...retirement.retired].sort(comparePatrolItems).map(formatRetiredItem);
  const blocked = [...retirement.blocked].sort(compareRetirementBlocks).map(formatBlockedItem);
  const cleanupReady = [...retirement.cleanupReady]
    .sort(comparePatrolItems)
    .map(formatRetiredItem);
  const remoteDeletionProposals = [...retirement.remoteDeletionProposals]
    .sort(compareRemoteDeletionProposals)
    .map(formatRemoteDeletionProposal);
  const repairedMetadata = metadataRepair.repaired.map(formatMetadataRepairCandidate);
  const blockedMetadata = metadataRepair.blocked.map(formatMetadataRepairBlock);
  const partialMetadata = metadataRepair.partial.map(formatMetadataRepairBlock);
  const pendingMetadata = metadataRepair.pending.map(formatMetadataRepairCandidate);
  const lines = [
    ...(postInventoryError
      ? [
          `Post-apply inventory: unavailable (${postInventoryError})`,
          "Lifecycle snapshot: pre-apply fallback",
          "",
        ]
      : []),
    renderWorktreeLifecycleReport(summary, { includeFooter: false }),
    "",
    `Apply result: ${outcome.ok ? "ok" : `failed (${outcome.reason})`}`,
    `Metadata repaired: ${metadataRepair.repaired.length}`,
    `Metadata blocked: ${metadataRepair.blocked.length + metadataRepair.partial.length}`,
    `Retired: ${retirement.retired.length}`,
    `Blocked: ${retirement.blocked.length}`,
    `Cleanup-ready remaining: ${
      postInventoryError ? "unknown" : summary.counts["retire-after-gate"]
    }`,
  ];
  pushSection(lines, "Orphaned metadata repaired", repairedMetadata);
  pushSection(lines, "Orphaned metadata blocked", blockedMetadata);
  pushSection(lines, "Orphaned metadata partial", partialMetadata);
  pushSection(lines, "Orphaned metadata pending", pendingMetadata);
  pushSection(lines, "Locally retired", retired);
  pushSection(lines, "Cleanup-ready but not processed", cleanupReady);
  pushSection(lines, "Blocked during apply", blocked);
  pushSection(lines, "Remote-deletion proposals", remoteDeletionProposals);
  if (warning) {
    lines.push("", `Warning: ${warning}`);
  }
  return lines.join("\n");
}

function formatGateFailure(action: "acquire" | "release", reason?: string) {
  return `failed to ${action} maintenance gate: ${reason ?? `unknown ${action} error`}`;
}

function formatItemIdentity(item: PatrolItem): string {
  const label = item.branch ?? item.ref ?? "(detached)";
  const kind = item.kind === "branch-only" ? " [branch-only]" : "";
  const location = item.kind === "branch-only" || item.path === null ? "" : ` @ ${item.path}`;
  return `${label}${kind}${location}`;
}

function formatRetiredItem(item: PatrolItem): string {
  return `- ${formatItemIdentity(item)} (oid ${item.head})`;
}

function formatBlockedItem(item: RetirementBlock): string {
  const label = item.branch ?? item.ref ?? "(detached)";
  return `- [${item.partial ? "PARTIAL" : "BLOCKED"}] ${label} (oid ${item.oid}): ${item.reason}`;
}

function formatRemoteDeletionProposal(proposal: RemoteDeletionProposal): string {
  const mergedPr =
    proposal.mergedPr === null ? "merged PR none" : `merged PR #${proposal.mergedPr}`;
  return `- ${proposal.ref} remote oid ${proposal.oid}; local retirement oid ${proposal.localRetirementOid}; ${mergedPr}; separate authorization required before any remote deletion`;
}

function emptyMetadataRepairReport(): MetadataRepairReport {
  return {
    repaired: [],
    blocked: [],
    partial: [],
    pending: [],
  };
}

function formatMetadataRepairCandidate(
  candidate: PatrolInventory["orphanedMetadata"][number],
): string {
  return `- ${candidate.beadId} ${candidate.location} ${candidate.branch} at ${candidate.path}`;
}

function formatMetadataRepairBlock(
  blocked: MetadataRepairReport["blocked"][number] | MetadataRepairReport["partial"][number],
): string {
  return `- ${blocked.beadId} ${blocked.location}: ${blocked.reason}`;
}

function renderPatrolReport(
  summary: PatrolSummary,
  inventory: PatrolInventory,
): string {
  const lines = [renderWorktreeLifecycleReport(summary, { includeFooter: false })];
  const orphaned = inventory.orphanedMetadata.map((candidate) => {
    const disposition = candidate.repairable
      ? "repairable by gated apply"
      : `not repairable: ${candidate.reasons.join("; ")}`;
    return `${formatMetadataRepairCandidate(candidate)}; ${disposition}`;
  });
  pushSection(lines, "Orphaned metadata", orphaned);
  const malformedClaims = renderOrphanedMetadataClaims(inventory);
  if (malformedClaims) {
    lines.push(malformedClaims);
  }
  lines.push("", "Report only. No worktree, branch, or Bead metadata was changed.");
  return lines.join("\n");
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function comparePatrolItems(left: PatrolItem, right: PatrolItem): number {
  return (
    compareText(formatItemIdentity(left), formatItemIdentity(right)) ||
    compareText(left.head, right.head)
  );
}

function compareRetirementBlocks(left: RetirementBlock, right: RetirementBlock): number {
  return (
    Number(left.partial) - Number(right.partial) ||
    compareText(left.branch ?? left.ref ?? "(detached)", right.branch ?? right.ref ?? "(detached)") ||
    compareText(left.oid, right.oid) ||
    compareText(left.reason, right.reason)
  );
}

function compareRemoteDeletionProposals(
  left: RemoteDeletionProposal,
  right: RemoteDeletionProposal,
): number {
  return (
    compareText(left.ref, right.ref) ||
    compareText(left.oid, right.oid) ||
    compareText(left.localRetirementOid, right.localRetirementOid) ||
    (left.mergedPr ?? -1) - (right.mergedPr ?? -1)
  );
}

function pushSection(
  lines: string[],
  title: string,
  entries: string[],
) {
  lines.push("", `${title} (${entries.length})${entries.length === 0 ? ": none" : ""}`);
  if (entries.length === 0) {
    return;
  }
  lines.push(...entries);
}

export function runRetirementApply(
  options: Options,
  inventory: PatrolInventory,
  dependencies: RetirementApplyDependencies = defaultRetirementApplyDependencies,
): RetirementApplyResult {
  const acquired = dependencies.acquireMaintenanceGate({
    ownerId: APPLY_OWNER_ID,
    purpose: APPLY_PURPOSE,
    repoDir: options.root,
  });
  if (!acquired.ok) {
    throw new Error(formatGateFailure("acquire", acquired.reason));
  }

  let metadataRepair: MetadataRepairReport | undefined;
  let retirement: RetirementReport | undefined;
  let postInventory: PatrolInventory | undefined;
  let postInventoryError: string | undefined;
  let thrown: unknown;
  try {
    const repairableOrphans = (inventory.orphanedMetadata ?? []).filter(
      (candidate) => candidate.repairable,
    );
    // Reserve a retirement slot before metadata repair spends the budget.
    //
    // --max-retire is one allowance shared by two jobs, and repair is served
    // first. Whenever there were at least maxRetire repairable records, repair
    // took all of it, gitLimit fell to 0, and retireLifecycleUnits was never
    // called — so the run retired nothing while still listing the units it
    // could have retired, which reads as "considered and declined" rather than
    // "never got a slot". Measured on two consecutive runs against this
    // checkout: 3 repaired, 0 retired, with 15 records pending; at three
    // repairs a run it would take five clean runs before a single worktree
    // became eligible, and hand-retirement keeps adding residue faster than
    // that (cave-xbc87). See cave-1si7i.
    //
    // The reservation is one slot, not a second budget: total mutations still
    // cannot exceed maxRetire, which is what bounds an unattended sweep's blast
    // radius (scripts/worktree-sweep-prompt.md pins --max-retire 3 and says not
    // to raise it). It is taken only when something is actually retirable, so a
    // run with nothing to retire still spends the whole allowance on repair,
    // exactly as before.
    //
    // The lane test matches retireLifecycleUnits' own eligibility filter
    // (worktree-lifecycle-retirement.ts:161); anything else would reserve a
    // slot for work that cannot happen.
    const retirableAtGate = inventory.items.some(
      (item) => item.lane === "retire-after-gate",
    );
    // Only reserve when there is more than one slot to divide. With
    // --max-retire 1 a reservation would not share the budget, it would just
    // move the starvation onto repair — which is the same defect wearing the
    // other hat, and it would contradict the established behaviour that a
    // single-slot run spends it on repair.
    const retirementReservation = retirableAtGate && options.maxRetire >= 2 ? 1 : 0;
    const repairLimit = Math.min(
      Math.max(0, options.maxRetire - retirementReservation),
      repairableOrphans.length,
    );
    metadataRepair = dependencies.repairOrphanedWorktreeMetadata({
      candidates: inventory.orphanedMetadata ?? [],
      maxRepairs: repairLimit,
      gateHandle: acquired.handle,
      repositoryRoot: options.root,
      operations: dependencies.createMetadataRepairOperations({
        root: options.root,
      }),
    });
    const gitLimit = options.maxRetire - repairLimit;
    const operations = dependencies.createGitRetirementOperations({
      root: options.root,
      repo: options.repo!,
      gateHandle: acquired.handle,
      nowMs: options.nowMs,
    });
    retirement =
      gitLimit > 0
        ? dependencies.retireLifecycleUnits({
            items: inventory.items,
            gateHandle: acquired.handle,
            operations,
            maxRetire: String(gitLimit),
          })
        : {
            retired: [],
            blocked: [],
            cleanupReady: inventory.items
              .filter((item) => item.lane === "retire-after-gate")
              .sort(comparePatrolItems),
            attempts: [],
            remoteDeletionProposals: [],
          };
    const heartbeat = dependencies.heartbeatMaintenanceGate(acquired.handle);
    if (!heartbeat.ok) {
      postInventoryError =
        `failed to heartbeat maintenance gate before post-apply inventory: ${
          heartbeat.reason ?? "unknown heartbeat error"
        }`;
    } else {
      const ownershipBefore =
        dependencies.verifyMaintenanceGateOwnership(acquired.handle);
      if (!ownershipBefore.ok) {
        postInventoryError =
          `lost maintenance gate ownership before post-apply inventory: ${
            ownershipBefore.reason ?? "unknown ownership error"
          }`;
      } else {
        try {
          // Renew the fence AS the inventory works, not merely before it.
          //
          // This is the longest operation inside the fence — on a large
          // checkout it outlives the 120s Coven lease on its own (measured at
          // 141s against COVEN_OWNER_LEASE_MS), so heartbeating once above and
          // verifying ownership afterwards is not enough: the lease is already
          // gone by the time the inventory returns, the ownership check below
          // cannot pass, and the release at the end of this function fails with
          // "maintenance lease expired".
          //
          // createFenceRenewal anchors renewal to progress rather than to a
          // timer, which is the only thing that works here: the inventory is
          // synchronous throughout (spawnSync for git and gh), so it never
          // yields and no timer callback would ever run. The create path solved
          // exactly this for its own inventory in cave-cs9g1; this call site
          // was left behind. See cave-ykj47.
          //
          // Throwing on a failed heartbeat is deliberate and matches
          // createFenceRenewal's fail-closed contract: if the fence is gone,
          // continuing would do unexcluded work while believing otherwise. The
          // catch below turns that into a reported postInventoryError rather
          // than an abort, because the retirement above has already happened
          // and its result must still be reported.
          const makeFenceRenewal =
            dependencies.createFenceRenewal ?? createFenceRenewal;
          const renewFenceDuringPostInventory = makeFenceRenewal(() => {
            const renewed = dependencies.heartbeatMaintenanceGate(acquired.handle);
            if (!renewed.ok) {
              throw new Error(
                `failed to heartbeat maintenance gate during post-apply inventory: ${
                  renewed.reason ?? "unknown heartbeat error"
                }`,
              );
            }
          });
          const candidatePostInventory =
            dependencies.collectWorktreeLifecycleInventory({
              repo: options.repo!,
              root: options.root,
              nowMs: options.nowMs,
              onProgress: renewFenceDuringPostInventory,
            });
          const ownershipAfter =
            dependencies.verifyMaintenanceGateOwnership(acquired.handle);
          if (!ownershipAfter.ok) {
            postInventoryError =
              `lost maintenance gate ownership after post-apply inventory: ${
                ownershipAfter.reason ?? "unknown ownership error"
              }`;
          } else {
            const unreconciled = metadataRepair.repaired.filter((repaired) =>
              (candidatePostInventory.orphanedMetadata ?? []).some(
                (candidate) =>
                  candidate.beadId === repaired.beadId &&
                  candidate.location === repaired.location &&
                  candidate.branch === repaired.branch &&
                  candidate.path === repaired.path,
              ),
            );
            if (unreconciled.length > 0) {
              postInventoryError =
                `post-apply inventory still reports repaired orphaned metadata: ${unreconciled
                  .map((candidate) => `${candidate.beadId}:${candidate.location}`)
                  .join(", ")}`;
            } else {
              postInventory = candidatePostInventory;
            }
          }
        } catch (error) {
          postInventoryError =
            `failed to collect post-apply inventory: ${errorMessage(error)}`;
        }
      }
    }
  } catch (error) {
    thrown = error;
  }

  let releaseWarning: string | undefined;
  try {
    const released = dependencies.releaseMaintenanceGate(acquired.handle);
    if (!released.ok) {
      releaseWarning = formatGateFailure("release", released.reason);
    }
  } catch (error) {
    releaseWarning = formatGateFailure("release", errorMessage(error));
  }

  if (thrown !== undefined) {
    if (releaseWarning) {
      throw new Error(`${errorMessage(thrown)}; ${releaseWarning}`, {
        cause: thrown instanceof Error ? thrown : undefined,
      });
    }
    throw thrown;
  }

  if (metadataRepair === undefined || retirement === undefined) {
    throw new Error("apply completed without metadata repair and retirement results");
  }

  return {
    metadataRepair,
    retirement,
    ...(postInventory ? { postInventory } : {}),
    ...(postInventoryError ? { postInventoryError } : {}),
    ...(releaseWarning ? { warning: releaseWarning } : {}),
  };
}

export function main(argv = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  const inventory = collectWorktreeLifecycleInventory({
    repo: options.repo!,
    root: options.root,
    nowMs: options.nowMs,
  });
  const summary = summarizeInventory(inventory);

  if (options.apply) {
    const capabilities = repositoryMaintenanceCapabilities();
    const admission = assessMaintenancePlaneAdmission({
      capabilities: capabilities as unknown as MaintenancePlaneCapabilities,
      allowUnenforcedPlanes: options.allowUnenforcedPlanes,
    });
    if (!admission.ok) {
      // A refusal the flag cannot lift reads differently from the ordinary
      // gate-incomplete one, and saying so stops an operator adding the flag
      // again harder when the local plane is what is missing.
      if (admission.code !== "gate-incomplete") {
        console.error(`worktree-lifecycle-patrol: --apply refused; ${admission.diagnostic}`);
        return 2;
      }
      return renderApplyUnavailable(options, inventory, summary, capabilities);
    }
    if (admission.degraded) {
      // Audit before acting, not after: if the run dies mid-retirement, the
      // record of which planes were waived must already exist. stderr so it
      // survives --json consumers reading stdout.
      console.error(
        [
          "worktree-lifecycle-patrol: DEGRADED APPLY — proceeding with unenforced maintenance planes",
          `  waived: ${admission.waivedPlanes.join(", ")}`,
          ...admission.waivedPlanes.map(
            (plane) =>
              `    ${plane.padEnd(7)} ${capabilities[plane]?.source || "no source recorded"}`,
          ),
          "  local plane is enforced; exclusion still applies.",
          "  Authorized by --allow-unenforced-planes (cave-s03wp).",
        ].join("\n"),
      );
    }
  }

  if (options.apply) {
    const {
      metadataRepair,
      retirement,
      postInventory,
      postInventoryError,
      warning,
    } = runRetirementApply(options, inventory);
    const outcome = evaluateRetirementApplyOutcome({
      metadataRepair,
      retirement,
      postInventoryError,
      warning,
    });
    const reportingInventory = postInventory ?? inventory;
    const postSummary = summarizeInventory(reportingInventory);
    console.log(
      options.json
        ? renderJsonReport(options, reportingInventory, postSummary, {
            ok: outcome.ok,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
            ...(warning ? { warning } : {}),
            inventoryPhase: postInventory ? "post-apply" : "pre-apply-fallback",
            ...(postInventoryError ? { postInventoryError } : {}),
            metadataRepair,
            retirement,
          })
        : `${renderApplyReport(
            postSummary,
            retirement,
            warning,
            postInventoryError,
            metadataRepair,
          )}${renderOrphanedMetadataClaims(reportingInventory)}`,
    );
    return outcome.status;
  }

  console.log(
    options.json
      ? renderJsonReport(options, inventory, summary)
      : renderPatrolReport(summary, inventory),
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`worktree-lifecycle-patrol: ${errorMessage(error)}`);
    process.exit(1);
  }
}
