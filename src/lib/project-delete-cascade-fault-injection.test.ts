// @ts-nocheck
// Recoverable project delete cascade (authority finding): within the
// project-authorization critical section, permission cleanup (direct grants,
// group grants, proposals) must run BEFORE the registry entry is deleted, so
//
//   - a cleanup failure leaves the registry completely untouched, and
//   - a registry-deletion failure AFTER cleanup succeeds leaves the project
//     registered-but-fail-closed (every grant already gone) rather than lost
//     or 404'd, and a retry finds it and completes the deletion,
//
// and no orphan grant is ever left referencing a project that has actually
// been removed from the registry. These tests inject a real write failure
// into each phase independently by putting the two stores in SEPARATE
// directories and `chmod`-ing just one of them read-only at a time — the
// same fault-injection technique `x-sources.test.ts` uses — so a failure in
// one store's write can never be mistaken for a failure in the other's.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "project-delete-cascade-"));
const projectsDir = path.join(root, "projects-store");
const permissionsDir = path.join(root, "permissions-store");
await mkdir(projectsDir, { recursive: true });
await mkdir(permissionsDir, { recursive: true });

const projectsPath = path.join(projectsDir, "projects.json");
const permissionsPath = path.join(permissionsDir, "project-permissions.json");

process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = permissionsPath;
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(root, "permission-config.json");
process.env.CAVE_SUPREME_FAMILIAR_ID = "supreme";

const { setProjectAuthorizationLockDbPathForTest } = await import(
  "./server/project-authorization-lock.ts"
);
// The project-authorization lock's SQLite sidecar normally lives right next
// to the permissions store file (`<storePath>.authz-lock.sqlite3`), and
// re-opening it on every acquisition can need to recreate its own
// `-wal`/`-shm` files — which itself requires directory write permission.
// Left alone, `chmod`-ing either store's directory read-only below would
// make lock ACQUISITION fail too, so an "injected cleanup/registry write
// failure" test would really just be testing lock bootstrap instead. Pointing
// the lock db at a dedicated, always-writable directory (the documented
// test-only seam for exactly this) isolates the fault to the single store
// write each scenario actually targets.
setProjectAuthorizationLockDbPathForTest(() => path.join(root, "authz-lock.sqlite3"));

try {
  const {
    createAccessGroup,
    createGrantProposal,
    deleteProjectAndRevokeGrants,
    grantProjectToFamiliar,
  } = await import("./project-permissions.ts");

  async function seedProject(id) {
    await writeFile(
      projectsPath,
      JSON.stringify({
        version: 1,
        projects: [{ id, name: id, root: `/tmp/${id}`, createdAt: "now", updatedAt: "now" }],
        visibilityGeneration: "fixture",
      }),
      "utf8",
    );
  }

  async function readProjectIds() {
    const raw = JSON.parse(await readFile(projectsPath, "utf8"));
    return raw.projects.map((project) => project.id);
  }

  async function readPermissionsSnapshot() {
    const raw = JSON.parse(await readFile(permissionsPath, "utf8"));
    return {
      directGrantProjectIds: raw.projectGrants.map((grant) => grant.projectId),
      groupGrantProjectIds: raw.accessGroups.flatMap((group) =>
        group.projectGrants.map((grant) => grant.projectId),
      ),
      proposalProjectIds: raw.grantProposals.map((proposal) => proposal.projectId),
    };
  }

  // ── phase 1: cleanup failure leaves the registry completely untouched ──
  {
    await seedProject("proj-cleanup-fault");
    // Prime the lock database and every store file BEFORE either directory
    // is made read-only, so the fault injected below is unambiguously a
    // failure inside the cleanup write itself, not a side effect of the
    // authorization lock (which lives alongside the permissions store)
    // failing to bootstrap its own sidecar files for the first time.
    await grantProjectToFamiliar({
      familiarId: "nova",
      projectId: "proj-cleanup-fault",
      source: "human",
      access: "write",
    });
    await createAccessGroup({
      name: "cleanup-fault-group",
      memberFamiliarIds: ["sage"],
      projectGrants: [{ projectId: "proj-cleanup-fault", access: "read" }],
    });
    await createGrantProposal({
      proposedBy: "supreme",
      targetFamiliarId: "charm",
      projectId: "proj-cleanup-fault",
    });

    const beforeProjects = await readProjectIds();
    const beforePermissions = await readPermissionsSnapshot();
    assert.ok(beforeProjects.includes("proj-cleanup-fault"));
    assert.ok(beforePermissions.directGrantProjectIds.includes("proj-cleanup-fault"));
    assert.ok(beforePermissions.groupGrantProjectIds.includes("proj-cleanup-fault"));
    assert.ok(beforePermissions.proposalProjectIds.includes("proj-cleanup-fault"));

    await chmod(permissionsDir, 0o500);
    try {
      await assert.rejects(
        () => deleteProjectAndRevokeGrants("proj-cleanup-fault"),
        /EACCES|EPERM|permission/i,
        "an injected write failure during permission cleanup must surface, not be swallowed",
      );
    } finally {
      await chmod(permissionsDir, 0o700);
    }

    const afterProjects = await readProjectIds();
    const afterPermissions = await readPermissionsSnapshot();
    assert.deepEqual(
      afterProjects,
      beforeProjects,
      "the registry must remain completely untouched when permission cleanup fails",
    );
    assert.deepEqual(
      afterPermissions,
      beforePermissions,
      "no partial cleanup may land when the cleanup write itself fails",
    );

    // Clean up this scenario's fixture before the next one.
    await chmod(permissionsDir, 0o700);
    const retry = await deleteProjectAndRevokeGrants("proj-cleanup-fault");
    assert.equal(retry.deleted, true);
    assert.deepEqual(retry.cleaned, { grants: 1, groupGrants: 1, proposals: 1 });
  }

  // ── phase 2: registry-deletion failure after cleanup succeeds leaves the
  //    project registered-but-fail-closed, never lost, never orphaned; a
  //    retry finds it and completes the deletion ──────────────────────────
  {
    await seedProject("proj-registry-fault");
    await grantProjectToFamiliar({
      familiarId: "nova",
      projectId: "proj-registry-fault",
      source: "human",
      access: "write",
    });
    await createAccessGroup({
      name: "registry-fault-group",
      memberFamiliarIds: ["sage"],
      projectGrants: [{ projectId: "proj-registry-fault", access: "read" }],
    });
    await createGrantProposal({
      proposedBy: "supreme",
      targetFamiliarId: "charm",
      projectId: "proj-registry-fault",
    });

    await chmod(projectsDir, 0o500);
    try {
      await assert.rejects(
        () => deleteProjectAndRevokeGrants("proj-registry-fault"),
        /EACCES|EPERM|permission/i,
        "an injected write failure during the registry delete (after cleanup succeeded) must surface — never a false 404",
      );
    } finally {
      await chmod(projectsDir, 0o700);
    }

    // Cleanup already ran and must have fully landed — fail-closed: nobody
    // can act on this project while its deletion is stuck mid-flight.
    const midFailurePermissions = await readPermissionsSnapshot();
    assert.equal(midFailurePermissions.directGrantProjectIds.includes("proj-registry-fault"), false);
    assert.equal(midFailurePermissions.groupGrantProjectIds.includes("proj-registry-fault"), false);
    assert.equal(midFailurePermissions.proposalProjectIds.includes("proj-registry-fault"), false);

    // The project itself must NOT be lost — it remains registered so a
    // retry can find it by id and finish the job, instead of the caller
    // ever seeing an unrecoverable 404 while its grants are already gone.
    const midFailureProjects = await readProjectIds();
    assert.ok(
      midFailureProjects.includes("proj-registry-fault"),
      "the project must remain registered when only the registry delete fails after cleanup",
    );

    // Retry, with the fault cleared: cleanup is a safe no-op (already fully
    // cleaned above) and the registry delete now completes.
    const retry = await deleteProjectAndRevokeGrants("proj-registry-fault");
    assert.equal(retry.deleted, true, "a retry after the fault clears must complete the deletion");
    assert.deepEqual(
      retry.cleaned,
      { grants: 0, groupGrants: 0, proposals: 0 },
      "the retry's cleanup pass is a true no-op — nothing was left to clean, proving no work was silently repeated or lost",
    );

    const finalProjects = await readProjectIds();
    const finalPermissions = await readPermissionsSnapshot();
    assert.equal(finalProjects.includes("proj-registry-fault"), false, "the project is gone once the retry completes");
    assert.equal(finalPermissions.directGrantProjectIds.includes("proj-registry-fault"), false);
    assert.equal(finalPermissions.groupGrantProjectIds.includes("proj-registry-fault"), false);
    assert.equal(finalPermissions.proposalProjectIds.includes("proj-registry-fault"), false);
  }

  // ── a project that was never registered (or already fully removed) is
  //    reported as not-found without touching anything, and never runs
  //    cleanup against a project id nothing ever referenced ─────────────
  {
    const before = await readPermissionsSnapshot();
    const result = await deleteProjectAndRevokeGrants("proj-never-existed");
    assert.deepEqual(result, { deleted: false, cleaned: null });
    const after = await readPermissionsSnapshot();
    assert.deepEqual(before, after, "a not-found delete must never touch the permission store");
  }

  console.log("project-delete-cascade-fault-injection.test.ts: ok");
} finally {
  setProjectAuthorizationLockDbPathForTest(null);
  await chmod(projectsDir, 0o700).catch(() => {});
  await chmod(permissionsDir, 0o700).catch(() => {});
}
