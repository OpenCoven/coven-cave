// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    filterProjectsForFamiliar,
    grantProjectToFamiliar,
    listAccessibleProjects,
    loadProjectPermissions,
    requiredAccessLevel,
    resolveGrantProposal,
    undoGrantProposal,
    updateAccessGroup,
    GRANT_ACCEPT_UNDO_WINDOW_MS,
    ProjectAccessDeniedError,
  } = await import("./project-permissions.ts");

  const projects = [
    { id: "cave", name: "Cave", root: "/tmp/cave", createdAt: "now", updatedAt: "now" },
    { id: "docs", name: "Docs", root: "/tmp/docs", createdAt: "now", updatedAt: "now" },
  ];
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({ version: 1, projects }),
    "utf8",
  );

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

  // A v1-era file on disk (grants without access, no accessGroups) loads as v2.
  const { writeFile: writeRaw } = await import("node:fs/promises");
  const v1Path = path.join(tmp, "v1-permissions.json");
  await writeRaw(v1Path, JSON.stringify({
    version: 1,
    projectGrants: [{ familiarId: "old", projectId: "cave", source: "human", grantedAt: "2024-01-01T00:00:00.000Z" }],
    grantProposals: [],
    permissionAudit: [],
  }), "utf8");
  process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = v1Path;
  const migrated = await loadProjectPermissions();
  assert.equal(migrated.version, 2, "v1 file loads as version 2");
  assert.deepEqual(migrated.accessGroups, [], "v1 file gains an empty accessGroups list");
  assert.equal(migrated.projectGrants[0]?.access, "write", "v1 grants are stamped write on load");
  await assertProjectAccess({ familiarId: "old" }, "cave", "file-write");
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
    canAccessProject(await loadProjectPermissions(), { familiarId: "wren" }, "cave", "supreme", "write"),
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
    canAccessProject(await loadProjectPermissions(), { familiarId: "ember" }, "docs", "supreme"),
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
    canAccessProject(await loadProjectPermissions(), { familiarId: "ember" }, "docs", "supreme"),
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
  stored.finalizesAt = new Date(Date.now() - 1_000).toISOString();
  await writeFile(permissionsPath, JSON.stringify(raw, null, 2), "utf8");

  const finalized = await loadProjectPermissions();
  const finalizedProposal = finalized.grantProposals.find((p) => p.id === undoable.id);
  assert.equal(finalizedProposal.status, "accepted", "an elapsed window finalizes on load");
  assert.equal(
    canAccessProject(finalized, { familiarId: "ember" }, "docs", "supreme"),
    true,
    "the grant materializes once the window elapses",
  );
  await assert.rejects(
    () => undoGrantProposal({ proposalId: undoable.id }),
    ProjectAccessDeniedError,
    "a finalized grant can no longer be undone via the proposal",
  );

  console.log("project-permissions.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
  delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  delete process.env.CAVE_SUPREME_FAMILIAR_ID;
  await rm(tmp, { recursive: true, force: true });
}
