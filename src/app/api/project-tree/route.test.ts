// @ts-nocheck
/**
 * Moving entries in the project tree (#5795). Dragging a symlink moved the
 * file it points to and left the link dangling: `pkg/tsconfig.json`, a link
 * to `../base.json`, dragged into `other/`, moved `base.json` itself.
 */

import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "project-tree-move-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const workspace = path.join(scratch, "workspace");
const A = path.join(workspace, "projA");
mkdirSync(path.join(A, "pkg"), { recursive: true });
mkdirSync(path.join(A, "other"), { recursive: true });
process.env.WORKSPACE_ROOT = workspace;
process.env.COVEN_HOME = path.join(scratch, "coven-home");
process.env.COVEN_CAVE_HOME = path.join(scratch, "coven-home", "cave");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(scratch, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(scratch, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(scratch, "permission-config.json");
writeFileSync(
  process.env.CAVE_PROJECTS_PATH_OVERRIDE,
  JSON.stringify({ version: 1, projects: [{ id: "A", name: "A", root: A, createdAt: "now", updatedAt: "now" }] }),
);
writeFileSync(
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE,
  JSON.stringify({
    version: 1,
    projectGrants: [{ familiarId: "famA", projectId: "A", source: "human", grantedAt: "2026-01-01T00:00:00.000Z" }],
  }),
);

const { POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");
const move = async (from, toDir) => {
  const res = await POST(new NextRequest("http://127.0.0.1/api/project-tree", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, toDir, familiarId: "famA" }),
  }));
  return { status: res.status, json: await res.json() };
};

// ── 1. A symlink moves as itself ───────────────────────────────────────────
{
  writeFileSync(path.join(A, "base.json"), '{ "base": true }\n');
  symlinkSync("../base.json", path.join(A, "pkg", "tsconfig.json"));
  const moved = await move(path.join(A, "pkg", "tsconfig.json"), path.join(A, "other"));
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.ok(lstatSync(path.join(A, "other", "tsconfig.json")).isSymbolicLink(), "the link moved");
  assert.equal(readlinkSync(path.join(A, "other", "tsconfig.json")), "../base.json", "as it was");
  assert.equal(readFileSync(path.join(A, "base.json"), "utf8"), '{ "base": true }\n', "its target stayed where it was");
  assert.equal(lstatSync(path.join(A, "pkg", "tsconfig.json"), { throwIfNoEntry: false }), undefined);
}

// ── 2. A linked folder moves as a link, never its contents ─────────────────
{
  mkdirSync(path.join(A, "shared"));
  writeFileSync(path.join(A, "shared", "x.txt"), "x\n");
  symlinkSync("../shared", path.join(A, "pkg", "shared-link"));
  const moved = await move(path.join(A, "pkg", "shared-link"), path.join(A, "other"));
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.ok(lstatSync(path.join(A, "other", "shared-link")).isSymbolicLink());
  assert.equal(readFileSync(path.join(A, "shared", "x.txt"), "utf8"), "x\n", "the folder stayed");
}

// ── 3. A dangling link in the way is an entry in the way ───────────────────
{
  writeFileSync(path.join(A, "pkg", "notes.md"), "notes\n");
  symlinkSync("gone.md", path.join(A, "other", "notes.md"));
  const refused = await move(path.join(A, "pkg", "notes.md"), path.join(A, "other"));
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(readFileSync(path.join(A, "pkg", "notes.md"), "utf8"), "notes\n");
  assert.equal(readlinkSync(path.join(A, "other", "notes.md")), "gone.md", "the link there is kept");
}

// ── 4. Plain files and folders still move ──────────────────────────────────
{
  mkdirSync(path.join(A, "pkg", "lib"));
  writeFileSync(path.join(A, "pkg", "lib", "a.ts"), "a\n");
  const moved = await move(path.join(A, "pkg", "lib"), path.join(A, "other"));
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal(readFileSync(path.join(A, "other", "lib", "a.ts"), "utf8"), "a\n");
  assert.equal((await move(path.join(A, "other", "lib"), path.join(A, "other", "lib"))).status, 400, "not into itself");
}

console.log("project-tree move: ok");
