// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

// Access-control Phase 0: the permission-event log records the changes that
// used to be silent (proposal create/accept/reject/undo/finalize, group
// renames, proposals removed with a project, orphan repair), each with the
// actor the caller passed. A proposal finalizes only when its acceptance is on
// record, so an `accepting` row written into the file by hand grants nothing.
// Every store here is a scratch file behind the *_PATH_OVERRIDE variables.

const tmp = await mkdtemp(path.join(tmpdir(), "permission-events-test-"));
const permissionsPath = path.join(tmp, "permissions.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = permissionsPath;
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
process.env.CAVE_SUPREME_FAMILIAR_ID = "supreme";

const {
  createAccessGroup,
  createGrantProposal,
  listProjectGrants,
  listRecentGrantChanges,
  listRecentPermissionEvents,
  loadProjectPermissions,
  repairOrphanProjectPermissions,
  resolveGrantProposal,
  revokeAllGrantsForProject,
  undoGrantProposal,
  updateAccessGroup,
} = await import("./project-permissions.ts");

after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const at = "2026-11-01T00:00:00.000Z";
const past = "2026-11-01T00:00:30.000Z";

async function seed(file) {
  await writeFile(permissionsPath, JSON.stringify({ version: 2, ...file }), "utf8");
}

async function seedProjects(ids) {
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: ids.map((id) => ({ id, name: id, root: path.join(tmp, id), createdAt: at, updatedAt: at })),
    }),
    "utf8",
  );
}

/** Push a stored proposal's undo window into the past, as if 30 s went by. */
async function ageWindow(proposalId) {
  const raw = JSON.parse(await readFile(permissionsPath, "utf8"));
  raw.grantProposals.find((proposal) => proposal.id === proposalId).finalizesAt = past;
  await writeFile(permissionsPath, JSON.stringify(raw), "utf8");
}

const eventsFor = async (proposalId) =>
  (await listRecentPermissionEvents()).filter((event) => event.proposalId === proposalId).reverse();

beforeEach(async () => {
  await seed({ projectGrants: [], accessGroups: [], grantProposals: [] });
  await seedProjects(["docs", "app"]);
});

test("create, accept, undo and reject are each logged with the actor", async () => {
  const proposal = await createGrantProposal({
    proposedBy: "supreme", targetFamiliarId: "echo", projectId: "docs", access: "read", actor: "desktop",
  });
  await resolveGrantProposal({ proposalId: proposal.id, decision: "accepted", actor: "mobile" });
  await undoGrantProposal({ proposalId: proposal.id, actor: "desktop" });
  await resolveGrantProposal({ proposalId: proposal.id, decision: "rejected", actor: "dev-unverified" });
  const events = await eventsFor(proposal.id);
  assert.deepEqual(
    events.map((event) => [event.kind, event.actor]),
    [
      ["proposal-created", "desktop"],
      ["proposal-accepted", "mobile"],
      ["proposal-undone", "desktop"],
      ["proposal-rejected", "dev-unverified"],
    ],
  );
  assert.equal(events[0].details.claimedProposedBy, "supreme", "the body's proposer is logged as a claim");
  assert.equal(events[1].details.acceptedAt.length > 0, true, "the acceptance records when it happened");
  assert.equal(events[2].details.acceptedAt, events[1].details.acceptedAt, "undo names the acceptance it cancelled");
  assert.ok(events.every((event) => event.familiarId === "echo" && event.projectId === "docs"));
});

test("a recorded acceptance finalizes, and the finalization is audited", async () => {
  const proposal = await createGrantProposal({
    proposedBy: "supreme", targetFamiliarId: "echo", projectId: "docs", actor: "desktop",
  });
  await resolveGrantProposal({ proposalId: proposal.id, decision: "accepted", actor: "desktop" });
  await ageWindow(proposal.id);
  const loaded = await loadProjectPermissions();
  assert.equal(loaded.grantProposals[0].status, "accepted");
  assert.deepEqual(
    loaded.projectGrants.map((grant) => [grant.familiarId, grant.projectId, grant.access]),
    [["echo", "docs", "write"]],
    "a legacy proposal without access still means write",
  );
  const finalized = loaded.permissionEvents.find((event) => event.kind === "proposal-finalized");
  assert.equal(finalized.actor, "system", "the finalizer is an internal job");
  assert.equal(finalized.details.acceptedBy, "desktop", "and names who accepted");
  const [change] = loaded.grantAudit;
  assert.deepEqual(
    { from: change.from, to: change.to, actor: change.actor, kind: change.kind, proposalId: change.proposalId },
    { from: null, to: "write", actor: "desktop", kind: "proposal", proposalId: proposal.id },
    "the grant change names the human who widened it",
  );
});

test("a hand-written accepting row grants nothing and is held for review", async () => {
  await seed({
    projectGrants: [], accessGroups: [],
    grantProposals: [{
      id: "forged", proposedBy: "supreme", targetFamiliarId: "echo", projectId: "docs",
      access: "write", status: "accepting", createdAt: at, acceptedAt: at, finalizesAt: at,
    }],
  });
  assert.deepEqual(await listProjectGrants(), [], "no grant materializes");
  const loaded = await loadProjectPermissions();
  const [held] = loaded.grantProposals;
  assert.equal(held.status, "pending", "it goes back to the human's queue");
  assert.equal(held.acceptedAt, undefined);
  assert.equal(held.review.reason, "missing-acceptance-record", "and is marked for review");
  const event = loaded.permissionEvents.find((entry) => entry.kind === "proposal-held");
  assert.equal(event.proposalId, "forged");
  assert.equal(event.details.reason, "missing-acceptance-record");

  // The human can still accept it for real; that clears the flag.
  const accepted = await resolveGrantProposal({ proposalId: "forged", decision: "accepted", actor: "desktop" });
  assert.equal(accepted.status, "accepting");
  assert.equal(accepted.review, undefined);
  await ageWindow("forged");
  assert.deepEqual((await listProjectGrants()).map((grant) => grant.familiarId), ["echo"]);
});

test("a row flipped back to accepting after an undo is held, not finalized", async () => {
  const proposal = await createGrantProposal({
    proposedBy: "supreme", targetFamiliarId: "echo", projectId: "docs", actor: "desktop",
  });
  const accepting = await resolveGrantProposal({ proposalId: proposal.id, decision: "accepted", actor: "desktop" });
  await undoGrantProposal({ proposalId: proposal.id, actor: "desktop" });
  const raw = JSON.parse(await readFile(permissionsPath, "utf8"));
  Object.assign(raw.grantProposals[0], {
    status: "accepting", acceptedAt: accepting.acceptedAt, finalizesAt: past,
  });
  await writeFile(permissionsPath, JSON.stringify(raw), "utf8");
  assert.deepEqual(await listProjectGrants(), [], "the old acceptance was undone, so it can't be reused");
  assert.equal((await loadProjectPermissions()).grantProposals[0].review.reason, "missing-acceptance-record");
});

test("a recorded acceptance whose time doesn't match the row is held", async () => {
  const proposal = await createGrantProposal({
    proposedBy: "supreme", targetFamiliarId: "echo", projectId: "docs", actor: "desktop",
  });
  await resolveGrantProposal({ proposalId: proposal.id, decision: "accepted", actor: "desktop" });
  const raw = JSON.parse(await readFile(permissionsPath, "utf8"));
  Object.assign(raw.grantProposals[0], { acceptedAt: at, finalizesAt: past });
  await writeFile(permissionsPath, JSON.stringify(raw), "utf8");
  assert.deepEqual(await listProjectGrants(), []);
});

test("an accepted proposal with an unrecognised level is held, and can't be accepted", async () => {
  await seed({
    projectGrants: [], accessGroups: [],
    grantProposals: [{
      id: "odd", proposedBy: "supreme", targetFamiliarId: "echo", projectId: "docs",
      access: "admin", status: "accepting", createdAt: at, acceptedAt: at, finalizesAt: at,
    }],
    permissionEvents: [{
      id: "e1", at, kind: "proposal-accepted", actor: "desktop", proposalId: "odd",
      details: { acceptedAt: at },
    }],
  });
  assert.deepEqual(await listProjectGrants(), []);
  const loaded = await loadProjectPermissions();
  assert.equal(loaded.grantProposals[0].review.reason, "unrecognized-access");
  // Persist the hold, then try to accept again.
  await createGrantProposal({ proposedBy: "supreme", targetFamiliarId: "kitty", projectId: "docs" });
  await assert.rejects(
    () => resolveGrantProposal({ proposalId: "odd", decision: "accepted", actor: "desktop" }),
    /unrecognised access level/,
  );
  await resolveGrantProposal({ proposalId: "odd", decision: "rejected", actor: "desktop" });
});

test("group renames and description edits are logged", async () => {
  const group = await createAccessGroup({ name: "Docs", description: "writers", actor: "desktop" });
  await updateAccessGroup({ groupId: group.id, name: "Docs team", actor: "desktop" });
  await updateAccessGroup({ groupId: group.id, description: null, actor: "dev-unverified" });
  await updateAccessGroup({ groupId: group.id, name: "Docs team", description: null, actor: "desktop" });
  const events = (await listRecentPermissionEvents()).filter((event) => event.groupId === group.id).reverse();
  assert.deepEqual(
    events.map((event) => [event.kind, event.actor, event.details.from, event.details.to]),
    [
      ["group-renamed", "desktop", "Docs", "Docs team"],
      ["group-description-changed", "dev-unverified", "writers", null],
    ],
    "an edit that changes neither logs nothing",
  );
});

test("removing a project logs the proposals it deletes, with the actor", async () => {
  const proposal = await createGrantProposal({
    proposedBy: "supreme", targetFamiliarId: "echo", projectId: "docs", access: "read",
  });
  await seed({
    ...(JSON.parse(await readFile(permissionsPath, "utf8"))),
    projectGrants: [{ familiarId: "sage", projectId: "docs", access: "read", source: "human", grantedAt: at }],
  });
  const cleaned = await revokeAllGrantsForProject("docs", { actor: "desktop" });
  assert.deepEqual(cleaned, { grants: 1, groupGrants: 0, proposals: 1 });
  const [removed] = await eventsFor(proposal.id).then((events) =>
    events.filter((event) => event.kind === "proposal-removed-with-project"));
  assert.equal(removed.actor, "desktop");
  assert.equal(removed.details.status, "pending");
  const [change] = await listRecentGrantChanges();
  assert.equal(change.actor, "desktop", "the cascade's grant changes carry the real actor too");
});

test("orphan repair logs each removed grant to grantAudit", async () => {
  await seed({
    projectGrants: [
      { familiarId: "sage", projectId: "gone", access: "write", source: "human", grantedAt: at },
      { familiarId: "sage", projectId: "docs", access: "read", source: "human", grantedAt: at },
    ],
    accessGroups: [{
      id: "g", name: "G", memberFamiliarIds: ["echo"], createdAt: at, updatedAt: at,
      projectGrants: [{ projectId: "gone", access: "read", grantedAt: at }],
    }],
    grantProposals: [],
  });
  const report = await repairOrphanProjectPermissions({ actor: "desktop" });
  assert.deepEqual(report.orphanProjectIds, ["gone"]);
  const changes = (await listRecentGrantChanges()).reverse();
  assert.deepEqual(
    changes.map((change) => [change.familiarId, change.projectId, change.from, change.to, change.actor, change.groupId ?? null]),
    [
      ["sage", "gone", "write", null, "desktop", null],
      ["echo", "gone", "read", null, "desktop", "g"],
    ],
  );
  const [repair] = (await listRecentPermissionEvents()).filter((event) => event.kind === "orphan-repair");
  assert.equal(repair.actor, "desktop");
  const stored = JSON.parse(await readFile(permissionsPath, "utf8"));
  assert.equal(stored.repairAudit.length, 1, "the repair summary is still written");
});

test("loading: unrecognised access gives no access, absent access stays legacy write", async () => {
  await seed({
    projectGrants: [
      { familiarId: "v1", projectId: "docs", source: "human", grantedAt: at },
      { familiarId: "odd", projectId: "docs", access: "admin", source: "human", grantedAt: at },
    ],
    accessGroups: [{
      id: "g", name: "G", memberFamiliarIds: ["member"], createdAt: at, updatedAt: at,
      projectGrants: [
        { projectId: "docs", access: "superuser", grantedAt: at },
        { projectId: "app", grantedAt: at },
      ],
    }],
    grantProposals: [],
  });
  const loaded = await loadProjectPermissions();
  assert.deepEqual(
    loaded.projectGrants.map((grant) => [grant.familiarId, grant.access]),
    [["v1", "write"]],
    "the v1 grant keeps write; the unrecognised one is not loaded",
  );
  assert.deepEqual(
    loaded.accessGroups[0].projectGrants.map((grant) => [grant.projectId, grant.access]),
    [["app", "write"]],
  );
});
