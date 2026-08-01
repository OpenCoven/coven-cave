#!/usr/bin/env node --experimental-strip-types
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderWorktreeLifecycleReport,
  summarizeWorktreeLifecycle,
} from "../src/lib/worktree-lifecycle.ts";
import {
  acquireMaintenanceGate,
  releaseMaintenanceGate,
  repositoryMaintenanceCapabilities,
} from "./maintenance-gate.mjs";
import { collectWorktreeLifecycleInventory } from "./worktree-lifecycle-inventory.ts";
import {
  createGitRetirementOperations,
  parseMaxRetire,
  retireLifecycleUnits,
} from "./worktree-lifecycle-retirement.ts";

type Options = {
  repo: string | null;
  root: string;
  json: boolean;
  nowMs: number;
  apply: boolean;
  maxRetire: number;
};

type PatrolInventory = ReturnType<typeof collectWorktreeLifecycleInventory>;
type PatrolSummary = ReturnType<typeof summarizeWorktreeLifecycle>;
type MaintenanceCapabilities = ReturnType<typeof repositoryMaintenanceCapabilities>;
type RetirementReport = ReturnType<typeof retireLifecycleUnits>;
type PatrolItem = PatrolSummary["items"][number];
type RetirementBlock = RetirementReport["blocked"][number];
type RemoteDeletionProposal = RetirementReport["remoteDeletionProposals"][number];
type MaintenanceGateHandle = {
  root: string;
  ownerId: string;
  generation: number;
  token: string;
};
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
  createGitRetirementOperations: typeof createGitRetirementOperations;
  retireLifecycleUnits: typeof retireLifecycleUnits;
};

const APPLY_OWNER_ID = "worktree-lifecycle-patrol";
const APPLY_PURPOSE = "worktree lifecycle retirement apply";
const defaultRetirementApplyDependencies: RetirementApplyDependencies = {
  acquireMaintenanceGate,
  releaseMaintenanceGate,
  createGitRetirementOperations,
  retireLifecycleUnits,
};

type RetirementApplyResult = {
  retirement: RetirementReport;
  warning?: string;
};

type RetirementApplyOutcomeReason =
  | "retirement-blocked"
  | "maintenance-gate-release-failed"
  | "retirement-blocked-and-maintenance-gate-release-failed";

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
removes worktrees or branches unless --apply becomes available after all
maintenance planes are enforced.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeInventory(inventory: PatrolInventory): PatrolSummary {
  return summarizeWorktreeLifecycle(inventory.items, inventory.budgets);
}

function buildJsonReport(
  options: Options,
  inventory: PatrolInventory,
  summary: PatrolSummary,
  extras: Record<string, unknown> = {},
) {
  return {
    ok: true,
    generatedAt: new Date(options.nowMs).toISOString(),
    ...summary,
    inventoryFingerprint: inventory.inventoryFingerprint,
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
    console.error(
      `worktree-lifecycle-patrol: --apply unavailable; missing maintenance planes: ${missingPlanes.join(", ")}`,
    );
  }
  return 2;
}

export function evaluateRetirementApplyOutcome(
  result: RetirementApplyResult,
): RetirementApplyOutcome {
  const blocked = result.retirement.blocked.length > 0;
  const releaseFailed = Boolean(result.warning);
  if (!blocked && !releaseFailed) {
    return { ok: true, status: 0 };
  }
  if (blocked && releaseFailed) {
    return {
      ok: false,
      status: 1,
      reason: "retirement-blocked-and-maintenance-gate-release-failed",
    };
  }
  if (blocked) {
    return { ok: false, status: 1, reason: "retirement-blocked" };
  }
  return { ok: false, status: 1, reason: "maintenance-gate-release-failed" };
}

export function renderApplyReport(
  summary: PatrolSummary,
  retirement: RetirementReport,
  warning?: string,
) {
  const outcome = evaluateRetirementApplyOutcome({ retirement, warning });
  const retired = [...retirement.retired].sort(comparePatrolItems).map(formatRetiredItem);
  const blocked = [...retirement.blocked].sort(compareRetirementBlocks).map(formatBlockedItem);
  const cleanupReady = [...retirement.cleanupReady]
    .sort(comparePatrolItems)
    .map(formatRetiredItem);
  const remoteDeletionProposals = [...retirement.remoteDeletionProposals]
    .sort(compareRemoteDeletionProposals)
    .map(formatRemoteDeletionProposal);
  const lines = [
    renderWorktreeLifecycleReport(summary, { includeFooter: false }),
    "",
    `Apply result: ${outcome.ok ? "ok" : `failed (${outcome.reason})`}`,
    `Retired: ${retirement.retired.length}`,
    `Blocked: ${retirement.blocked.length}`,
    `Cleanup-ready remaining: ${summary.counts["retire-after-gate"]}`,
  ];
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

  let retirement: RetirementReport | undefined;
  let thrown: unknown;
  try {
    const operations = dependencies.createGitRetirementOperations({
      root: options.root,
      repo: options.repo!,
      gateHandle: acquired.handle,
      nowMs: options.nowMs,
    });
    retirement = dependencies.retireLifecycleUnits({
      items: inventory.items,
      gateHandle: {
        generation: acquired.handle.generation,
        token: acquired.handle.token,
      },
      operations,
      maxRetire: String(options.maxRetire),
    });
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

  if (retirement === undefined) {
    throw new Error("retirement apply completed without a retirement result");
  }

  return releaseWarning ? { retirement, warning: releaseWarning } : { retirement };
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
    if (!capabilities.complete) {
      return renderApplyUnavailable(options, inventory, summary, capabilities);
    }
  }

  if (options.apply) {
    const { retirement, warning } = runRetirementApply(options, inventory);
    const outcome = evaluateRetirementApplyOutcome({ retirement, warning });
    const postInventory = collectWorktreeLifecycleInventory({
      repo: options.repo!,
      root: options.root,
      nowMs: options.nowMs,
    });
    const postSummary = summarizeInventory(postInventory);
    console.log(
      options.json
        ? renderJsonReport(options, postInventory, postSummary, {
            ok: outcome.ok,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
            ...(warning ? { warning } : {}),
            retirement,
          })
        : renderApplyReport(postSummary, retirement, warning),
    );
    return outcome.status;
  }

  console.log(
    options.json
      ? renderJsonReport(options, inventory, summary)
      : renderWorktreeLifecycleReport(summary),
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
