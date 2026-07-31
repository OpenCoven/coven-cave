#!/usr/bin/env node --experimental-strip-types
import path from "node:path";
import {
  renderWorktreeLifecycleReport,
  summarizeWorktreeLifecycle,
} from "../src/lib/worktree-lifecycle.ts";
import { collectWorktreeLifecycleInventory } from "./worktree-lifecycle-inventory.ts";

type Options = {
  repo: string | null;
  root: string;
  json: boolean;
  nowMs: number;
};

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

Builds a read-only lifecycle report for every registered worktree and direct
local branch. The patrol correlates local state with claims, Beads, Coven
sessions, pull requests, workflow runs, and live process cwd ownership. It never
removes worktrees or branches.`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const inventory = collectWorktreeLifecycleInventory({
    repo: options.repo!,
    root: options.root,
    nowMs: options.nowMs,
  });
  const summary = summarizeWorktreeLifecycle(inventory.items, inventory.budgets);
  console.log(
    options.json
      ? JSON.stringify(
          {
            ok: true,
            generatedAt: new Date(options.nowMs).toISOString(),
            ...summary,
            inventoryFingerprint: inventory.inventoryFingerprint,
          },
          null,
          2,
        )
      : renderWorktreeLifecycleReport(summary),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`worktree-lifecycle-patrol: ${message}`);
  process.exit(1);
}
