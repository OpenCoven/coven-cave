// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cave-projects-test-"));
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmpDir, "cave-projects.json");

try {
  const {
    createProject,
    deleteProject,
    dedupeProjectsByRoot,
    loadProjects,
    patchProject,
    projectById,
    projectForRoot,
    seedDefaultProjectsIfEmpty,
    sortProjectsAlphabetically,
  } = await import("./cave-projects.ts");
  const source = await readFile(new URL("./cave-projects.ts", import.meta.url), "utf8");

  assert.equal(
    source.includes(String.raw`replace(/\/+$/, "")`),
    false,
    "normalizeRoot should not use a trailing-slash regex on user-supplied roots",
  );

  assert.deepEqual(await loadProjects(), [], "missing projects file should load as an empty list");

  const created = await createProject({ name: "Test", root: "/tmp/test" });
  assert.ok(created.id, "created project should receive a stable id");
  assert.equal(created.name, "Test");
  assert.equal(created.root, "/tmp/test");
  assert.equal((await loadProjects()).length, 1);

  // cave-729h: one project per root. A second create at the same root (even the
  // trailing-slash variant) returns the existing project and writes no duplicate.
  const dup = await createProject({ name: "Dup", root: "/tmp/test/" });
  assert.equal(dup.id, created.id, "creating at an existing root returns the existing project");
  assert.equal(dup.name, "Test", "the existing project comes back unchanged, not renamed");
  assert.equal((await loadProjects()).length, 1, "no duplicate root is persisted on disk");

  const patched = await patchProject(created.id, { name: "New", root: "/tmp/test/" });
  assert.equal(patched?.name, "New");
  assert.equal(patched?.root, "/tmp/test");

  // color: string sets, undefined leaves untouched, null clears (back to the
  // auto root-hash tint — the field disappears rather than persisting null).
  const colored = await patchProject(created.id, { color: "oklch(0.74 0.12 250)" });
  assert.equal(colored?.color, "oklch(0.74 0.12 250)");
  const rootPatchKeepsColor = await patchProject(created.id, { root: "/tmp/test" });
  assert.equal(rootPatchKeepsColor?.color, "oklch(0.74 0.12 250)", "untouched patch keeps the color");
  const cleared = await patchProject(created.id, { color: null });
  assert.equal(cleared?.color, undefined, "null clears the explicit color");
  assert.equal(
    Object.prototype.hasOwnProperty.call(cleared ?? {}, "color"),
    false,
    "cleared color is removed from the record, not persisted as null",
  );

  const slashHeavy = await createProject({
    name: "Slash heavy",
    root: `  C:\\tmp\\slash-heavy${"/".repeat(5000)}  `,
  });
  assert.equal(slashHeavy.root, "C:/tmp/slash-heavy");

  // (cave-psp8) A manually-typed ~/path expands to the absolute home path —
  // stored literally it never matched the daemon's absolute project_root, so
  // Sessions/Git/Tasks stayed empty and the project looked dead.
  const tilde = await createProject({ name: "Tilde", root: "~/code/my-app" });
  assert.equal(
    tilde.root,
    path.join(os.homedir(), "code/my-app").replace(/\\/g, "/"),
    "leading ~/ expands to the home directory",
  );
  const bareTilde = await createProject({ name: "Home", root: "~" });
  assert.equal(
    bareTilde.root,
    os.homedir().replace(/\\/g, "/"),
    "a bare ~ expands to the home directory",
  );
  // Remove the tilde fixtures so the exact-list assertions below stay true.
  await deleteProject(tilde.id);
  await deleteProject(bareTilde.id);

  const allSlashProject = await createProject({ name: "All slash", root: "/all-slash" });
  const rootOnly = await patchProject(allSlashProject.id, { root: "////" });
  assert.equal(rootOnly?.root, "/");

  // cave-729h: a root change that would collide with a *different* project is
  // dropped (keeps the one-per-root invariant), but the patch's other fields apply.
  const collideSrc = await createProject({ name: "Collide", root: "/tmp/collide-src" });
  const collided = await patchProject(collideSrc.id, { name: "Renamed", root: "/tmp/test" });
  assert.equal(collided?.root, "/tmp/collide-src", "a root change colliding with another project is dropped");
  assert.equal(collided?.name, "Renamed", "non-colliding fields of the same patch still apply");
  assert.equal(
    (await loadProjects()).filter((entry) => entry.root === "/tmp/test").length,
    1,
    "only one project ever owns /tmp/test",
  );
  // Restore the store to the three projects the rest of the suite expects.
  await deleteProject(collideSrc.id);

  const projects = await loadProjects();
  assert.equal(projectForRoot("/tmp/test/", projects)?.id, created.id);
  assert.equal(projectForRoot(`C:/tmp/slash-heavy${"/".repeat(5000)}`, projects)?.id, slashHeavy.id);
  assert.equal(projectForRoot("/other", projects), null);
  assert.equal(projectById(created.id, projects)?.name, "New");
  assert.equal(projectById("missing", projects), null);

  assert.equal(await deleteProject(created.id), true);
  assert.equal(await deleteProject(created.id), false);
  assert.equal(await deleteProject(slashHeavy.id), true);
  assert.equal(await deleteProject(allSlashProject.id), true);
  assert.deepEqual(await loadProjects(), []);

  await seedDefaultProjectsIfEmpty();
  assert.deepEqual(
    await loadProjects(),
    [],
    "seedDefaultProjectsIfEmpty is a no-op — users create projects via the UI",
  );
  await seedDefaultProjectsIfEmpty();
  assert.equal((await loadProjects()).length, 0, "calling seed twice remains a no-op");

  // Paths are the source of truth for identity: duplicate rows already on disk
  // (persisted before the one-per-root guard, or written by hand) collapse at
  // load time, so server consumers (projectById/trustedProjectCwd) can never
  // resolve an entry the UI hides. Newest record wins; ~ expands like the
  // server normalizer so a tilde row and its absolute twin are one project.
  const { writeFile } = await import("node:fs/promises");
  const homeAbs = path.join(os.homedir(), "dupe-home").replace(/\\/g, "/");
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: "disk-old",
          name: "Old",
          root: "/tmp/dupe",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "disk-new",
          name: "New",
          root: "/tmp/dupe/",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "tilde-row",
          name: "Tilde",
          root: "~/dupe-home",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "abs-row",
          name: "Absolute",
          root: homeAbs,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  const dedupedLoad = await loadProjects();
  assert.deepEqual(
    dedupedLoad.map((entry) => entry.id).sort(),
    ["disk-new", "tilde-row"],
    "loadProjects collapses on-disk duplicates by normalized path, newest wins",
  );
  assert.equal(
    projectForRoot("/tmp/dupe/", dedupedLoad)?.id,
    "disk-new",
    "path lookups resolve to the surviving (newest) duplicate",
  );
  // The next mutation persists the deduped list — the file self-heals.
  assert.equal(await deleteProject("tilde-row"), true);
  const healed = JSON.parse(
    await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
  );
  assert.deepEqual(
    healed.projects.map((entry) => entry.id),
    ["disk-new"],
    "a write after load persists the deduped list, dropping stale duplicate rows",
  );
  assert.equal(await deleteProject("disk-new"), true);
  assert.deepEqual(await loadProjects(), []);

  assert.deepEqual(
    sortProjectsAlphabetically([
      { id: "z", name: "Zed", root: "/work/zed", createdAt: "", updatedAt: "" },
      { id: "a2", name: "alpha", root: "/work/alpha-2", createdAt: "", updatedAt: "" },
      { id: "a1", name: "Alpha", root: "/work/alpha-1", createdAt: "", updatedAt: "" },
    ]).map((project) => project.id),
    ["a1", "a2", "z"],
    "shared project sorting is alphabetical by name, then root",
  );

  const duplicateRootProjects = [
    {
      id: "old",
      name: "Old alpha",
      root: `C:\\work\\alpha${"/".repeat(4)}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "new",
      name: "Alpha",
      root: "C:/work/alpha",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    { id: "solo", name: "Solo", root: "/work/solo", createdAt: "", updatedAt: "" },
  ];
  assert.deepEqual(
    dedupeProjectsByRoot(duplicateRootProjects).map((project) => project.id),
    ["new", "solo"],
    "project dedupe keeps one row per normalized root and prefers the newest record",
  );
  assert.deepEqual(
    sortProjectsAlphabetically([
      { id: "z", name: "Zed", root: "/work/zed", createdAt: "", updatedAt: "" },
      ...duplicateRootProjects,
    ]).map((project) => project.id),
    ["new", "solo", "z"],
    "shared project sorting deduplicates by normalized root before alphabetical order",
  );

  console.log("cave-projects.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  await rm(tmpDir, { recursive: true, force: true });
}
