// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const originalEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_WORKSPACES_ROOT: process.env.COVEN_WORKSPACES_ROOT,
  COVEN_WORKSPACE_ROOT: process.env.COVEN_WORKSPACE_ROOT,
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
  NEXT_PUBLIC_WORKSPACE_ROOT: process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
  OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const tmp = await mkdtemp(path.join(tmpdir(), "coven-project-paths-"));

try {
  process.env.COVEN_HOME = path.join(tmp, ".coven");
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "cave-projects.json");
  delete process.env.COVEN_WORKSPACES_ROOT;
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;
  delete process.env.OPENCLAW_WORKSPACE_ROOT;

  const canonical = path.join(process.env.COVEN_HOME, "workspaces", "familiars", "sage");
  const savedProjectRoot = path.join(tmp, "Documents", "GitHub", "OpenCoven", "coven-docs");
  await mkdir(canonical, { recursive: true });
  const sensitiveFileRoot = path.join(tmp, "sensitive-config");
  await mkdir(path.join(savedProjectRoot, "docs"), { recursive: true });
  await writeFile(sensitiveFileRoot, "SECRET\n");
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "docs", name: "Coven Docs", root: savedProjectRoot },
        { id: "sensitive", name: "Sensitive", root: sensitiveFileRoot },
      ],
    }),
  );

  const { isAllowedNewProjectRoot, resolveAllowedProjectPath, validateCaveProjectRoot } = await import("./project-paths.ts");
  const legacy = path.join(process.env.COVEN_HOME, "workspace", "familiars", "sage");

  assert.equal(
    resolveAllowedProjectPath(legacy),
    await realpath(canonical),
    "legacy ~/.coven/workspace familiar paths normalize to canonical ~/.coven/workspaces paths",
  );

  assert.equal(
    resolveAllowedProjectPath(path.join(savedProjectRoot, "docs")),
    await realpath(path.join(savedProjectRoot, "docs")),
    "saved Cave project roots are allowed for file tree browsing",
  );
  assert.equal(
    isAllowedNewProjectRoot(savedProjectRoot),
    false,
    "saved Cave projects must not expand the trusted base for new project registration",
  );

  // Research mission workspaces live under cave state, not a registered
  // project; they must still be valid session roots (research runs failed
  // with "invalid project root" without this).
  const missionWorkspace = path.join(
    process.env.COVEN_HOME,
    "cave",
    "research-missions",
    "research-fixture",
  );
  await mkdir(missionWorkspace, { recursive: true });
  assert.equal(
    resolveAllowedProjectPath(missionWorkspace),
    await realpath(missionWorkspace),
    "research mission workspaces are allowed project roots",
  );

  // Allowed roots must be computed per call: a project saved after module
  // load was invisible until restart, failing sessions with "invalid project root".
  const lateProjectRoot = path.join(tmp, "Documents", "GitHub", "OpenCoven", "late-project");
  await mkdir(lateProjectRoot, { recursive: true });
  assert.equal(
    resolveAllowedProjectPath(lateProjectRoot),
    null,
    "unregistered roots stay rejected",
  );
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "docs", name: "Coven Docs", root: savedProjectRoot },
        { id: "late", name: "Late Project", root: lateProjectRoot },
      ],
    }),
  );
  assert.equal(
    resolveAllowedProjectPath(lateProjectRoot),
    await realpath(lateProjectRoot),
    "projects saved after startup are allowed without a server restart",
  );
  assert.equal(
    isAllowedNewProjectRoot(lateProjectRoot),
    false,
    "late saved projects do not authorize more arbitrary project roots",
  );

  assert.equal(
    isAllowedNewProjectRoot("~"),
    false,
    "tilde project roots are checked after home-directory expansion",
  );
  assert.equal(
    isAllowedNewProjectRoot("~/secret"),
    false,
    "tilde subpaths cannot masquerade as relative paths under the current working directory",
  );

  assert.equal(
    resolveAllowedProjectPath(sensitiveFileRoot),
    null,
    "saved Cave project roots that point at files are not promoted into the allowlist",
  );

  assert.deepEqual(
    validateCaveProjectRoot(sensitiveFileRoot),
    { ok: false, error: "root must be a directory" },
    "project roots must be existing directories",
  );
} finally {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
}

console.log("project-paths.test.ts: ok");
