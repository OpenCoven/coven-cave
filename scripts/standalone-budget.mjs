#!/usr/bin/env node
// Raw Next standalone artifact guard. This runs after every production build,
// before the narrower Tauri sidecar closure is assembled, so a broad NFT trace
// cannot silently copy local build debris into release inputs.

import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STANDALONE_BUDGETS = Object.freeze({
  // Clean Linux baseline (2026-07-16): 6,416 entries / 351,017,052 bytes.
  // Roughly 9% entry and 20% byte headroom absorbs platform-native package
  // variance while still catching a renewed repository-root trace immediately.
  fileCount: 7_000,
  unpackedBytes: 400 * 1024 * 1024,
});

export const STANDALONE_FORBIDDEN_ROOTS = Object.freeze([
  ".beads",
  ".claude",
  ".codex",
  ".git",
  ".next/cache",
  ".next/dev",
  ".worktrees",
  "artifacts",
  "release",
  "src-tauri",
  "target",
  "target-windows",
  "test-results",
]);

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export function forbiddenStandaloneRoot(relativePath) {
  const candidate = portable(relativePath);
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
    console.log("✓ standalone-budget: within budget and free of local build roots.");
  } catch (error) {
    console.error(`✗ standalone-budget: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
