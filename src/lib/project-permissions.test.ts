// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = await mkdtemp(path.join(tmpdir(), "project-permissions-test-"));
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
process.env.CAVE_SUPREME_FAMILIAR_ID = "supreme";

try {
  const {
    assertProjectAccess,
    assertProjectRootAccess,
    bootstrapSupremeProjectGrants,
    canAccessProject,
    createAccessGroup,
    createGrantProposal,
    deleteAccessGroup,
    effectiveProjectAccess,
    filterFamiliarsForProject,
    filterProjectsForFamiliar,
    grantProjectToFamiliar,
    revokeAllGrantsForProject,
    revokeProjectFromFamiliar,
    inspectProjectPermissionIntegrity,
    repairOrphanProjectPermissions,
    listProjectGrants,
    listAccessibleProjects,
    loadHumanPermissionConfig,
    loadMobileWriteAccess,
    loadProjectPermissions,
    requiredAccessLevel,
    resolveGrantProposal,
    undoGrantProposal,
    updateAccessGroup,
    updateMobileWriteAccess,
    withProjectAccessGuard,
    GRANT_ACCEPT_UNDO_WINDOW_MS,
    ProjectAccessDeniedError,
    ProjectPermissionsIntegrityError,
  } = await import("./project-permissions.ts");
  const { withProjectRegistryLock } = await import("./cave-projects.ts");

  const projects = [
    { id: "cave", name: "Cave", root: "/tmp/cave", createdAt: "now", updatedAt: "now" },
    { id: "docs", name: "Docs", root: "/tmp/docs", createdAt: "now", updatedAt: "now" },
  ];
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({ version: 1, projects, visibilityGeneration: "projects-fixture" }),
    "utf8",
  );

  assert.equal(
    canAccessProject({ projectGrants: [] }, { familiarId: "nova" }, "cave"),
    false,
    "familiars start without project access",
  );
  assert.equal(
    canAccessProject({ projectGrants: [] }, { familiarId: "supreme" }, "cave"),
    false,
    "the Supreme familiar id is not an implicit bearer token for project access",
  );

  await writeFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, '{"version":2,"projectGrants":[', "utf8");
  await assert.rejects(
    () => loadProjectPermissions(),
    ProjectPermissionsIntegrityError,
    "a torn permission store fails closed instead of granting from an empty default",
  );
  const tornPermissions = await readFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, "utf8");
  await assert.rejects(
    () => grantProjectToFamiliar({ familiarId: "must-not-land", projectId: "cave", source: "human" }),
    ProjectPermissionsIntegrityError,
    "a mutation cannot overwrite a torn permission store",
  );
  assert.equal(
    await readFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, "utf8"),
    tornPermissions,
  );
  await writeFile(
    process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE,
    JSON.stringify({
      version: 2,
      projectGrants: [],
      accessGroups: [],
      grantProposals: [],
      permissionAudit: [],
      grantAudit: [],
      repairAudit: [],
      visibilityGeneration: 42,
    }),
    "utf8",
  );
  await assert.rejects(
    () => loadProjectPermissions(),
    ProjectPermissionsIntegrityError,
    "a wrong-schema permission store fails closed",
  );
  await writeFile(
    process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE,
    JSON.stringify({
      version: 2,
      projectGrants: [{
        familiarId: "strict",
        projectId: "cave",
        access: "read",
        source: "human",
        grantedAt: "now",
        unexpectedAuthorityField: true,
      }],
      accessGroups: [],
      grantProposals: [],
      permissionAudit: [],
      grantAudit: [],
      repairAudit: [],
      visibilityGeneration: "strict-generation",
    }),
    "utf8",
  );
  await assert.rejects(
    () => loadProjectPermissions(),
    ProjectPermissionsIntegrityError,
    "unknown nested permission keys fail strict schema validation",
  );
  await chmod(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, 0o000);
  await assert.rejects(
    () => loadProjectPermissions(),
    ProjectPermissionsIntegrityError,
    "an unreadable permission store fails closed",
  );
  await chmod(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, 0o600);
  await rm(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, { force: true });

  await grantProjectToFamiliar({ familiarId: "nova", projectId: "cave", source: "human" });
  const permissions = await loadProjectPermissions();
  assert.equal(
    canAccessProject(permissions, { familiarId: "nova" }, "cave"),
    true,
    "a human-created grant allows the target project",
  );
  assert.deepEqual(
    (await filterProjectsForFamiliar(projects, "nova")).map((project) => project.id),
    ["cave"],
    "project picker results are filtered server-side for normal familiars",
  );
  assert.deepEqual(
    filterFamiliarsForProject(permissions, [{ id: "nova" }, { id: "sage" }], "cave"),
    [{ id: "nova" }],
    "familiar picker results use session-launch access for the selected project",
  );
  assert.deepEqual(
    (await filterProjectsForFamiliar(projects, "supreme")).map((project) => project.id),
    [],
    "the Supreme familiar id only sees explicitly granted projects",
  );

  await assertProjectAccess({ familiarId: "nova" }, "cave", "chat");
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "nova" }, "docs", "file-read"),
    (err) => err instanceof ProjectAccessDeniedError && err.status === 403,
    "missing grants fail closed with a 403 error",
  );
  await assert.rejects(
    () => assertProjectRootAccess({ familiarId: "nova" }, "/tmp/cave/subdir", "chat"),
    (err) => err instanceof ProjectAccessDeniedError && err.status === 403,
    "unregistered roots, including subdirectories of registered projects, fail closed",
  );
  await assertProjectRootAccess({ familiarId: "nova" }, "/tmp/cave/subdir", "chat", {
    allowUnregisteredRoot: true,
  });
  const audited = await loadProjectPermissions();
  assert.equal(audited.permissionAudit.at(-3)?.decision, "allow", "allowed decisions are audited");
  assert.equal(audited.permissionAudit.at(-2)?.decision, "deny", "denied decisions are audited");
  assert.equal(audited.permissionAudit.at(-1)?.projectId, "unregistered:/tmp/cave/subdir", "unregistered root denials are audited");

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
  assert.deepEqual(
    (await filterProjectsForFamiliar(projects, "supreme")).map((project) => project.id),
    ["cave", "docs"],
    "bootstrapped Supreme project access is backed by explicit grants",
  );
  assert.deepEqual(
    bootstrapped.projectGrants
      .filter((grant) => grant.familiarId !== "supreme")
      .map((grant) => grant.familiarId),
    ["nova"],
    "bootstrap must not grant every configured familiar to existing projects",
  );

  // --- Access levels ---------------------------------------------------------

  assert.equal(requiredAccessLevel("file-write"), "write", "file-write demands write");
  assert.equal(requiredAccessLevel("shell"), "write", "shell demands write");
  for (const surface of ["chat", "session-launch", "file-browse", "file-read", "project-api", "mobile", "project-picker"]) {
    assert.equal(requiredAccessLevel(surface), "read", `${surface} demands only read`);
  }

  assert.equal(
    (await loadProjectPermissions()).projectGrants.every((grant) => grant.access === "write"),
    true,
    "level-less grants (v1) migrate as write",
  );

  // A structurally exact v1 file at the canonical path is a durable migration
  // authority, even without a process-local cave-home recovery marker.
  const { writeFile: writeRaw } = await import("node:fs/promises");
  const v1Path = path.join(tmp, "v1-permissions.json");
  const v1Raw = JSON.stringify({
    version: 1,
    projectGrants: [{ familiarId: "old", projectId: "cave", source: "human", grantedAt: "2024-01-01T00:00:00.000Z" }],
    grantProposals: [{
      id: "legacy-pending",
      proposedBy: "supreme",
      targetFamiliarId: "old",
      projectId: "docs",
      status: "pending",
      createdAt: "2024-01-01T00:00:00.000Z",
    }],
    permissionAudit: [{
      id: "legacy-audit",
      at: "2024-01-01T00:00:00.000Z",
      familiarId: "old",
      projectId: "cave",
      surface: "chat",
      decision: "allow",
      reason: "grant",
    }],
  }, null, 2);
  await writeRaw(v1Path, v1Raw, "utf8");
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = v1Path;
  const migratedV1 = await loadProjectPermissions();
  assert.equal(migratedV1.version, 2, "a valid v1 permission store migrates to v2");
  assert.deepEqual(
    migratedV1.projectGrants,
    [{
      familiarId: "old",
      projectId: "cave",
      source: "human",
      grantedAt: "2024-01-01T00:00:00.000Z",
      access: "write",
    }],
    "v1 binary grants retain their authority as v2 write grants",
  );
  assert.equal(migratedV1.grantProposals[0]?.access, "write", "v1 proposals retain write semantics");
  assert.notEqual(migratedV1.visibilityGeneration, "missing", "migration writes one durable visibility generation");
  assert.equal(
    (await loadProjectPermissions()).visibilityGeneration,
    migratedV1.visibilityGeneration,
    "an ordinary post-migration load does not rotate the visibility generation",
  );
  const migratedV1OnDisk = JSON.parse(await readFile(v1Path, "utf8"));
  assert.deepEqual(
    migratedV1OnDisk,
    migratedV1,
    "the migrated v1 store is atomically persisted in current v2 shape",
  );

  const malformedV1Path = path.join(tmp, "malformed-v1-permissions.json");
  const malformedV1Raw = JSON.stringify({
    version: 1,
    projectGrants: [{
      familiarId: "attacker",
      projectId: "cave",
      source: "human",
      grantedAt: "2024-01-01T00:00:00.000Z",
      access: "write",
    }],
    grantProposals: [],
    permissionAudit: [],
  }, null, 2);
  await writeRaw(malformedV1Path, malformedV1Raw, "utf8");
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = malformedV1Path;
  await assert.rejects(
    () => loadProjectPermissions(),
    (error) => error instanceof ProjectPermissionsIntegrityError && /invalid version schema/.test(error.message),
    "a v1-shaped store with extra authority fields fails closed",
  );
  assert.equal(
    await readFile(malformedV1Path, "utf8"),
    malformedV1Raw,
    "a malformed v1 store remains unchanged after rejection",
  );

  const validV2Path = path.join(tmp, "valid-v2-permissions.json");
  const validV2Raw = JSON.stringify({
    version: 2,
    projectGrants: [],
    accessGroups: [],
    grantProposals: [],
    permissionAudit: [],
    grantAudit: [],
    repairAudit: [],
    visibilityGeneration: "valid-v2-generation",
  }, null, 2);
  await writeRaw(validV2Path, validV2Raw, "utf8");
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = validV2Path;
  assert.equal(
    (await loadProjectPermissions()).visibilityGeneration,
    "valid-v2-generation",
    "a current v2 store loads without migration",
  );
  assert.equal(
    await readFile(validV2Path, "utf8"),
    validV2Raw,
    "an already-current v2 store is byte-for-byte unchanged",
  );

  const acceptingInjectionPath = path.join(tmp, "accepting-injection-permissions.json");
  const acceptingInjectionRaw = JSON.stringify({
    version: 2,
    projectGrants: [],
    accessGroups: [],
    grantProposals: [{
      id: "injected",
      proposedBy: "supreme",
      targetFamiliarId: "attacker",
      projectId: "cave",
      access: "write",
      status: "accepting",
      createdAt: "2024-01-01T00:00:00.000Z",
    }],
    permissionAudit: [],
    grantAudit: [],
    repairAudit: [],
    visibilityGeneration: "injection-generation",
  }, null, 2);
  await writeRaw(acceptingInjectionPath, acceptingInjectionRaw, "utf8");
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = acceptingInjectionPath;
  await assert.rejects(
    () => loadProjectPermissions(),
    ProjectPermissionsIntegrityError,
    "an accepting proposal without a verified deadline cannot materialize a grant",
  );
  assert.equal(
    await readFile(acceptingInjectionPath, "utf8"),
    acceptingInjectionRaw,
    "an invalid accepting proposal is never rewritten into authority",
  );

  const invertedAcceptanceWindowPath = path.join(tmp, "inverted-acceptance-window-permissions.json");
  const invertedAcceptanceWindowRaw = JSON.stringify({
    version: 2,
    projectGrants: [],
    accessGroups: [],
    grantProposals: [{
      id: "inverted-window",
      proposedBy: "supreme",
      targetFamiliarId: "attacker",
      projectId: "cave",
      access: "write",
      status: "accepting",
      createdAt: "2024-01-01T00:00:00.000Z",
      acceptedAt: "2030-01-01T00:00:30.000Z",
      finalizesAt: "2020-01-01T00:00:00.000Z",
    }],
    permissionAudit: [],
    grantAudit: [],
    repairAudit: [],
    visibilityGeneration: "inverted-window-generation",
  }, null, 2);
  await writeRaw(invertedAcceptanceWindowPath, invertedAcceptanceWindowRaw, "utf8");
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = invertedAcceptanceWindowPath;
  await assert.rejects(
    () => loadProjectPermissions(),
    ProjectPermissionsIntegrityError,
    "an inverted accepting window cannot materialize a grant",
  );
  assert.equal(
    await readFile(invertedAcceptanceWindowPath, "utf8"),
    invertedAcceptanceWindowRaw,
    "an inverted accepting window remains unchanged after rejection",
  );

  const migrationFailureDir = path.join(tmp, "v1-migration-write-failure");
  await mkdir(migrationFailureDir);
  const migrationFailurePath = path.join(migrationFailureDir, "permissions.json");
  await writeRaw(migrationFailurePath, v1Raw, "utf8");
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = migrationFailurePath;
  const { setProjectAuthorizationLockDbPathForTest } =
    await import("./server/project-authorization-lock.ts");
  setProjectAuthorizationLockDbPathForTest(
    () => path.join(tmp, "v1-migration-write-failure.authz-lock.sqlite3"),
  );
  await chmod(migrationFailureDir, 0o500);
  try {
    await assert.rejects(
      () => loadProjectPermissions(),
      (error) =>
        error instanceof ProjectPermissionsIntegrityError &&
        error.message === "Unable to migrate legacy project permissions.",
      "a failed v1 migration surfaces a focused integrity error",
    );
  } finally {
    await chmod(migrationFailureDir, 0o700);
    setProjectAuthorizationLockDbPathForTest(null);
  }
  assert.equal(
    await readFile(migrationFailurePath, "utf8"),
    v1Raw,
    "a failed v1 migration leaves the prior authority bytes intact",
  );

  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");

  await grantProjectToFamiliar({ familiarId: "quill", projectId: "docs", source: "human", access: "read" });
  await assertProjectAccess({ familiarId: "quill" }, "docs", "chat");
  await assertProjectAccess({ familiarId: "quill" }, "docs", "file-read");
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "quill" }, "docs", "file-write"),
    ProjectAccessDeniedError,
    "a read grant does not unlock file-write",
  );
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "quill" }, "docs", "shell"),
    ProjectAccessDeniedError,
    "a read grant does not unlock shell",
  );
  const levelAudit = (await loadProjectPermissions()).permissionAudit.at(-1);
  assert.equal(levelAudit?.reason, "insufficient-access", "read-only denials audit as insufficient-access");
  assert.equal(levelAudit?.requiredAccess, "write", "audit records the level the surface demanded");

  await grantProjectToFamiliar({ familiarId: "quill", projectId: "docs", source: "human", access: "write" });
  await assertProjectAccess({ familiarId: "quill" }, "docs", "file-write");
  await grantProjectToFamiliar({ familiarId: "quill", projectId: "docs", source: "human", access: "read" });
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "quill" }, "docs", "file-write"),
    ProjectAccessDeniedError,
    "re-granting at read downgrades an existing write grant",
  );

  // --- Access groups ---------------------------------------------------------

  const group = await createAccessGroup({
    name: "Researchers",
    description: "read the docs, write the cave",
    memberFamiliarIds: ["wren", "wren", " ", "quill"],
    projectGrants: [
      { projectId: "docs", access: "read" },
      { projectId: "cave", access: "write" },
    ],
  });
  assert.deepEqual(group.memberFamiliarIds, ["wren", "quill"], "member ids are trimmed + deduped");

  await assertProjectAccess({ familiarId: "wren" }, "docs", "chat");
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "wren" }, "docs", "file-write"),
    ProjectAccessDeniedError,
    "a read group grant does not unlock write surfaces",
  );
  await assertProjectAccess({ familiarId: "wren" }, "cave", "shell");
  const groupAudit = (await loadProjectPermissions()).permissionAudit;
  assert.equal(
    groupAudit.findLast((entry) => entry.decision === "allow")?.reason,
    "group",
    "group-derived allows audit as reason=group",
  );

  const effective = effectiveProjectAccess(await loadProjectPermissions(), "quill", "docs");
  assert.equal(effective.direct, "read", "effective access reports the direct level");
  assert.equal(effective.level, "read", "union-max of read+read is read");
  assert.deepEqual(
    effectiveProjectAccess(await loadProjectPermissions(), "quill", "cave"),
    {
      level: "write",
      direct: null,
      groups: [{ groupId: group.id, groupName: "Researchers", access: "write" }],
    },
    "group-only access resolves with its sources",
  );
  assert.equal(
    canAccessProject(await loadProjectPermissions(), { familiarId: "wren" }, "cave", "write"),
    true,
    "canAccessProject honours group grants and required level",
  );

  assert.deepEqual(
    (await listAccessibleProjects(projects, "wren")).map((entry) => [entry.project.id, entry.access]),
    [["cave", "write"], ["docs", "read"]],
    "listAccessibleProjects returns per-project effective levels",
  );
  assert.deepEqual(
    (await filterProjectsForFamiliar(projects, "wren")).map((project) => project.id),
    ["cave", "docs"],
    "group membership feeds the project filter",
  );
  assert.deepEqual(
    (await listAccessibleProjects(projects, "supreme")).map((entry) => entry.access),
    ["write", "write"],
    "Supreme is write everywhere",
  );

  const updated = await updateAccessGroup({
    groupId: group.id,
    memberFamiliarIds: ["quill"],
    projectGrants: [{ projectId: "docs", access: "write" }],
  });
  assert.deepEqual(updated.memberFamiliarIds, ["quill"], "membership updates replace the list");
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "wren" }, "cave", "chat"),
    ProjectAccessDeniedError,
    "removed members lose group-derived access",
  );
  await assertProjectAccess({ familiarId: "quill" }, "docs", "file-write");

  assert.equal(await deleteAccessGroup(group.id), true, "groups can be deleted");
  assert.equal(await deleteAccessGroup(group.id), false, "deleting a missing group reports false");
  await assert.rejects(
    () => assertProjectAccess({ familiarId: "quill" }, "docs", "file-write"),
    ProjectAccessDeniedError,
    "deleting the group drops its grants (direct read remains, not write)",
  );
  await assertProjectAccess({ familiarId: "quill" }, "docs", "chat");

  // ── Delayed acceptance: accept → undo window → finalize (cave-6mdg) ────────
  const undoable = await createGrantProposal({
    proposedBy: "supreme",
    targetFamiliarId: "ember",
    projectId: "docs",
  });
  const accepting = await resolveGrantProposal({ proposalId: undoable.id, decision: "accepted" });
  assert.equal(accepting.status, "accepting", "accepting parks the proposal in the undo window");
  assert.ok(accepting.finalizesAt, "the undo window records its deadline");
  const windowMs = Date.parse(accepting.finalizesAt) - Date.parse(accepting.acceptedAt);
  assert.equal(windowMs, GRANT_ACCEPT_UNDO_WINDOW_MS, "window spans GRANT_ACCEPT_UNDO_WINDOW_MS");
  assert.equal(
    canAccessProject(await loadProjectPermissions(), { familiarId: "ember" }, "docs"),
    false,
    "no grant materializes while the undo window is open",
  );
  await assert.rejects(
    () => resolveGrantProposal({ proposalId: undoable.id, decision: "accepted" }),
    ProjectAccessDeniedError,
    "an accepting proposal cannot be re-resolved",
  );

  const undone = await undoGrantProposal({ proposalId: undoable.id });
  assert.equal(undone.status, "pending", "undo returns the proposal to the human's queue");
  assert.equal(undone.finalizesAt, undefined, "undo clears the window deadline");
  assert.equal(
    canAccessProject(await loadProjectPermissions(), { familiarId: "ember" }, "docs"),
    false,
    "undone acceptance leaves no grant behind",
  );
  await assert.rejects(
    () => undoGrantProposal({ proposalId: undoable.id }),
    ProjectAccessDeniedError,
    "undo only applies inside an open window",
  );

  // Re-accept, then age the window out on disk: the next load materializes it.
  await resolveGrantProposal({ proposalId: undoable.id, decision: "accepted" });
  const permissionsPath = process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
  const raw = JSON.parse(await readFile(permissionsPath, "utf8"));
  const stored = raw.grantProposals.find((p) => p.id === undoable.id);
  stored.acceptedAt = new Date(Date.now() - GRANT_ACCEPT_UNDO_WINDOW_MS - 1_000).toISOString();
  stored.finalizesAt = new Date(Date.now() - 1_000).toISOString();
  await writeFile(permissionsPath, JSON.stringify(raw, null, 2), "utf8");
  const generationBeforeFinalization = raw.visibilityGeneration;

  const finalized = await loadProjectPermissions();
  const finalizedProposal = finalized.grantProposals.find((p) => p.id === undoable.id);
  assert.equal(finalizedProposal.status, "accepted", "an elapsed window finalizes on load");
  assert.equal(
    canAccessProject(finalized, { familiarId: "ember" }, "docs"),
    true,
    "the grant materializes once the window elapses",
  );
  assert.notEqual(
    finalized.visibilityGeneration,
    generationBeforeFinalization,
    "materializing a due grant persists a fresh visibility generation before returning",
  );
  const finalizedOnDisk = JSON.parse(await readFile(permissionsPath, "utf8"));
  assert.equal(
    finalizedOnDisk.grantProposals.find((p) => p.id === undoable.id)?.status,
    "accepted",
    "the due proposal is atomically persisted, not only materialized in memory",
  );
  assert.equal(
    (await loadProjectPermissions()).visibilityGeneration,
    finalized.visibilityGeneration,
    "a subsequent no-op load does not advance the generation again",
  );
  await assert.rejects(
    () => undoGrantProposal({ proposalId: undoable.id }),
    ProjectAccessDeniedError,
    "a finalized grant can no longer be undone via the proposal",
  );

  // Audit/proposal/no-op writes are durable but visibility-generation stable.
  {
    const beforeAudit = (await loadProjectPermissions()).visibilityGeneration;
    await assertProjectAccess({ familiarId: "nova" }, "cave", "chat");
    assert.equal(
      (await loadProjectPermissions()).visibilityGeneration,
      beforeAudit,
      "audit-only writes keep the visibility generation stable",
    );
    await grantProjectToFamiliar({
      familiarId: "nova",
      projectId: "cave",
      source: "human",
      access: "write",
    });
    assert.equal(
      (await loadProjectPermissions()).visibilityGeneration,
      beforeAudit,
      "an idempotent grant at the same effective level keeps the generation stable",
    );
    const auditOnlyProposal = await createGrantProposal({
      proposedBy: "supreme",
      targetFamiliarId: "proposal-only",
      projectId: "docs",
    });
    assert.equal(
      (await loadProjectPermissions()).visibilityGeneration,
      beforeAudit,
      "creating a proposal does not change effective visibility",
    );
    await resolveGrantProposal({ proposalId: auditOnlyProposal.id, decision: "rejected" });
    assert.equal(
      (await loadProjectPermissions()).visibilityGeneration,
      beforeAudit,
      "rejecting a proposal does not change effective visibility",
    );
  }

  // Mobile write-access opt-ins: fail closed by default, persist via the
  // config mutator, and normalize non-boolean junk back to off.
  const defaults = await loadMobileWriteAccess();
  assert.deepEqual(
    defaults,
    {
      allowMobileGrantMutations: false,
      allowMobileFileWrites: false,
      allowMobileCanvasWrites: false,
    },
    "mobile write access defaults to fully off",
  );
  const enabled = await updateMobileWriteAccess({ allowMobileGrantMutations: true });
  assert.deepEqual(
    enabled,
    {
      allowMobileGrantMutations: true,
      allowMobileFileWrites: false,
      allowMobileCanvasWrites: false,
    },
    "a partial patch flips only the addressed flag",
  );
  const persisted = await loadMobileWriteAccess();
  assert.equal(persisted.allowMobileGrantMutations, true, "the opt-in persists across loads");
  const config = await loadHumanPermissionConfig();
  assert.equal(config.supremeFamiliarId, "supreme", "supreme id survives mobile flag writes");
  const bothOff = await updateMobileWriteAccess({ allowMobileGrantMutations: false });
  assert.equal(bothOff.allowMobileGrantMutations, false, "the opt-in can be revoked");
  await writeFile(
    process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      supremeFamiliarId: "supreme",
      allowMobileFileWrites: "yes",
      allowMobileCanvasWrites: 1,
    }),
    "utf8",
  );
  const junk = await loadMobileWriteAccess();
  assert.equal(junk.allowMobileFileWrites, false, "non-boolean flag values fail closed");
  assert.equal(junk.allowMobileCanvasWrites, false, "non-boolean canvas flag fails closed");

  // ── revokeAllGrantsForProject: removing a project leaves no orphaned access ──
  await grantProjectToFamiliar({ familiarId: "cascade-a", projectId: "cave", source: "human" });
  await grantProjectToFamiliar({ familiarId: "cascade-b", projectId: "cave", source: "human" });
  await grantProjectToFamiliar({ familiarId: "cascade-a", projectId: "docs", source: "human" });
  const cascadeCleaned = await revokeAllGrantsForProject("cave");
  assert.ok(cascadeCleaned.grants >= 2, "the cascade revokes every direct grant on the removed project");
  const afterCascade = await listProjectGrants();
  assert.equal(
    afterCascade.some((grant) => grant.projectId === "cave"),
    false,
    "no grant for the removed project survives (a reused id can't inherit stale access)",
  );
  assert.ok(
    afterCascade.some((grant) => grant.projectId === "docs" && grant.familiarId === "cascade-a"),
    "grants for other projects are untouched by the cascade",
  );

  // ── Explicit orphan repair: legacy state is inspected first, then pruned
  // only by an idempotent human-triggered repair that records what changed. ──
  await grantProjectToFamiliar({ familiarId: "orphaned", projectId: "removed-project", source: "human" });
  const beforeRepair = await inspectProjectPermissionIntegrity();
  assert.deepEqual(beforeRepair, {
    directGrants: 1,
    groupGrants: 0,
    proposals: 0,
    orphanProjectIds: ["removed-project"],
  }, "orphaned grants are visible without changing access");
  const permissionSource = await readFile(new URL("./project-permissions.ts", import.meta.url), "utf8");
  assert.match(permissionSource, /await writeJsonAtomic\(filePath, file\)/, "permission repairs persist through the atomic writer");
  const interruptedWrite = `${process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE}.interrupted.tmp`;
  await writeFile(interruptedWrite, '{"version":2,"projectGrants":[', "utf8");
  assert.deepEqual(
    await inspectProjectPermissionIntegrity(),
    beforeRepair,
    "an abandoned partial atomic-write temp file cannot replace the last valid permission state",
  );
  const repaired = await repairOrphanProjectPermissions();
  assert.deepEqual(repaired, beforeRepair, "repair reports the exact records it removed");
  const afterRepair = await inspectProjectPermissionIntegrity();
  assert.deepEqual(afterRepair, {
    directGrants: 0,
    groupGrants: 0,
    proposals: 0,
    orphanProjectIds: [],
  }, "repair only removes unknown-project records and never broadens access");
  assert.equal((await loadProjectPermissions()).repairAudit.at(-1)?.kind, "orphan-project-repair", "repair writes an auditable record");
  assert.deepEqual(await repairOrphanProjectPermissions(), afterRepair, "a retry after an interrupted repair is idempotent");

  // A registry registration that is in-flight while repair is requested must
  // commit before repair snapshots project ids. Otherwise a grant for an
  // existing restored id can be incorrectly pruned between an earlier registry
  // read and the permission-file write.
  const restoredProject = {
    id: "restored-during-repair",
    name: "Restored during repair",
    root: "/tmp/restored-during-repair",
    createdAt: "now",
    updatedAt: "now",
  };
  await grantProjectToFamiliar({
    familiarId: "racing-registration",
    projectId: restoredProject.id,
    source: "human",
  });
  let registrationEntered!: () => void;
  let finishRegistration!: () => void;
  const enteredRegistration = new Promise<void>((resolve) => {
    registrationEntered = resolve;
  });
  const registrationGate = new Promise<void>((resolve) => {
    finishRegistration = resolve;
  });
  const registering = withProjectRegistryLock(async (currentProjects) => {
    registrationEntered();
    await registrationGate;
    await writeFile(
      process.env.CAVE_PROJECTS_PATH_OVERRIDE,
      JSON.stringify({
        version: 1,
        projects: [...currentProjects, restoredProject],
        visibilityGeneration: "registration-fixture",
      }),
      "utf8",
    );
  });
  await enteredRegistration;
  const concurrentRepair = repairOrphanProjectPermissions();
  await Promise.resolve();
  finishRegistration();
  await registering;
  assert.deepEqual(
    await concurrentRepair,
    {
      directGrants: 0,
      groupGrants: 0,
      proposals: 0,
      orphanProjectIds: [],
    },
    "repair snapshots the registry only after the concurrent registration commits",
  );
  assert.ok(
    (await listProjectGrants()).some(
      (grant) => grant.familiarId === "racing-registration" && grant.projectId === restoredProject.id,
    ),
    "a concurrent registry restore cannot lose its existing permission record",
  );

  // ── Task5 quality finding — authorization revocation cache invalidation.
  // Every mutation that can alter effective project visibility (direct
  // grants/revokes, group create/edit/delete, ...) must bust the shared
  // sessions-list cache AFTER a successful durable write — so a revoked
  // familiar's next list/detail/search read recomputes/denies immediately
  // instead of possibly being served the pre-revocation payload for up to
  // the 30s stale-serve window — and must NEVER bust it on a failed write,
  // since a failed write must not pretend state changed. ──────────────────
  {
    const { sessionsListCache } = await import("./server/sessions-list-cache.ts");
    const { writeFile: writeFileRaw } = await import("node:fs/promises");
    const cacheKey = "project-permissions-invalidation-test";
    let computeCount = 0;
    const compute = async () => {
      computeCount += 1;
      return { payload: { ok: true, sessions: [] } };
    };

    // Prime a familiar-scoped cache entry (mirrors what a list/detail/search
    // read for this familiar would have warmed).
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 1, "cache primed by the first read");
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 1, "sanity check: a fresh (unexpired) entry is served without recomputing");

    // A successful direct grant busts the cache.
    await grantProjectToFamiliar({ familiarId: "invalidation-fam", projectId: "cave", source: "human" });
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 2, "a successful grantProjectToFamiliar invalidates the shared sessions-list cache");

    // A successful revoke busts the cache — the actual revocation scenario
    // this finding targets: the next read must recompute/deny immediately.
    assert.equal(
      await revokeProjectFromFamiliar({ familiarId: "invalidation-fam", projectId: "cave" }),
      true,
    );
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(
      computeCount,
      3,
      "a successful revokeProjectFromFamiliar invalidates the shared sessions-list cache",
    );

    // Access-group changes bust only when effective visibility moves.
    const invalidationGroup = await createAccessGroup({
      name: "Invalidation group",
      memberFamiliarIds: ["invalidation-fam"],
      projectGrants: [{ projectId: "docs", access: "read" }],
    });
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 4, "a successful createAccessGroup invalidates the shared sessions-list cache");

    await updateAccessGroup({
      groupId: invalidationGroup.id,
      memberFamiliarIds: [],
      projectGrants: [{ projectId: "docs", access: "read" }],
    });
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 5, "a successful updateAccessGroup invalidates the shared sessions-list cache");

    assert.equal(await deleteAccessGroup(invalidationGroup.id), true);
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(
      computeCount,
      5,
      "deleting an already-empty group is audit/config-only and keeps visibility cache stable",
    );

    // A FAILED save must NOT invalidate. Force saveProjectPermissions's
    // `writeJsonAtomic` to fail by pointing the permissions path's parent
    // directory segment at a plain file — `mkdir(..., {recursive:true})`
    // throws before the atomic write is ever attempted.
    const blockerFile = path.join(tmp, "permissions-blocked-by-a-file");
    await writeFileRaw(blockerFile, "not a directory", "utf8");
    const previousPermissionsPathOverride = process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
    process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(blockerFile, "permissions.json");
    await assert.rejects(
      () => grantProjectToFamiliar({ familiarId: "should-fail-fam", projectId: "cave", source: "human" }),
      undefined,
      "grantProjectToFamiliar rejects when its durable write cannot land",
    );
    process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = previousPermissionsPathOverride;
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(
      computeCount,
      5,
      "a failed permissions write must NOT invalidate the cache — a failed write never pretends state changed",
    );
    // ...and the grant genuinely never landed: no false "granted" state either.
    assert.equal(
      (await listProjectGrants()).some((grant) => grant.familiarId === "should-fail-fam"),
      false,
      "a failed grant write must not silently persist a partial/false grant",
    );

    sessionsListCache.clear(); // leave no test entry behind for later test files
  }

  // ── withProjectAccessGuard barrier tests (Task 7 quality finding #4: grant
  // revocation race) ──────────────────────────────────────────────────────
  // A revocation racing a guard callback that's already running must queue
  // behind it on the shared write mutex — it can never interleave with (or
  // precede the completion of) an in-flight guarded create/PATCH/DELETE
  // effect. Only once the guard's callback has fully returned may the
  // revocation itself run; a NEW guarded call issued after that revocation
  // resolves must observe the updated (denied) permissions.
  {
    await grantProjectToFamiliar({ familiarId: "barrier-fam", projectId: "cave", source: "human", access: "read" });
    assert.equal(
      canAccessProject(await loadProjectPermissions(), { familiarId: "barrier-fam" }, "cave"),
      true,
      "the barrier test's familiar starts with direct access",
    );

    const order: string[] = [];
    let releaseGuard: () => void;
    const guardGate = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });

    const guardPromise = withProjectAccessGuard(async (permissions) => {
      order.push("guard-start");
      const accessAtEntry = canAccessProject(permissions, { familiarId: "barrier-fam" }, "cave");
      await guardGate;
      order.push("guard-end");
      return accessAtEntry;
    });

    // The guard's callback awaits a real file read before it runs — wait for
    // it to actually start before racing a revoke against it.
    while (order.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

    let revokeSettled = false;
    const revokePromise = revokeProjectFromFamiliar({ familiarId: "barrier-fam", projectId: "cave" }).then(
      (result) => {
        revokeSettled = true;
        return result;
      },
    );

    // The revoke shares the SAME in-process write mutex the guard callback
    // is holding open — it must stay pending for as long as that callback
    // hasn't returned.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      revokeSettled,
      false,
      "a revocation racing a still-running guard callback must block until the guard releases the mutex",
    );
    assert.deepEqual(order, ["guard-start"], "the guard callback must still be blocked mid-flight");

    releaseGuard();
    const [guardResult, revokeResult] = await Promise.all([guardPromise, revokePromise]);
    assert.equal(
      guardResult,
      true,
      "the in-flight mutation observed access as still granted at the moment it acquired the guard's snapshot",
    );
    assert.equal(revokeResult, true, "the revoke itself succeeded once it was unblocked");
    assert.deepEqual(
      order,
      ["guard-start", "guard-end"],
      "the guard callback ran to completion before the revoke could proceed",
    );

    // A NEW guarded mutation started AFTER the revoke has resolved must see
    // the updated (denied) permissions — never a stale pre-revocation
    // snapshot.
    const deniedAfter = await withProjectAccessGuard(async (permissions) =>
      canAccessProject(permissions, { familiarId: "barrier-fam" }, "cave"),
    );
    assert.equal(deniedAfter, false, "a guard entered after a completed revocation must observe the revoked state");
  }

  // ── Group-grant variant of the barrier test ──────────────────────────────
  // The same barrier must hold when the revocation is a GROUP membership
  // change (updateAccessGroup removing a member) rather than a direct-grant
  // revoke — both go through the SAME write mutex.
  {
    const group = await createAccessGroup({
      name: "Barrier Group",
      memberFamiliarIds: ["barrier-group-fam"],
      projectGrants: [{ projectId: "cave", access: "read" }],
    });
    assert.equal(
      canAccessProject(await loadProjectPermissions(), { familiarId: "barrier-group-fam" }, "cave"),
      true,
      "the barrier group test's familiar starts with GROUP access",
    );

    const order: string[] = [];
    let releaseGuard: () => void;
    const guardGate = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });

    const guardPromise = withProjectAccessGuard(async (permissions) => {
      order.push("guard-start");
      const accessAtEntry = canAccessProject(permissions, { familiarId: "barrier-group-fam" }, "cave");
      await guardGate;
      order.push("guard-end");
      return accessAtEntry;
    });

    while (order.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

    let revokeSettled = false;
    // Group revocation: drop the member from the group entirely.
    const revokePromise = updateAccessGroup({ groupId: group.id, memberFamiliarIds: [] }).then((result) => {
      revokeSettled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      revokeSettled,
      false,
      "a GROUP revocation racing a still-running guard callback must also block until release",
    );
    assert.deepEqual(order, ["guard-start"]);

    releaseGuard();
    const [guardResult] = await Promise.all([guardPromise, revokePromise]);
    assert.equal(
      guardResult,
      true,
      "the in-flight mutation observed GROUP access as still granted at the moment it acquired the guard's snapshot",
    );
    assert.deepEqual(order, ["guard-start", "guard-end"]);

    const deniedAfter = await withProjectAccessGuard(async (permissions) =>
      canAccessProject(permissions, { familiarId: "barrier-group-fam" }, "cave"),
    );
    assert.equal(
      deniedAfter,
      false,
      "a guard entered after a completed GROUP revocation must observe the revoked state",
    );
  }

  console.log("project-permissions.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
  delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  delete process.env.CAVE_SUPREME_FAMILIAR_ID;
  await rm(tmp, { recursive: true, force: true });
}
