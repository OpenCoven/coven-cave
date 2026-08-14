// @ts-nocheck
// Durable legacy normalization (authority finding): strict project/permission
// readers must detect a REAL on-disk legacy schema — missing
// `visibilityGeneration` — from the parsed file contents, never from
// `caveHomeStoreNeedsRecoveryNormalization`'s process-local `globalThis`
// recovery marker and never from the file having been absent. These tests
// prove that holds in the two situations a process-local marker structurally
// cannot cover:
//
//   1. Cold start: a legacy-schema file already sits at the canonical path
//      (e.g. `<coven>/cave/projects.json`) with no legacy-path entry ever
//      existing, so `migrateCaveHome` never ran a "moved" decision for it and
//      never had a reason to touch the marker.
//   2. Cross-process: a DIFFERENT process performs the physical cave-home
//      migration move (legacy path -> canonical path, bytes verbatim, still
//      legacy schema) and exits — its in-memory marker dies with it. This
//      process never called `migrateCaveHome` for that entry at all, so the
//      marker is unset here too, yet the read must still normalize correctly
//      from content alone.
//
// Both scenarios run in real, separate `node` subprocesses (not merely a
// reset of this process's own globals) so there is no possibility of shared
// in-memory state making the proof accidental.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const roots: string[] = [];
async function freshCovenHome(name: string): Promise<{ coven: string; cave: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), `cave-legacy-normalization-${name}-`));
  roots.push(root);
  const coven = path.join(root, ".coven");
  await mkdir(coven, { recursive: true });
  return { coven, cave: path.join(coven, "cave") };
}

function childEnvFor(coven: string): NodeJS.ProcessEnv {
  const env = { ...process.env, COVEN_HOME: coven };
  delete env.COVEN_CAVE_HOME;
  delete env.CAVE_PROJECTS_PATH_OVERRIDE;
  delete env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
  delete env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
  return env;
}

async function runChild(script: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/test-alias-register.mjs",
      "--input-type=module",
      "--eval",
      script,
    ],
    { cwd: process.cwd(), env, windowsHide: true },
  );
  return stdout;
}

const projectsModuleUrl = pathToFileURL(path.resolve("src/lib/cave-projects.ts")).href;
const permissionsModuleUrl = pathToFileURL(path.resolve("src/lib/project-permissions.ts")).href;
const migrationModuleUrl = pathToFileURL(path.resolve("src/lib/server/cave-home-migration.ts")).href;
const readModelModuleUrl = pathToFileURL(path.resolve("src/lib/server/client-v1/read-model.ts")).href;

function legacyProjectsJson(): string {
  return JSON.stringify({
    version: 1,
    projects: [
      {
        id: "legacy-project",
        name: "Legacy",
        root: "/tmp/legacy-project",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
  });
}

function legacyPermissionsJson(): string {
  return JSON.stringify({
    version: 2,
    projectGrants: [
      {
        familiarId: "supreme",
        projectId: "legacy-project",
        access: "write",
        source: "human",
        grantedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
    accessGroups: [],
    grantProposals: [],
    permissionAudit: [],
    grantAudit: [],
    repairAudit: [],
  });
}

function legacyV1PermissionsJson(): string {
  return JSON.stringify({
    version: 1,
    projectGrants: [
      {
        familiarId: "supreme",
        projectId: "legacy-project",
        source: "human",
        grantedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
    grantProposals: [],
    permissionAudit: [],
  });
}

/** The read/normalize/report script shared by both scenarios below. */
function readerScript(): string {
  return `
    const { loadProjects, projectsVisibilityGeneration } = await import(${JSON.stringify(projectsModuleUrl)});
    const { loadProjectPermissions, projectPermissionsVisibilityGeneration } = await import(${JSON.stringify(permissionsModuleUrl)});
    const { canonicalSessionListCacheKey } = await import(${JSON.stringify(readModelModuleUrl)});
    const projects = await loadProjects();
    const permissions = await loadProjectPermissions();
    const projectGeneration = await projectsVisibilityGeneration();
    const permissionGeneration = await projectPermissionsVisibilityGeneration();
    const legacyKey = canonicalSessionListCacheKey(false, "supreme", false, ["unversioned", "unversioned"]);
    const freshKey = canonicalSessionListCacheKey(false, "supreme", false, [permissionGeneration, projectGeneration]);
    process.stdout.write(JSON.stringify({
      projectIds: projects.map((p) => p.id),
      grantProjectIds: permissions.projectGrants.map((g) => g.projectId),
      projectGeneration,
      permissionGeneration,
      keysDiffer: legacyKey !== freshKey,
    }));
  `;
}

try {
  // ─── cold start: legacy-schema files already at the canonical path ──────
  {
    const { coven, cave } = await freshCovenHome("cold-start");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "projects.json"), legacyProjectsJson(), "utf8");
    await writeFile(path.join(cave, "project-permissions.json"), legacyPermissionsJson(), "utf8");

    const stdout = await runChild(readerScript(), childEnvFor(coven));
    const result = JSON.parse(stdout);

    assert.deepEqual(
      result.projectIds,
      ["legacy-project"],
      "a cold start normalizes a legacy-schema project registry already sitting at the canonical path",
    );
    assert.deepEqual(
      result.grantProjectIds,
      ["legacy-project"],
      "a cold start normalizes a legacy-schema permission store already sitting at the canonical path",
    );
    assert.notEqual(result.projectGeneration, "unversioned");
    assert.notEqual(result.projectGeneration, "missing");
    assert.notEqual(result.permissionGeneration, "unversioned");
    assert.notEqual(result.permissionGeneration, "missing");
    assert.equal(
      result.keysDiffer,
      true,
      "normalizing a cold-start legacy store changes the canonical sessions-list cache key",
    );

    const persistedProjects = JSON.parse(await readFile(path.join(cave, "projects.json"), "utf8"));
    const persistedPermissions = JSON.parse(await readFile(path.join(cave, "project-permissions.json"), "utf8"));
    assert.equal(typeof persistedProjects.visibilityGeneration, "string");
    assert.notEqual(persistedProjects.visibilityGeneration, "unversioned");
    assert.equal(typeof persistedPermissions.visibilityGeneration, "string");
    assert.notEqual(persistedPermissions.visibilityGeneration, "unversioned");
  }

  // ─── v1 cold restart and concurrent migration ───────────────────────────
  {
    const { coven, cave } = await freshCovenHome("v1-restart-and-concurrency");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "project-permissions.json"), legacyV1PermissionsJson(), "utf8");

    // Neither fresh reader owns a process-local recovery marker. They start
    // together so the authorization lock must elect exactly one migrator; the
    // other observes the same durable v2 generation after the atomic replace.
    const [firstStdout, secondStdout] = await Promise.all([
      runChild(readerScript(), childEnvFor(coven)),
      runChild(readerScript(), childEnvFor(coven)),
    ]);
    const first = JSON.parse(firstStdout);
    const second = JSON.parse(secondStdout);
    assert.deepEqual(first.grantProjectIds, ["legacy-project"]);
    assert.deepEqual(second.grantProjectIds, ["legacy-project"]);
    assert.equal(
      first.permissionGeneration,
      second.permissionGeneration,
      "concurrent v1 migrators converge on the single generation durably written by the lock winner",
    );

    const persistedPermissions = JSON.parse(await readFile(path.join(cave, "project-permissions.json"), "utf8"));
    assert.equal(persistedPermissions.version, 2, "a v1 store is persisted as v2 after a restart");
    assert.equal(persistedPermissions.projectGrants[0]?.access, "write");
    assert.equal(
      persistedPermissions.visibilityGeneration,
      first.permissionGeneration,
      "the persisted v1 migration generation is the one all concurrent readers observe",
    );

    const restartResult = JSON.parse(await runChild(readerScript(), childEnvFor(coven)));
    assert.equal(
      restartResult.permissionGeneration,
      first.permissionGeneration,
      "a later restart without recovery state does not migrate or rotate the v1 generation again",
    );
  }

  // ─── cross-process: another process performed the migration move; this
  //     process never ran it and has no recovery marker for it ────────────
  {
    const { coven, cave } = await freshCovenHome("cross-process");
    await writeFile(path.join(coven, "cave-projects.json"), legacyProjectsJson(), "utf8");
    await writeFile(path.join(coven, "cave-project-permissions.json"), legacyV1PermissionsJson(), "utf8");

    const moverScript = `
      const { migrateCaveHomeOnce } = await import(${JSON.stringify(migrationModuleUrl)});
      const result = await migrateCaveHomeOnce();
      process.stdout.write(JSON.stringify({ moved: result.moved, errors: result.errors.length }));
    `;
    const moverStdout = await runChild(moverScript, childEnvFor(coven));
    const moverResult = JSON.parse(moverStdout);
    assert.ok(
      moverResult.moved.includes("cave-projects.json"),
      "the mover subprocess actually performed the physical move for the project registry",
    );
    assert.ok(
      moverResult.moved.includes("cave-project-permissions.json"),
      "the mover subprocess actually performed the physical move for the permission store",
    );
    assert.equal(moverResult.errors, 0, "the migration move itself must not fail");

    // The canonical files now hold the legacy schema verbatim — a byte-for-
    // byte physical move never rewrites content — and the mover process, the
    // ONLY process whose in-memory recovery marker was ever set for this
    // entry, has already exited. This test's own process never called
    // `migrateCaveHome` for this cave home at all, so it has no marker
    // either; the reader subprocess below is a THIRD, entirely separate
    // process with its own empty `globalThis` state.
    const readerStdout = await runChild(readerScript(), childEnvFor(coven));
    const readerResult = JSON.parse(readerStdout);

    assert.deepEqual(
      readerResult.projectIds,
      ["legacy-project"],
      "a fresh process with no recovery marker still normalizes a project registry another process physically migrated",
    );
    assert.deepEqual(
      readerResult.grantProjectIds,
      ["legacy-project"],
      "a fresh process with no recovery marker still normalizes a permission store another process physically migrated",
    );
    assert.notEqual(readerResult.projectGeneration, "unversioned");
    assert.notEqual(readerResult.permissionGeneration, "unversioned");
    assert.equal(
      readerResult.keysDiffer,
      true,
      "normalizing a legacy store changes the canonical sessions-list cache key even across a real process boundary",
    );

    const persistedProjects = JSON.parse(await readFile(path.join(cave, "projects.json"), "utf8"));
    const persistedPermissions = JSON.parse(await readFile(path.join(cave, "project-permissions.json"), "utf8"));
    assert.notEqual(persistedProjects.visibilityGeneration, "unversioned");
    assert.notEqual(persistedPermissions.visibilityGeneration, "unversioned");
  }

  console.log("cave-home-legacy-normalization-subprocess.test.ts: ok");
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
