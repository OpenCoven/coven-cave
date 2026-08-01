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

function renderJsonReport(
  options: Options,
  inventory: PatrolInventory,
  summary: PatrolSummary,
  retirement?: ReturnType<typeof retireLifecycleUnits>,
): string {
  return JSON.stringify(
    {
      ok: true,
      generatedAt: new Date(options.nowMs).toISOString(),
      ...summary,
      inventoryFingerprint: inventory.inventoryFingerprint,
      ...(retirement ? { retirement } : {}),
    },
    null,
    2,
  );
}

function renderApplyUnavailable(options: Options, capabilities: MaintenanceCapabilities): number {
  const missingPlanes = (["local", "coven", "beads", "github"] as const).filter(
    (plane) => capabilities[plane].enforced === false,
  );
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: "gate-incomplete",
          missingPlanes,
          ...capabilities,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(
      `worktree-lifecycle-patrol: --apply unavailable; missing maintenance planes: ${missingPlanes.join(", ")}`,
    );
  }
  return 2;
}

function renderApplyReport(summary: PatrolSummary, retirement: ReturnType<typeof retireLifecycleUnits>) {
  return [
    renderWorktreeLifecycleReport(summary),
    "",
    `Retired: ${retirement.retired.length}`,
    `Blocked: ${retirement.blocked.length}`,
    `Cleanup-ready remaining: ${retirement.cleanupReady.length}`,
  ].join("\n");
}

export function runRetirementApply(
  options: Options,
  inventory: PatrolInventory,
  dependencies: RetirementApplyDependencies = defaultRetirementApplyDependencies,
) {
  const acquired = dependencies.acquireMaintenanceGate({
    ownerId: APPLY_OWNER_ID,
    purpose: APPLY_PURPOSE,
    repoDir: options.root,
  });
  if (!acquired.ok) {
    throw new Error(`failed to acquire maintenance gate: ${acquired.reason}`);
  }

  let thrown: unknown;
  try {
    const operations = dependencies.createGitRetirementOperations({
      root: options.root,
      repo: options.repo!,
      gateHandle: acquired.handle,
      nowMs: options.nowMs,
    });
    return dependencies.retireLifecycleUnits({
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
    throw error;
  } finally {
    const released = dependencies.releaseMaintenanceGate(acquired.handle);
    if (!released.ok) {
      const releaseMessage = `failed to release maintenance gate: ${released.reason}`;
      if (thrown === undefined) {
        throw new Error(releaseMessage);
      }
      throw new Error(`${errorMessage(thrown)}; ${releaseMessage}`, {
        cause: thrown instanceof Error ? thrown : undefined,
      });
    }
  }
}

export function main(argv = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  if (options.apply) {
    const capabilities = repositoryMaintenanceCapabilities();
    if (!capabilities.complete) return renderApplyUnavailable(options, capabilities);
  }

  const inventory = collectWorktreeLifecycleInventory({
    repo: options.repo!,
    root: options.root,
    nowMs: options.nowMs,
  });

  if (options.apply) {
    const retirement = runRetirementApply(options, inventory);
    const postInventory = collectWorktreeLifecycleInventory({
      repo: options.repo!,
      root: options.root,
      nowMs: options.nowMs,
    });
    const summary = summarizeInventory(postInventory);
    console.log(
      options.json
        ? renderJsonReport(options, postInventory, summary, retirement)
        : renderApplyReport(summary, retirement),
    );
    return 0;
  }

  const summary = summarizeInventory(inventory);
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
