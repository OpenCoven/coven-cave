// @ts-nocheck
// #6451: a Write grant can't newly reach Cave's private state, by any path,
// and a refused Full access turn says which folder and which grant.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = await realpath(await mkdtemp(path.join(tmpdir(), "cave-private-state-")));
const covenHome = path.join(tmp, "coven");
const caveHomeForTest = path.join(covenHome, "cave");
process.env.COVEN_CAVE_HOME = caveHomeForTest;
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
process.env.CAVE_SUPREME_FAMILIAR_ID = "supreme";

try {
  await mkdir(path.join(caveHomeForTest, "research-missions"), { recursive: true });
  await mkdir(path.join(tmp, "app"), { recursive: true });
  await symlink(covenHome, path.join(tmp, "coven-alias"), process.platform === "win32" ? "junction" : "dir");

  const {
    canonicalPathForOverlap,
    cavePrivateStatePath,
    findPrivateStateOverlap,
    overlapsCavePrivateState,
  } = await import("./cave-private-state.ts");
  const {
    CavePrivateStateGrantError,
    bootstrapSupremeProjectGrants,
    createAccessGroup,
    createGrantProposal,
    describePrivateStateWriteOverlap,
    grantProjectToFamiliar,
    listPrivateStateProjectIds,
    listProjectGrants,
    listRecentGrantChanges,
    loadProjectPermissions,
    resolveGrantProposal,
    revokeProjectFromFamiliar,
    updateAccessGroup,
  } = await import("./project-permissions.ts");

  // ── The folder test ────────────────────────────────────────────────────
  assert.equal(cavePrivateStatePath(), path.join(caveHomeForTest, "claude-authority"));
  for (const folder of [tmp, covenHome, caveHomeForTest, path.join(caveHomeForTest, "claude-authority"),
    path.join(caveHomeForTest, "claude-authority", "1-turn"), path.join(tmp, "coven-alias")]) {
    assert.equal(overlapsCavePrivateState(folder), true, `${folder} reaches Cave's private state`);
  }
  for (const folder of [path.join(caveHomeForTest, "research-missions"), path.join(tmp, "app"),
    path.join(covenHome, "workspaces", "nova"), path.join(caveHomeForTest, "claude-authority-old")]) {
    assert.equal(overlapsCavePrivateState(folder), false, `${folder} stays grantable`);
  }
  assert.equal(
    canonicalPathForOverlap(path.join(tmp, "coven-alias", "not-yet")),
    path.join(covenHome, "not-yet"),
    "a missing folder still resolves through its existing ancestor's link",
  );
  assert.equal(
    overlapsCavePrivateState(path.join(tmp, "coven-alias", "cave", "claude-authority", "later")),
    true,
    "an alias spelling of a folder inside the private state can't dodge the test",
  );

  // ── Fixtures ───────────────────────────────────────────────────────────
  const projects = [
    { id: "home", name: "Coven home", root: path.join(tmp, "coven-alias"), createdAt: "now", updatedAt: "now" },
    { id: "missions", name: "Research Missions", root: path.join(caveHomeForTest, "research-missions"), createdAt: "now", updatedAt: "now" },
    { id: "app", name: "App", root: path.join(tmp, "app"), createdAt: "now", updatedAt: "now" },
  ];
  await writeFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, JSON.stringify({ version: 1, projects }), "utf8");
  const seed = (file) => writeFile(process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE, JSON.stringify({ version: 2, ...file }), "utf8");
  const at = "2026-08-20T00:00:00.000Z";
  await seed({
    projectGrants: [
      { familiarId: "sage", projectId: "home", access: "write", source: "human", grantedAt: at },
      { familiarId: "lucian", projectId: "home", access: "read", source: "human", grantedAt: at },
    ],
    accessGroups: [{
      id: "coders", name: "Coders", memberFamiliarIds: ["nova", "cody"],
      projectGrants: [{ projectId: "home", access: "write", grantedAt: at }, { projectId: "app", access: "write", grantedAt: at }],
      createdAt: at, updatedAt: at,
    }, {
      id: "readers", name: "Readers", memberFamiliarIds: ["echo"],
      projectGrants: [{ projectId: "home", access: "read", grantedAt: at }],
      createdAt: at, updatedAt: at,
    }],
    grantProposals: [{
      id: "p1", proposedBy: "supreme", targetFamiliarId: "echo", projectId: "home",
      access: "write", status: "pending", createdAt: at,
    }],
  });
  const logLength = async () => (await loadProjectPermissions()).grantAudit.length;
  const refused = async (run, pattern, label) => {
    const before = await logLength();
    await assert.rejects(run, (error) => {
      assert.ok(error instanceof CavePrivateStateGrantError, `${label}: a CavePrivateStateGrantError`);
      assert.equal(error.status, 409);
      assert.equal(error.code, "cave_private_state_write");
      assert.equal(error.project.id, "home");
      assert.match(error.message, pattern);
      return true;
    }, label);
    assert.equal(await logLength(), before, `${label}: a refused change is never logged as made`);
  };

  assert.deepEqual(await listPrivateStateProjectIds(), ["home"], "only the folder holding the private state is listed");

  // ── Direct grants ──────────────────────────────────────────────────────
  await refused(
    () => grantProjectToFamiliar({ familiarId: "echo", projectId: "home", source: "human", access: "write", actor: "loopback" }),
    /Coven home \(.+\) contains Cave’s private state, so no familiar can have Write access to it\. Choose Read instead\./,
    "a new direct Write grant",
  );
  await refused(
    () => grantProjectToFamiliar({ familiarId: "lucian", projectId: "home", source: "human", actor: "loopback" }),
    /Choose Read instead/,
    "Read moving to Write (the default level)",
  );
  await grantProjectToFamiliar({ familiarId: "echo", projectId: "home", source: "human", access: "read", actor: "loopback" });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: "home", source: "human", access: "write", actor: "loopback" });
  await grantProjectToFamiliar({ familiarId: "echo", projectId: "missions", source: "human", access: "write", actor: "loopback" });
  await grantProjectToFamiliar({ familiarId: "echo", projectId: "app", source: "human", access: "write", actor: "loopback" });
  let grants = await listProjectGrants();
  const level = (familiarId, projectId) => grants.find((g) => g.familiarId === familiarId && g.projectId === projectId)?.access;
  assert.equal(level("echo", "home"), "read", "Read stays allowed");
  assert.equal(level("sage", "home"), "write", "an existing Write grant is left as it is, never changed by Cave");
  assert.equal(level("echo", "missions"), "write", "folders elsewhere in Cave's home stay grantable");
  assert.equal(level("echo", "app"), "write");

  // ── Proposals ──────────────────────────────────────────────────────────
  await refused(
    () => createGrantProposal({ proposedBy: "supreme", targetFamiliarId: "kitty", projectId: "home" }),
    /Choose Read instead/,
    "a Write proposal",
  );
  await createGrantProposal({ proposedBy: "supreme", targetFamiliarId: "kitty", projectId: "home", access: "read" });
  await refused(
    () => resolveGrantProposal({ proposalId: "p1", decision: "accepted" }),
    /Choose Read instead/,
    "accepting a Write proposal saved before the rule",
  );
  assert.equal((await resolveGrantProposal({ proposalId: "p1", decision: "rejected" })).status, "rejected");

  // ── Access groups ──────────────────────────────────────────────────────
  await refused(
    () => createAccessGroup({ name: "New", memberFamiliarIds: ["kitty"], projectGrants: [{ projectId: "home", access: "write" }], actor: "loopback" }),
    /Choose Read instead/,
    "a new group with Write",
  );
  await refused(
    () => createAccessGroup({ name: "Empty", projectGrants: [{ projectId: "home", access: "write" }], actor: "loopback" }),
    /Choose Read instead/,
    "a new group with Write and no members yet",
  );
  await createAccessGroup({ name: "Viewers", memberFamiliarIds: ["kitty"], projectGrants: [{ projectId: "home", access: "read" }], actor: "loopback" });
  await refused(
    () => updateAccessGroup({ groupId: "readers", projectGrants: [{ projectId: "home", access: "write" }], actor: "loopback" }),
    /Choose Read instead/,
    "a group grant moving Read to Write",
  );
  await refused(
    () => updateAccessGroup({ groupId: "coders", memberFamiliarIds: ["nova", "cody", "kitty"], actor: "loopback" }),
    /^Adding kitty to Coders would give it Write access to Coven home \(.+\), which holds Cave’s private state\. Change Coven home to Read in Coders first\.$/,
    "a member gaining Write through an existing group grant",
  );
  // Sage already has its own Write grant: joining changes nothing it can reach.
  await updateAccessGroup({ groupId: "coders", memberFamiliarIds: ["nova", "cody", "sage"], actor: "loopback" });
  await updateAccessGroup({ groupId: "coders", name: "Builders", actor: "loopback" });
  await updateAccessGroup({
    groupId: "coders",
    projectGrants: [{ projectId: "home", access: "write" }, { projectId: "app", access: "read" }, { projectId: "missions", access: "write" }],
    actor: "loopback",
  });
  let groups = (await loadProjectPermissions()).accessGroups;
  const coders = groups.find((group) => group.id === "coders");
  assert.equal(coders.name, "Builders", "a group holding such a grant can still be renamed");
  assert.deepEqual(coders.memberFamiliarIds, ["nova", "cody", "sage"]);
  assert.equal(coders.projectGrants.find((g) => g.projectId === "home").access, "write", "unrelated edits keep the existing grant");
  assert.equal(coders.projectGrants.find((g) => g.projectId === "missions").access, "write");

  // ── The refusal a Full access turn gets ────────────────────────────────
  const home = projects[0];
  const describe = (familiarId, extra = {}) => describePrivateStateWriteOverlap({
    familiarId,
    familiarName: familiarId[0].toUpperCase() + familiarId.slice(1),
    writableProjects: [projects[2], home],
    primaryProjectId: "app",
    primaryRoot: projects[2].root,
    ...extra,
  });
  const viaGroup = await describe("nova");
  assert.equal(viaGroup.source, "project");
  assert.equal(viaGroup.projectId, "home");
  assert.equal(viaGroup.direct, false);
  assert.deepEqual(viaGroup.groups, [{ id: "coders", name: "Builders" }]);
  assert.equal(viaGroup.relation, "contains");
  assert.match(viaGroup.message,
    /^Nova can write to Coven home \(.+\) through the Builders access group, and that folder contains Cave’s private state, so Cave won’t start a Full access turn\. In Projects, change Coven home to Read in Builders, then retry\. Read only turns still work\.$/);
  const both = await describe("sage");
  assert.equal(both.direct, true);
  assert.match(both.message, /through its own grant and the Builders access group, .+ change Coven home to Read for Sage and in Builders, then retry/);
  await seed({
    projectGrants: [{ familiarId: "astra", projectId: "home", access: "write", source: "human", grantedAt: at }],
    accessGroups: [],
    grantProposals: [],
  });
  const direct = await describe("astra");
  assert.deepEqual(direct.groups, []);
  assert.match(direct.message, /^Astra can write to Coven home \(.+\) through its own grant, .+ change Coven home to Read for Astra, then retry/);
  const workspace = await describe("juno", { writableProjects: [projects[2]], familiarWorkspace: covenHome });
  assert.equal(workspace.source, "workspace");
  assert.match(workspace.message, /^Juno’s workspace \(.+\) contains Cave’s private state, so Cave won’t start a Full access turn\. Give Juno a workspace folder of its own, then retry\./);
  const chatFolder = await describe("juno", {
    writableProjects: [], primaryProjectId: null, primaryRoot: path.join(caveHomeForTest, "claude-authority", "turn"),
  });
  assert.equal(chatFolder.source, "chat-folder");
  assert.equal(chatFolder.relation, "inside");
  assert.match(chatFolder.message, /^This chat’s folder \(.+\) is inside Cave’s private state, .+ Start the chat in another project, then retry\./);
  assert.equal(await describe("echo", { writableProjects: [projects[1], projects[2]] }), null,
    "Research Missions and ordinary projects pass");
  assert.equal(
    findPrivateStateOverlap({
      writableProjects: [home, { ...home, id: "home-2", name: "Second" }],
      primaryProjectId: "home-2", primaryRoot: tmp,
    }).projectId,
    "home-2",
    "the chat's own project is named first",
  );

  // ── Bootstrap ──────────────────────────────────────────────────────────
  await seed({ projectGrants: [], accessGroups: [], grantProposals: [] });
  await bootstrapSupremeProjectGrants(projects);
  grants = await listProjectGrants();
  assert.equal(level("supreme", "home"), "read", "bootstrap gives Read, never Write, on such a folder");
  assert.equal(level("supreme", "missions"), "write");
  assert.equal(level("supreme", "app"), "write");

  // Removals always pass.
  await seed({
    projectGrants: [{ familiarId: "sage", projectId: "home", access: "write", source: "human", grantedAt: at }],
    accessGroups: [], grantProposals: [],
  });
  assert.equal(await revokeProjectFromFamiliar({ familiarId: "sage", projectId: "home", actor: "loopback" }), true);
  const changes = await listRecentGrantChanges();
  assert.equal(changes[0].from, "write");
  assert.equal(changes[0].to, null);
  assert.deepEqual(await listProjectGrants(), []);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
