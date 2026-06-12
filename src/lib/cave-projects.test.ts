// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cave-projects-test-"));
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmpDir, "cave-projects.json");

try {
  const {
    createProject,
    deleteProject,
    loadProjects,
    patchProject,
    projectById,
    projectForRoot,
    seedDefaultProjectsIfEmpty,
  } = await import("./cave-projects.ts");

  assert.deepEqual(await loadProjects(), [], "missing projects file should load as an empty list");

  const created = await createProject({ name: "Test", root: "/tmp/test" });
  assert.ok(created.id, "created project should receive a stable id");
  assert.equal(created.name, "Test");
  assert.equal(created.root, "/tmp/test");
  assert.equal((await loadProjects()).length, 1);

  const patched = await patchProject(created.id, { name: "New", root: "/tmp/test/" });
  assert.equal(patched?.name, "New");
  assert.equal(patched?.root, "/tmp/test");

  const projects = await loadProjects();
  assert.equal(projectForRoot("/tmp/test/", projects)?.id, created.id);
  assert.equal(projectForRoot("/other", projects), null);
  assert.equal(projectById(created.id, projects)?.name, "New");
  assert.equal(projectById("missing", projects), null);

  assert.equal(await deleteProject(created.id), true);
  assert.equal(await deleteProject(created.id), false);
  assert.deepEqual(await loadProjects(), []);

  await seedDefaultProjectsIfEmpty();
  assert.deepEqual(
    await loadProjects(),
    [],
    "seedDefaultProjectsIfEmpty is a no-op — users create projects via the UI",
  );
  await seedDefaultProjectsIfEmpty();
  assert.equal((await loadProjects()).length, 0, "calling seed twice remains a no-op");

  console.log("cave-projects.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  await rm(tmpDir, { recursive: true, force: true });
}
