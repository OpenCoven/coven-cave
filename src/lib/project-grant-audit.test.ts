// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Grant-change logging (cave-keqjk). `permissionAudit` records access-CHECK
// decisions — "was this familiar allowed to do X". It structurally cannot
// answer "who widened this grant, when, and from what", because it has no
// before/after and is only written on the check path. `grantAudit` is the
// separate log that answers that, and these tests pin it end to end.

const tmp = await mkdtemp(path.join(tmpdir(), "grant-audit-test-"));
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
process.env.CAVE_SUPREME_FAMILIAR_ID = "supreme";

const {
    grantProjectToFamiliar,
    revokeProjectFromFamiliar,
    revokeAllGrantsForProject,
    createAccessGroup,
    listRecentGrantChanges,
    loadProjectPermissions,
} = await import("./project-permissions.ts");

// Cleanup must be a node:test hook — a plain try/finally runs to completion
// before the scheduled tests execute and would delete the store underneath them.
after(async () => {
await rm(tmp, { recursive: true, force: true });
});

test("a new grant records from:null → the granted level", async () => {
    await grantProjectToFamiliar({
      familiarId: "nova",
      projectId: "p1",
      source: "human",
      access: "read",
      actor: "loopback",
    });
    const [entry] = await listRecentGrantChanges();
    assert.equal(entry.familiarId, "nova");
    assert.equal(entry.projectId, "p1");
    assert.equal(entry.from, null, "there was no prior grant");
    assert.equal(entry.to, "read");
    assert.equal(entry.actor, "loopback");
    assert.equal(entry.kind, "direct");
    assert.equal(entry.source, "human");
    assert.ok(entry.id && entry.at, "entries are identified and timestamped");
});

test("a widening records the level it came from", async () => {
    await grantProjectToFamiliar({
      familiarId: "nova",
      projectId: "p1",
      source: "human",
      access: "write",
      actor: "loopback",
    });
    const [entry] = await listRecentGrantChanges();
    assert.equal(entry.from, "read", "the prior level survives the in-place overwrite");
    assert.equal(entry.to, "write");
});

test("a downgrade is recorded with the same fidelity as a widening", async () => {
    await grantProjectToFamiliar({
      familiarId: "nova",
      projectId: "p1",
      source: "human",
      access: "read",
      actor: "mobile",
    });
    const [entry] = await listRecentGrantChanges();
    assert.equal(entry.from, "write");
    assert.equal(entry.to, "read");
    assert.equal(entry.actor, "mobile", "a phone-initiated change is distinguishable");
});

test("a no-op re-grant records nothing", async () => {
    const before = (await listRecentGrantChanges()).length;
    await grantProjectToFamiliar({
      familiarId: "nova",
      projectId: "p1",
      source: "human",
      access: "read",
      actor: "loopback",
    });
    assert.equal(
      (await listRecentGrantChanges()).length,
      before,
      "setting the level it already has is not a change",
    );
});

test("a revoke records to:null and keeps the level that was lost", async () => {
    await revokeProjectFromFamiliar({ familiarId: "nova", projectId: "p1", actor: "loopback" });
    const [entry] = await listRecentGrantChanges();
    assert.equal(entry.from, "read", "what was lost is the whole point of the record");
    assert.equal(entry.to, null);
    assert.equal(entry.kind, "direct");
});

test("revoking something that was never granted records nothing", async () => {
    const before = (await listRecentGrantChanges()).length;
    const revoked = await revokeProjectFromFamiliar({ familiarId: "ghost", projectId: "p1" });
    assert.equal(revoked, false);
    assert.equal((await listRecentGrantChanges()).length, before);
});

test("removing a project records one entry per familiar it silently dropped", async () => {
    await grantProjectToFamiliar({ familiarId: "sage", projectId: "p2", source: "human", access: "write" });
    await grantProjectToFamiliar({ familiarId: "cody", projectId: "p2", source: "human", access: "read" });
    await createAccessGroup({
      name: "Coders",
      memberFamiliarIds: ["kitty"],
      projectGrants: [{ projectId: "p2", access: "write" }],
    });

    const before = (await listRecentGrantChanges()).length;
    const counts = await revokeAllGrantsForProject("p2");
    assert.equal(counts.grants, 2);

    const added = (await listRecentGrantChanges()).slice(0, (await listRecentGrantChanges()).length - before);
    const forP2 = added.filter((e) => e.projectId === "p2");
    const byFamiliar = Object.fromEntries(forP2.map((e) => [e.familiarId, e]));

    // The cascade is the least visible change of all — it drops access for
    // several familiars at once with no per-familiar action to attribute it to.
    assert.ok(byFamiliar.sage, "direct grant holder recorded");
    assert.equal(byFamiliar.sage.from, "write");
    assert.equal(byFamiliar.sage.to, null);
    assert.equal(byFamiliar.sage.kind, "project-removed");
    assert.ok(byFamiliar.cody, "second direct grant holder recorded");
    assert.equal(byFamiliar.cody.from, "read");
    assert.ok(byFamiliar.kitty, "group member who loses inherited access is recorded too");
    assert.equal(byFamiliar.kitty.kind, "project-removed");
    assert.ok(byFamiliar.kitty.groupId, "the group it came through is named");
});

test("the change log is written in the same save as the change it describes", async () => {
    await grantProjectToFamiliar({ familiarId: "echo", projectId: "p3", source: "human", access: "write" });
    const file = await loadProjectPermissions();
    const grant = file.projectGrants.find((g) => g.familiarId === "echo" && g.projectId === "p3");
    const logged = file.grantAudit.find((e) => e.familiarId === "echo" && e.projectId === "p3");
    assert.ok(grant, "grant persisted");
    assert.ok(logged, "record persisted alongside it — never one without the other");
    assert.equal(logged.to, grant.access);
});

test("the check log is left alone — the two answer different questions", async () => {
    const file = await loadProjectPermissions();
    assert.ok(Array.isArray(file.permissionAudit), "permissionAudit still exists");
    assert.equal(
      file.permissionAudit.length,
      0,
      "grant mutations must not write into the access-check log",
    );
    assert.ok(file.grantAudit.length > 0, "they land in grantAudit instead");
});

test("a store written before this log existed loads as empty, not broken", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE,
      JSON.stringify({
        version: 2,
        projectGrants: [{ familiarId: "nova", projectId: "old", access: "write", source: "human", grantedAt: "2026-01-01T00:00:00.000Z" }],
        accessGroups: [],
        grantProposals: [],
        permissionAudit: [],
      }),
      "utf8",
    );
    const file = await loadProjectPermissions();
    assert.deepEqual(file.grantAudit, [], "no history is invented for pre-existing grants");
    assert.equal(file.projectGrants.length, 1, "the rest of the store is untouched");
});

console.log("project-grant-audit.test.ts: ok");
