#!/usr/bin/env node
/**
 * Clear a Bead's stale worktree record (cave-xbc87).
 *
 * Hand-retiring a worktree leaves `metadata.coven.worktree` behind, still
 * naming a path that no longer exists. `worktree-lifecycle-create` then refuses
 * that Bead — "primary structured worktree metadata is not currently
 * registered" — so it can never hold another worktree. Since
 * `beads:worktrees:apply` is unreachable while three maintenance planes are
 * unenforced (cave-3aqvr), hand-retirement is the only route available, and
 * every retirement leaks one of these.
 *
 * This command removes ONLY a record whose worktree is provably absent, and
 * refuses every ambiguous case. The decision itself lives in
 * src/lib/worktree-record-clearance.ts and is unit-tested there; this file is
 * the boundary that gathers real state and performs the write.
 *
 * It deliberately does not: touch any other Bead, remove directories, delete
 * refs, or write a record. Its only mutation is dropping one key.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  assessWorktreeRecordClearance,
  type WorktreeRecordClearance,
} from "../src/lib/worktree-record-clearance.ts";

type Args = { bead: string; owner: string; reason: string; dryRun: boolean; json: boolean };

function fail(message: string, code = 2): never {
  process.stderr.write(`worktree-lifecycle-clear-record: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  let dryRun = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) fail(`${arg} requires a value`);
    values.set(arg, next);
    i += 1;
  }
  const bead = values.get("--bead") ?? "";
  const owner = values.get("--owner") ?? "";
  const reason = values.get("--reason") ?? "";
  if (!bead) fail("--bead is required");
  return { bead, owner, reason, dryRun, json };
}

function git(args: readonly string[]): string {
  return execFileSync("git", args as string[], { encoding: "utf8" });
}

/** Absolute paths git currently reports as registered worktrees. */
function registeredWorktreePaths(): string[] {
  return git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

type BeadMetadata = { coven?: { worktree?: Record<string, unknown> } & Record<string, unknown> };

function loadBead(beadId: string): { metadata: BeadMetadata } {
  const raw = execFileSync("bd", ["show", beadId, "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(raw);
  const bead = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!bead) fail(`Bead ${beadId} was not found`);
  return { metadata: (bead.metadata ?? {}) as BeadMetadata };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { metadata } = loadBead(args.bead);
  const record = metadata.coven?.worktree ?? null;

  const recordPath = typeof record?.path === "string" ? record.path : "";
  const verdict: WorktreeRecordClearance = assessWorktreeRecordClearance({
    record,
    registeredPaths: registeredWorktreePaths(),
    // existsSync rather than a stat on a directory: a leftover file or symlink
    // at the path is still something, and something is a reason to refuse.
    pathExistsOnDisk: recordPath.length > 0 ? existsSync(recordPath) : false,
    owner: args.owner,
    reason: args.reason,
  });

  if (!verdict.ok) {
    if (args.json) process.stdout.write(`${JSON.stringify(verdict)}\n`);
    fail(`${verdict.code}: ${verdict.diagnostic}`);
  }

  if (args.dryRun) {
    const report = { ...verdict, bead: args.bead, dryRun: true };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  // Preserve every other coven key. Only the worktree record is dropped, and
  // the clearance is recorded next to it so the removal stays attributable.
  const coven: Record<string, unknown> = { ...(metadata.coven ?? {}) };
  delete coven.worktree;
  coven.worktreeClearedAt = new Date().toISOString();
  coven.worktreeClearedBy = args.owner;
  coven.worktreeClearedReason = args.reason;
  coven.worktreeClearedPath = verdict.clearedPath;

  execFileSync("bd", ["update", args.bead, "--metadata", JSON.stringify({ coven }), "--json"], {
    encoding: "utf8",
  });

  // Read back rather than trusting the write: a silent no-op here would leave
  // the Bead just as blocked while reporting success.
  const after = loadBead(args.bead);
  if (after.metadata.coven?.worktree) {
    fail("bd update reported success but the record is still present on the Bead", 1);
  }

  const report = { ...verdict, bead: args.bead, dryRun: false };
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main();
