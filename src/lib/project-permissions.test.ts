// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = await mkdtemp(path.join(tmpdir(), "project-permissions-test-"));
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_SUPREME_FAMILIAR_ID = "supreme";

try {
  const {
    assertProjectAccess,
    bootstrapConfiguredFamiliarProjectGrants,
    bootstrapSupremeProjectGrants,
    canAccessProject,
    createGrantProposal,
    filterProjectsForFamiliar,
    grantProjectToFamiliar,
    loadProjectPermissions,
    ProjectAccessDeniedError,
  } = await import("./project-permissions.ts");

  const projects = [
    { id: "cave", name: "Cave", root: "/tmp/cave", createdAt: "now", updatedAt: "now" },
    { id: "docs", name: "Docs", root: "/tmp/docs", createdAt: "now", updatedAt: "now" },
  ];

  assert.equal(
    canAccessProject({ projectGrants: [] }, { familiarId: "nova" }, "cave", "supreme"),
    false,
    "familiars start without project access",
  );
  assert.equal(
    canAccessProject({ projectGrants: [] }, { familiarId: "supreme" }, "cave", "supreme"),
    true,
    "Supreme has implicit access to every project",
  );

  await grantProjectToFamiliar({ familiarId: "nova", projectId: "cave", source: "human" });
  const permissions = await loadProjectPermissions();
  assert.equal(
    canAccessProject(permissions, { familiarId: "nova" }, "cave", "supreme"),
    true,
    "a human-created grant allows the target project",
  );
  assert.deepEqual(
    (await filterProjectsForFamiliar(projects, "nova")).map((project) => project.id),
    ["cave"],
    "project picker results are filtered server-side for normal familiars",
  );
  assert.deepEqual(
    (await filterProjectsForFamiliar(projects, "supreme")).map((project) => project.id),
    ["cave", "docs"],
    "Supreme sees all projects",
  );

  await assertProjectAccess({ familiarId: "nova" }, "cave", "chat");
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "nova" }, "docs", "file-read"),
    (err) => err instanceof ProjectAccessDeniedError && err.status === 403,
    "missing grants fail closed with a 403 error",
  );
  const audited = await loadProjectPermissions();
  assert.equal(audited.permissionAudit.at(-2)?.decision, "allow", "allowed decisions are audited");
  assert.equal(audited.permissionAudit.at(-1)?.decision, "deny", "denied decisions are audited");

  const proposal = await createGrantProposal({
    proposedBy: "supreme",
    targetFamiliarId: "sage",
    projectId: "docs",
  });
  assert.equal(proposal.status, "pending", "Supreme can only draft pending grant proposals");
  await assert.rejects(
    () => createGrantProposal({
      proposedBy: "sage",
      targetFamiliarId: "sage",
      projectId: "docs",
    }),
    ProjectAccessDeniedError,
    "non-Supreme familiars cannot draft grant proposals",
  );
  await assert.rejects(
    () => createGrantProposal({
      proposedBy: "supreme",
      targetFamiliarId: "supreme",
      projectId: "docs",
    }),
    ProjectAccessDeniedError,
    "Supreme cannot draft self-grants",
  );
  await assert.rejects(
    () => createGrantProposal({
      proposedBy: "supreme",
      targetFamiliarId: "sage",
      projectId: "docs",
      claimedHumanApproval: true,
    }),
    ProjectAccessDeniedError,
    "relayed human approval is rejected",
  );

  await bootstrapSupremeProjectGrants(projects);
  const bootstrapped = await loadProjectPermissions();
  assert.deepEqual(
    bootstrapped.projectGrants
      .filter((grant) => grant.familiarId === "supreme")
      .map((grant) => [grant.projectId, grant.source]),
    [["cave", "bootstrap"], ["docs", "bootstrap"]],
    "bootstrap records Supreme grants for all existing projects",
  );

  const legacyTmp = await mkdtemp(path.join(tmpdir(), "project-permissions-legacy-"));
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(legacyTmp, "permissions.json");
  try {
    const changed = await bootstrapConfiguredFamiliarProjectGrants(projects, [
      "nova",
      "sage",
      "",
      "../bad",
    ]);
    assert.equal(changed, true, "legacy bootstrap should run once for empty grant stores");
    const legacyBootstrapped = await loadProjectPermissions();
    assert.deepEqual(
      legacyBootstrapped.projectGrants.map((grant) => [
        grant.familiarId,
        grant.projectId,
        grant.source,
      ]),
      [
        ["nova", "cave", "bootstrap"],
        ["nova", "docs", "bootstrap"],
        ["sage", "cave", "bootstrap"],
        ["sage", "docs", "bootstrap"],
      ],
      "legacy bootstrap grants every configured familiar to existing projects explicitly",
    );
    assert.ok(
      legacyBootstrapped.legacyConfiguredGrantsBootstrappedAt,
      "legacy bootstrap should record a migration marker",
    );
    assert.equal(
      await bootstrapConfiguredFamiliarProjectGrants(projects, ["cody"]),
      false,
      "legacy bootstrap should not run again after the marker is written",
    );
  } finally {
    await rm(legacyTmp, { recursive: true, force: true });
    process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
  }

  console.log("project-permissions.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
  delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
  delete process.env.CAVE_SUPREME_FAMILIAR_ID;
  await rm(tmp, { recursive: true, force: true });
}
