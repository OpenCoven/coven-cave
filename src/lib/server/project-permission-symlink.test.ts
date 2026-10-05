// @ts-nocheck
/**
 * A familiar's project grant holds where the path really leads (#5795).
 *
 * The grant was checked against the path as spelled, while the write followed
 * a symlink: familiar `famA`, granted project A only, saved `A/cross.md` (a
 * link to `B/target.md`) and B's file changed; a tree move of the link took
 * B's file out of B, and a move into `A/crossdir` (a link to `B/dir`) put a
 * file in B.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "project-permission-symlink-")));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");

const A = path.join(tmp, "projA");
const B = path.join(tmp, "projB");
mkdirSync(path.join(A, "docs"), { recursive: true });
mkdirSync(path.join(B, "dir"), { recursive: true });
writeFileSync(path.join(A, "a.txt"), "A\n");
writeFileSync(path.join(A, "docs", "README.md"), "readme\n");
writeFileSync(path.join(B, "target.md"), "B\n");
symlinkSync(path.join(B, "target.md"), path.join(A, "cross.md"));
symlinkSync(path.join(B, "dir"), path.join(A, "crossdir"));
symlinkSync("docs/README.md", path.join(A, "README.md"));
writeFileSync(
  process.env.CAVE_PROJECTS_PATH_OVERRIDE,
  JSON.stringify({
    version: 1,
    projects: [
      { id: "A", name: "A", root: A, createdAt: "now", updatedAt: "now" },
      { id: "B", name: "B", root: B, createdAt: "now", updatedAt: "now" },
    ],
  }),
);
writeFileSync(
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE,
  JSON.stringify({
    version: 1,
    projectGrants: [{ familiarId: "famA", projectId: "A", source: "human", grantedAt: "2026-01-01T00:00:00.000Z" }],
  }),
);

const { assertProjectApiAccess } = await import("./project-permission-requests.ts");
const write = (p) => assertProjectApiAccess({ familiarId: "famA", path: p, surface: "file-write" });
const outside = { name: "ProjectAccessDeniedError", message: "this path leads outside its project" };

await write(path.join(A, "a.txt"));
await write(path.join(A, "new-file.txt")); // not made yet: its folder decides
await write(path.join(A, "README.md")); // a link that stays inside A
await assert.rejects(() => write(path.join(B, "target.md")), { name: "ProjectAccessDeniedError" }, "no grant on B");
await assert.rejects(() => write(path.join(A, "cross.md")), outside, "a link from A into B is B");
await assert.rejects(() => write(path.join(A, "crossdir")), outside, "a linked folder is where it leads");
await assert.rejects(() => write(path.join(A, "crossdir", "mine.txt")), outside, "so is a new file in it");

console.log("project permission symlinks: ok");
