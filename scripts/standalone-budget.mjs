#!/usr/bin/env node
// Raw Next standalone artifact guard. This runs after every production build,
// before the narrower Tauri sidecar closure is assembled, so a broad NFT trace
// cannot silently copy local build debris into release inputs.

import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asCount, asMebibytes, headroomOf } from "./budget-headroom.mjs";

export const STANDALONE_BUDGETS = Object.freeze({
  // Clean Linux baseline (2026-07-16): 6,416 entries / 351,017,052 bytes.
  // Roughly 9% entry and 20% byte headroom absorbs platform-native package
  // variance while still catching a renewed repository-root trace immediately.
  //
  // 2026-08-05 (cave-yizcb): reseated by RATE rather than by proportion.
  // Measured 6,993 entries / 403,012,564 bytes — seven entries under the old
  // 7,000 cap, and this script printed a clean check the whole way down because
  // it had no thin reporting at all (that is fixed above).
  //
  //   entries: 6,416 -> 6,993 over 20 days = ~29/day. The original 584-entry
  //            headroom lasted exactly those 20 days. 7,600 restores ~8%
  //            (607 entries), which is ~21 days at the observed rate.
  //   bytes:   351.0 MB -> 403.0 MB over the same 20 days = ~2.6 MB/day. The
  //            remaining 15.7 MiB was ~6 days, yet 3.9% headroom sits ABOVE the
  //            2% thin threshold — it would never have warned. 480 MiB leaves
  //            ~77 MB, about 30 days.
  //
  // Sizing to the threshold instead of the rate is what keeps failing here. The
  // sibling CSS cap was raised on 2026-08-03 to "the smallest ceiling that
  // clears 2%" and was back under it two days later. A percentage cannot tell
  // you how long you have; only the slope can. If you raise these again, derive
  // the number from measured growth and write the rate down.
  //
  // Both ceilings still catch what this guard is for: a renewed repository-root
  // trace overshoots by gigabytes and thousands of entries, not by 8%.
  fileCount: 7_600,
  unpackedBytes: 480 * 1024 * 1024,
});

export const STANDALONE_FORBIDDEN_ROOTS = Object.freeze([
  ".beads",
  ".claude",
  ".codex",
  ".git",
  ".next/cache",
  ".next/dev",
  ".tmp",
  ".worktrees",
  "artifacts",
  "release",
  "src-tauri",
  "target",
  "target-windows",
  "test-results",
]);

const STANDALONE_FORBIDDEN_ROOT_PREFIXES = Object.freeze([".worktree-lifecycle-fixture-"]);

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export function forbiddenStandaloneRoot(relativePath) {
  const candidate = portable(relativePath);
  const candidateRoot = candidate.split("/", 1)[0];
  if (STANDALONE_FORBIDDEN_ROOT_PREFIXES.some((prefix) => candidateRoot.startsWith(prefix))) {
    return candidateRoot;
  }
  return STANDALONE_FORBIDDEN_ROOTS.find(
    (root) => candidate === root || candidate.startsWith(`${root}/`),
  );
}

export async function standaloneMetrics(root) {
  root = path.resolve(root);
  const metrics = { fileCount: 0, directoryCount: 0, unpackedBytes: 0 };
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, entryPath);
      const forbiddenRoot = forbiddenStandaloneRoot(relativePath);
      if (forbiddenRoot) {
        throw new Error(`forbidden root leaked into Next standalone output: ${forbiddenRoot}`);
      }

      const metadata = await lstat(entryPath);
      if (metadata.isDirectory()) {
        metrics.directoryCount += 1;
        pending.push(entryPath);
      } else if (metadata.isFile() || metadata.isSymbolicLink()) {
        metrics.fileCount += 1;
        metrics.unpackedBytes += metadata.size;
      } else {
        throw new Error(`unsupported entry in Next standalone output: ${relativePath}`);
      }
    }
  }
  return metrics;
}

export async function verifyStandaloneArtifact(root, budgets = STANDALONE_BUDGETS) {
  const metrics = await standaloneMetrics(root);
  for (const [metric, budget] of Object.entries(budgets)) {
    if (metrics[metric] > budget) {
      throw new Error(`Next standalone ${metric} ${metrics[metric]} exceeds target ${budget}`);
    }
  }
  return metrics;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const standaloneRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(projectRoot, ".next", "standalone");
  try {
    const metrics = await verifyStandaloneArtifact(standaloneRoot);
    console.log(
      `standalone-budget: ${metrics.fileCount} files, ${metrics.directoryCount} directories, ${metrics.unpackedBytes} bytes ` +
        `(limits: ${STANDALONE_BUDGETS.fileCount} files, ${STANDALONE_BUDGETS.unpackedBytes} bytes)`,
    );

    // Report remaining headroom, the same way bundle-budget does. Without this
    // the file count reached 6,993 of 7,000 while still printing a clean check
    // (cave-yizcb): 0.10% headroom and silent, next to CSS gates warning at
    // 1.8% and 1.2%. A pass/fail gate cannot show you a slope.
    const reports = [
      ["file count", headroomOf(metrics.fileCount, STANDALONE_BUDGETS.fileCount, asCount("files"))],
      ["expanded bytes", headroomOf(metrics.unpackedBytes, STANDALONE_BUDGETS.unpackedBytes, asMebibytes)],
    ];
    const thin = [];
    for (const [label, report] of reports) {
      if (!report) continue;
      if (report.thin) thin.push(label);
      console.log(report.line);
    }
    if (thin.length > 0) {
      console.log(
        `\n⚠ standalone-budget: within budget, but thin on ${thin.join(", ")}.\n` +
          `  Reclaim room (check what joined the Next trace) or raise the cap\n` +
          `  deliberately with a justification — before it lands on someone else.`,
      );
    }
    console.log("✓ standalone-budget: within budget and free of local build roots.");
  } catch (error) {
    console.error(`✗ standalone-budget: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
