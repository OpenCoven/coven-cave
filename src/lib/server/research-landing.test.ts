import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = await mkdtemp(path.join(tmpdir(), "research-landing-test-"));
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(tmp, "research-missions");

const {
  ensureResearchLandingAccess,
  ensureResearchLandingProject,
  migrateAdHocMissionGrants,
  RESEARCH_LANDING_PROJECT_NAME,
} = await import("./research-landing.ts");
const { createProject, loadProjects } = await import("../cave-projects.ts");
const {
  createAccessGroup,
  effectiveProjectAccess,
  grantProjectToFamiliar,
  listProjectGrants,
  loadProjectPermissions,
} = await import("../project-permissions.ts");
const { researchMissionsRoot } = await import("./research-mission-store.ts");

test.after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("the research landing root is registered as a Cave project exactly once", async () => {
  const project = await ensureResearchLandingProject();
  assert.equal(project.name, RESEARCH_LANDING_PROJECT_NAME);
  assert.equal(project.root, researchMissionsRoot());
  // The root exists on disk — a registered-but-missing directory would be
  // dropped by savedCaveProjectRoots' validation and stay unusable.
  assert.ok((await stat(researchMissionsRoot())).isDirectory());

  const again = await ensureResearchLandingProject();
  assert.equal(again.id, project.id, "re-ensuring returns the same project");
  const projects = await loadProjects();
  assert.equal(
    projects.filter((entry) => entry.root === researchMissionsRoot()).length,
    1,
    "one project per landing root",
  );
});

test("run-start access check grants the landing project to a familiar without access", async () => {
  const first = await ensureResearchLandingAccess("sage");
  assert.equal(first.granted, true, "missing access is granted");
  const permissions = await loadProjectPermissions();
  const effective = effectiveProjectAccess(permissions, "sage", first.project.id);
  assert.equal(effective.level, "write");
  const grant = (await listProjectGrants()).find(
    (entry) => entry.familiarId === "sage" && entry.projectId === first.project.id,
  );
  assert.equal(grant?.source, "bootstrap");
});

test("an existing grant is left untouched on later runs", async () => {
  const before = await listProjectGrants();
  const second = await ensureResearchLandingAccess("sage");
  assert.equal(second.granted, false, "effective access short-circuits the grant");
  assert.deepEqual(await listProjectGrants(), before, "no grant record changed");
});

test("ad-hoc per-mission grants migrate onto the landing project", async () => {
  const landing = await ensureResearchLandingProject();
  const missionRoot = path.join(researchMissionsRoot(), "research-legacy-mission");
  const outside = await createProject({ name: "Unrelated", root: path.join(tmp, "unrelated") });
  const adHoc = await createProject({ name: "research-legacy-mission", root: missionRoot });
  await grantProjectToFamiliar({
    familiarId: "echo",
    projectId: adHoc.id,
    source: "human",
    access: "read",
  });
  await grantProjectToFamiliar({
    familiarId: "echo",
    projectId: outside.id,
    source: "human",
    access: "write",
  });
  // A group grant on the ad-hoc project must migrate its members too.
  await createAccessGroup({
    name: "Researchers",
    memberFamiliarIds: ["astra"],
    projectGrants: [{ projectId: adHoc.id, access: "write" }],
  });

  const result = await migrateAdHocMissionGrants(landing);
  assert.equal(result.removedProjects, 1);
  assert.deepEqual([...result.migratedFamiliarIds].sort(), ["astra", "echo"]);

  const permissions = await loadProjectPermissions();
  assert.equal(
    effectiveProjectAccess(permissions, "echo", landing.id).level,
    "read",
    "the direct ad-hoc level carries over",
  );
  assert.equal(
    effectiveProjectAccess(permissions, "astra", landing.id).level,
    "write",
    "the group ad-hoc level carries over",
  );
  const projects = await loadProjects();
  assert.ok(!projects.some((entry) => entry.id === adHoc.id), "ad-hoc project removed");
  assert.ok(projects.some((entry) => entry.id === outside.id), "unrelated project kept");
  assert.ok(
    !(await listProjectGrants()).some((entry) => entry.projectId === adHoc.id),
    "no grant still points at the removed project",
  );
  assert.ok(
    (await listProjectGrants()).some(
      (entry) => entry.familiarId === "echo" && entry.projectId === outside.id,
    ),
    "grants outside the landing root are untouched",
  );

  const again = await migrateAdHocMissionGrants(landing);
  assert.deepEqual(again, { removedProjects: 0, migratedFamiliarIds: [] }, "idempotent");
});

test("migration never downgrades an existing landing grant", async () => {
  const landing = await ensureResearchLandingProject();
  // sage already holds write on the landing project from the earlier test.
  const adHoc = await createProject({
    name: "research-old-mission",
    root: path.join(researchMissionsRoot(), "research-old-mission"),
  });
  await grantProjectToFamiliar({
    familiarId: "sage",
    projectId: adHoc.id,
    source: "human",
    access: "read",
  });
  const result = await migrateAdHocMissionGrants(landing);
  assert.equal(result.removedProjects, 1);
  assert.deepEqual(result.migratedFamiliarIds, [], "write already satisfies read");
  const permissions = await loadProjectPermissions();
  assert.equal(effectiveProjectAccess(permissions, "sage", landing.id).level, "write");
});
