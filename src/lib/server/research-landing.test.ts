import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const tmp = await mkdtemp(path.join(tmpdir(), "research-landing-test-"));
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(tmp, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(tmp, "permission-config.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "projects.json");
process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(tmp, "research-missions");

const { ensureResearchLandingAccess } = await import("./research-landing.ts");
const { createProject, loadProjects } = await import("../cave-projects.ts");
const {
  effectiveProjectAccess,
  grantProjectToFamiliar,
  listProjectGrants,
  loadProjectPermissions,
} = await import("../project-permissions.ts");
const { researchMissionWorkspacePath, researchMissionsRoot } = await import(
  "./research-mission-store.ts"
);

test.after(async () => rm(tmp, { recursive: true, force: true }));

test("run-start grants only the current mission workspace", async () => {
  const first = await ensureResearchLandingAccess("sage", "research-sage-one");
  assert.equal(first.granted, true);
  assert.equal(first.project.root, researchMissionWorkspacePath("research-sage-one"));
  const permissions = await loadProjectPermissions();
  assert.equal(effectiveProjectAccess(permissions, "sage", first.project.id).level, "write");
  assert.ok(!(await loadProjects()).some((project) => project.root === researchMissionsRoot()));

  const second = await ensureResearchLandingAccess("sage", "research-sage-one");
  assert.equal(second.granted, false, "an existing mission grant is unchanged");
  assert.equal(second.project.id, first.project.id);
});

test("a familiar cannot inherit access to another mission", async () => {
  const sage = await ensureResearchLandingAccess("sage", "research-sage-two");
  const echo = await ensureResearchLandingAccess("echo", "research-echo-one");
  const permissions = await loadProjectPermissions();
  assert.equal(effectiveProjectAccess(permissions, "sage", echo.project.id).level, null);
  assert.equal(effectiveProjectAccess(permissions, "echo", sage.project.id).level, null);
});

test("an insecure shared landing project from an older release is removed", async () => {
  const shared = await createProject({ name: "Research Missions", root: researchMissionsRoot() });
  await grantProjectToFamiliar({
    familiarId: "legacy",
    projectId: shared.id,
    source: "bootstrap",
    access: "write",
  });

  await ensureResearchLandingAccess("legacy", "research-legacy-one");
  assert.ok(!(await loadProjects()).some((project) => project.id === shared.id));
  assert.ok(!(await listProjectGrants()).some((grant) => grant.projectId === shared.id));
});
