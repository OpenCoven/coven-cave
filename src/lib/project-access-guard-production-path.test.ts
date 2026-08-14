// @ts-nocheck
//
// Production-path deadlock proof for `withProjectAccessGuard` (cave-client-v1
// Task 5/7 followup #1). Deliberately does NOT set
// `CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE` / `CAVE_PROJECTS_PATH_OVERRIDE` /
// `CAVE_PERMISSION_CONFIG_PATH_OVERRIDE` — those overrides make
// `withProjectPermissionsStore`/`withProjectRegistryLock` skip the real
// cross-process reconciliation lock entirely (see the early-return guarded by
// those env vars in project-permissions.ts / cave-projects.ts), which would
// silently hide the exact deadlock this test exists to prove is fixed: the
// PREVIOUS `withProjectAccessGuard` held that SAME global reconciliation lock
// open across its own callback, so any callback that itself called
// `loadConfig`/`loadProjects`/`loadState` (as every real conversation
// create/PATCH/DELETE effect does) tried to re-acquire the exact lock its own
// guard was still holding — an unconditional deadlock. Only `COVEN_HOME`
// (real cave-home paths, real reconciliation, real dedicated
// `withProjectAuthorizationLock`) is set here, so this test exercises the
// production code path start to finish.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await mkdtemp(path.join(os.tmpdir(), "project-access-guard-production-path-"));
process.env.COVEN_HOME = tmp;
delete process.env.COVEN_CAVE_HOME;
delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
delete process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
delete process.env.CAVE_SUPREME_FAMILIAR_ID;
delete globalThis.__caveHomeMigration;

// A generous, but strictly bounded, timeout. The ORIGINAL bug was an
// unconditional deadlock — a callback awaiting `loadConfig()` while its own
// guard held the reconciliation lock never resolves at all — so any finite
// timeout here that is comfortably longer than real disk I/O proves the fix:
// this call either resolves well within it, or (if the regression came back)
// it would hang until the process's own test-runner timeout, not merely this
// race.
async function withDeadlockGuard<T>(label: string, promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: did not resolve within ${timeoutMs}ms — possible deadlock`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer!);
  }
}

try {
  const { loadConfig } = await import("./cave-config.ts");
  const {
    createProject,
    loadProjects,
    patchProject,
  } = await import("./cave-projects.ts");
  const {
    canAccessProject,
    grantProjectToFamiliar,
    loadProjectPermissions,
    repairOrphanProjectPermissions,
    deleteProjectAndRevokeGrants,
    revokeProjectFromFamiliar,
    withProjectAccessGuard,
  } = await import("./project-permissions.ts");

  // ── deadlock proof: the callback may load config/projects/state ─────────
  {
    const result = await withDeadlockGuard(
      "withProjectAccessGuard callback loading config+projects",
      withProjectAccessGuard(async (permissions) => {
        // Every one of these goes through the SAME global reconciliation
        // lock (`withCaveHomeReconciledStore`) the guard itself briefly used
        // to load `permissions` above — under the previous implementation,
        // the guard held that lock open across this very callback, so these
        // calls would have hung forever.
        const config = await loadConfig();
        const projects = await loadProjects();
        return { hasPermissions: Boolean(permissions), hasConfig: Boolean(config), projectCount: projects.length };
      }),
    );
    assert.equal(result.hasPermissions, true, "the guard's callback receives a real permissions snapshot");
    assert.equal(result.hasConfig, true, "loadConfig() from inside the guarded callback must resolve, not deadlock");
    assert.equal(result.projectCount, 0, "a fresh cave home starts with no registered projects");
  }

  // Orphan repair snapshots registry and permissions in sequence under the
  // authority lock; it never nests one reconciliation callback in another.
  {
    await grantProjectToFamiliar({
      familiarId: "orphan-repair",
      projectId: "missing-project",
      source: "human",
      access: "read",
    });
    const repaired = await withDeadlockGuard(
      "production orphan permission repair",
      repairOrphanProjectPermissions(),
    );
    assert.equal(repaired.directGrants, 1);
    assert.deepEqual(repaired.orphanProjectIds, ["missing-project"]);
  }

  // Registry create/re-root/delete use the same authorization lock as guarded
  // effects, with authorization outermost and reconciliation inside.
  {
    const reRootTarget = await createProject({ name: "Re-root", root: "/authority/re-root-before" });
    const deleteTarget = await createProject({ name: "Delete", root: "/authority/delete" });
    let releaseGuard!: () => void;
    let enteredGuard!: () => void;
    const entered = new Promise<void>((resolve) => { enteredGuard = resolve; });
    const gate = new Promise<void>((resolve) => { releaseGuard = resolve; });
    const guard = withProjectAccessGuard(async () => {
      enteredGuard();
      await gate;
    });
    await entered;

    let createSettled = false;
    let patchSettled = false;
    let deleteSettled = false;
    const creating = createProject({ name: "Create", root: "/authority/create" })
      .then((value) => { createSettled = true; return value; });
    const patching = patchProject(reRootTarget.id, { root: "/authority/re-root-after" })
      .then((value) => { patchSettled = true; return value; });
    const deleting = deleteProjectAndRevokeGrants(deleteTarget.id)
      .then((value) => { deleteSettled = true; return value; });

    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.deepEqual(
      [createSettled, patchSettled, deleteSettled],
      [false, false, false],
      "create, re-root, and delete all wait behind an in-flight authorization effect",
    );
    releaseGuard();
    await guard;
    const [created, patched, deleted] = await Promise.all([creating, patching, deleting]);
    assert.equal(created.root, "/authority/create");
    assert.equal(patched?.root, "/authority/re-root-after");
    assert.equal(deleted.deleted, true);
  }

  // ── revocation still blocks through an in-flight effect, in production
  //    mode ───────────────────────────────────────────────────────────────
  {
    await grantProjectToFamiliar({ familiarId: "prod-barrier-fam", projectId: "cave", source: "human", access: "read" });

    const order: string[] = [];
    let releaseGuard: () => void;
    const guardGate = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });

    const guardPromise = withDeadlockGuard(
      "withProjectAccessGuard revocation-barrier callback",
      withProjectAccessGuard(async (permissions) => {
        order.push("guard-start");
        // A real production-path effect also reloads config — proving the
        // dedicated lock ordering (dedicated OUTER, reconciliation released
        // before this point) holds even while a concurrent revocation is
        // queued behind this same dedicated lock.
        await loadConfig();
        const accessAtEntry = canAccessProject(permissions, { familiarId: "prod-barrier-fam" }, "cave");
        await guardGate;
        order.push("guard-end");
        return accessAtEntry;
      }),
    );

    while (order.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

    let revokeSettled = false;
    const revokePromise = revokeProjectFromFamiliar({ familiarId: "prod-barrier-fam", projectId: "cave" }).then(
      (value) => {
        revokeSettled = true;
        return value;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(
      revokeSettled,
      false,
      "a revocation racing a still-running guard callback must queue behind the dedicated authorization lock",
    );
    assert.deepEqual(order, ["guard-start"], "the guard callback must still be blocked mid-flight");

    releaseGuard();
    const [guardResult, revokeResult] = await Promise.all([guardPromise, revokePromise]);
    assert.equal(guardResult, true, "the in-flight effect observed access as still granted at entry");
    assert.equal(revokeResult, true, "the revoke completed once unblocked");
    assert.deepEqual(order, ["guard-start", "guard-end"]);

    const deniedAfter = await withDeadlockGuard(
      "post-revocation withProjectAccessGuard",
      withProjectAccessGuard(async (permissions) =>
        canAccessProject(permissions, { familiarId: "prod-barrier-fam" }, "cave"),
      ),
    );
    assert.equal(deniedAfter, false, "a guard entered after a completed revocation observes the revoked state");
  }

  const finalPermissions = await loadProjectPermissions();
  assert.ok(finalPermissions, "the permissions store remains loadable after the production-path exercise");

  console.log("project-access-guard-production-path.test.ts: ok");
} finally {
  delete process.env.COVEN_HOME;
  delete globalThis.__caveHomeMigration;
  await rm(tmp, { recursive: true, force: true });
}
