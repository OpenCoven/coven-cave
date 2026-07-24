// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// realpath: macOS tmpdir lives behind a /var → /private/var symlink, and the
// resolver's contract compares canonical paths against the given repo root.
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "cave-beads-workspace-")));
const projectA = path.join(temp, "project-a");
const projectB = path.join(temp, "project-b");

try {
  await mkdir(path.join(projectA, ".beads"), { recursive: true });
  await mkdir(path.join(projectB, ".beads"), { recursive: true });
  const { resolveSafeBeadsWorkspace } = await import("./beads-workspace.ts");
  assert.equal(resolveSafeBeadsWorkspace(projectA).ok, true, "a contained .beads directory is safe");

  await rm(path.join(projectA, ".beads"), { recursive: true, force: true });
  await symlink(path.join(projectB, ".beads"), path.join(projectA, ".beads"), "dir");
  const swapped = resolveSafeBeadsWorkspace(projectA);
  assert.equal(swapped.ok, false, "a replaced .beads symlink cannot reuse cached A data or mutate B");
  assert.equal(swapped.error, "unsafe Beads workspace");
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("beads-workspace.test.ts: ok");
