// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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
  const canonical = path.join(process.env.COVEN_HOME, "workspaces", "familiars", "sage");
  const savedProjectRoot = path.join(tmp, "Documents", "GitHub", "OpenCoven", "coven-docs");
  const openclawWorkspaceRoot = path.join(tmp, ".openclaw", "workspace");
  process.env.OPENCLAW_WORKSPACE_ROOT = openclawWorkspaceRoot;
  await mkdir(canonical, { recursive: true });
  const sensitiveFileRoot = path.join(tmp, "sensitive-config");
  await mkdir(path.join(savedProjectRoot, "docs"), { recursive: true });
  await writeFile(sensitiveFileRoot, "SECRET\n");
  await mkdir(path.join(openclawWorkspaceRoot, "agent-other", "private"), { recursive: true });
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
    true,
    "registration accepts paths outside $HOME (picker/native-dialog parity), saved or not",
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
    true,
    "late saved projects are registrable like any other non-root directory",
  );

  assert.equal(
    isAllowedNewProjectRoot("~"),
    false,
    "tilde project roots are checked after home-directory expansion; $HOME itself is never a project root",
  );
  assert.equal(
    isAllowedNewProjectRoot("~/secret"),
    true,
    "home-directory descendants are allowed as new project roots (matches the fs-browse folder picker boundary)",
  );

  // A real directory nested under $HOME is an allowed new-project root, since
  // the loopback-only folder picker can navigate there. Symlink-safe: the
  // check realpaths the candidate before containment.
  const homeChildProject = await mkdtemp(path.join(await realpath(homedir()), "coven-newproj-"));
  try {
    assert.equal(
      isAllowedNewProjectRoot(homeChildProject),
      true,
      "an existing directory under $HOME is an allowed new project root",
    );
  } finally {
    await rm(homeChildProject, { recursive: true, force: true });
  }

  // Registration matches the folder picker (and the desktop native dialog),
  // which can browse anywhere on the machine: paths outside $HOME are now
  // allowed. The projects POST route stays loopback-only, so this cannot be
  // reached from other tailnet devices.
  assert.equal(
    isAllowedNewProjectRoot(path.join(tmp, "outside-home")),
    true,
    "roots outside $HOME are allowed (native-dialog and picker parity; loopback-only)",
  );

  // Unbounded roots stay excluded: bare volume roots ("/", "C:\") and $HOME
  // itself can never be registered as a single project.
  assert.equal(
    isAllowedNewProjectRoot(path.parse(homedir()).root),
    false,
    "a bare volume root is never a project root",
  );

  // Case aliases of $HOME survive realpath on case-insensitive filesystems
  // (APFS/NTFS preserve the typed case), so the exclusion compares filesystem
  // identity (dev+ino), not strings. On a case-sensitive filesystem the alias
  // is a different (usually nonexistent) path and stays allowed like any
  // other outside-home folder.
  {
    const home = await realpath(homedir());
    const alias = path.join(path.dirname(home), path.basename(home).toUpperCase());
    let aliasIsHome = false;
    try {
      const [aliasStat, homeStat] = [await stat(alias, { bigint: true }), await stat(home, { bigint: true })];
      aliasIsHome = aliasStat.dev === homeStat.dev && aliasStat.ino === homeStat.ino;
    } catch {
      aliasIsHome = false;
    }
    assert.equal(
      isAllowedNewProjectRoot(alias),
      !aliasIsHome,
      aliasIsHome
        ? "a case alias of $HOME still names $HOME and must be rejected"
        : "on a case-sensitive filesystem a case variant is a different path and stays allowed",
    );
  }

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

  assert.equal(
    resolveAllowedProjectPath(path.join(openclawWorkspaceRoot, "agent-other", "private", "secrets.json")),
    null,
    "OpenClaw workspace roots are not globally allowed for generic project file/tree APIs",
  );

  // cave-s2l8: nonexistent candidates must canonicalize like the roots do.
  // With WORKSPACE_ROOT reached via a symlink (the shape of macOS's
  // /var -> /private/var tmpdir), a missing subpath used to fall back to a
  // lexical resolve, miss the realpathed root, and 403 before routes could
  // answer 404 "does not exist".
  const symlinkedWorkspaceTarget = path.join(tmp, "ws-target");
  await mkdir(symlinkedWorkspaceTarget, { recursive: true });
  const symlinkedWorkspace = path.join(tmp, "ws-link");
  await symlink(symlinkedWorkspaceTarget, symlinkedWorkspace, "junction");
  process.env.WORKSPACE_ROOT = symlinkedWorkspace;
  try {
    assert.equal(
      resolveAllowedProjectPath(path.join(symlinkedWorkspace, "missing", "sub")),
      path.join(await realpath(symlinkedWorkspaceTarget), "missing", "sub"),
      "a nonexistent subpath of a symlinked allowed root resolves canonically instead of failing containment",
    );
    // Tightening: a missing tail under a symlink escaping the root must not
    // lexically pass containment.
    await mkdir(path.join(tmp, "outside-home"), { recursive: true });
    await symlink(path.join(tmp, "outside-home"), path.join(symlinkedWorkspaceTarget, "escape"), "junction");
    assert.equal(
      resolveAllowedProjectPath(path.join(symlinkedWorkspace, "escape", "missing")),
      null,
      "a nonexistent tail under an escaping symlink is rejected, not lexically contained",
    );
  } finally {
    delete process.env.WORKSPACE_ROOT;
  }
} finally {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
}

console.log("project-paths.test.ts: ok");
