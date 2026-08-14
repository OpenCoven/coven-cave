// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    ProjectRegistryIntegrityError,
    projectById,
    projectForRoot,
    seedDefaultProjectsIfEmpty,
    sortProjectsAlphabetically,
  } = await import("./cave-projects.ts");
  const { projectForPickerQuery } = await import("./cave-projects-types.ts");
  const source = await readFile(new URL("./cave-projects.ts", import.meta.url), "utf8");

  assert.equal(
    source.includes(String.raw`replace(/\/+$/, "")`),
    false,
    "normalizeRoot should not use a trailing-slash regex on user-supplied roots",
  );

  assert.deepEqual(await loadProjects(), [], "missing projects file should load as an empty list");

  await writeFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, '{"version":1,"projects":[', "utf8");
  await assert.rejects(
    () => loadProjects(),
    ProjectRegistryIntegrityError,
    "a torn registry fails closed instead of reading as empty",
  );
  const tornBytes = await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8");
  await assert.rejects(
    () => createProject({ name: "Must not overwrite", root: "/torn" }),
    ProjectRegistryIntegrityError,
    "a mutation cannot overwrite a torn registry with an empty snapshot",
  );
  assert.equal(await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"), tornBytes);

  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({ version: 1, projects: [], visibilityGeneration: 42 }),
    "utf8",
  );
  await assert.rejects(
    () => loadProjects(),
    ProjectRegistryIntegrityError,
    "a wrong-schema registry fails closed",
  );
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [{
        id: "strict",
        name: "Strict",
        root: "/repo/strict",
        createdAt: "now",
        updatedAt: "now",
        unexpectedAuthorityField: true,
      }],
      visibilityGeneration: "strict-generation",
    }),
    "utf8",
  );
  await assert.rejects(
    () => loadProjects(),
    ProjectRegistryIntegrityError,
    "unknown project keys fail strict schema validation",
  );
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [],
      visibilityGeneration: "strict-generation",
      unexpectedTopLevel: true,
    }),
    "utf8",
  );
  await assert.rejects(
    () => loadProjects(),
    ProjectRegistryIntegrityError,
    "unknown registry keys fail strict schema validation",
  );

  await chmod(process.env.CAVE_PROJECTS_PATH_OVERRIDE, 0o000);
  await assert.rejects(
    () => loadProjects(),
    ProjectRegistryIntegrityError,
    "an unreadable registry fails closed",
  );
  await chmod(process.env.CAVE_PROJECTS_PATH_OVERRIDE, 0o600);
  await rm(process.env.CAVE_PROJECTS_PATH_OVERRIDE, { force: true });

  const created = await createProject({ name: "Test", root: "/tmp/test" });
  assert.ok(created.id, "created project should receive a stable id");
  assert.equal(created.name, "Test");
  assert.equal(created.root, "/tmp/test");
  assert.equal((await loadProjects()).length, 1);
  const generationAfterCreate = JSON.parse(
    await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
  ).visibilityGeneration;

  // cave-729h: one project per root. A second create at the same root (even the
  // trailing-slash variant) returns the existing project and writes no duplicate.
  const dup = await createProject({ name: "Dup", root: "/tmp/test/" });
  assert.equal(dup.id, created.id, "creating at an existing root returns the existing project");
  assert.equal(dup.name, "Test", "the existing project comes back unchanged, not renamed");
  assert.equal((await loadProjects()).length, 1, "no duplicate root is persisted on disk");
  assert.equal(
    JSON.parse(await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8")).visibilityGeneration,
    generationAfterCreate,
    "an idempotent duplicate create does not advance visibility",
  );

  const patched = await patchProject(created.id, { name: "New", root: "/tmp/test/" });
  assert.equal(patched?.name, "New");
  assert.equal(patched?.root, "/tmp/test");
  assert.equal(
    JSON.parse(await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8")).visibilityGeneration,
    generationAfterCreate,
    "a name-only/effective-root-no-op patch keeps visibility stable",
  );
  await patchProject(created.id, { root: "/tmp/test-rerooted" });
  const generationAfterReRoot = JSON.parse(
    await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
  ).visibilityGeneration;
  assert.notEqual(
    generationAfterReRoot,
    generationAfterCreate,
    "an effective root change advances visibility exactly once",
  );
  await patchProject(created.id, { root: "/tmp/test-rerooted" });
  assert.equal(
    JSON.parse(await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8")).visibilityGeneration,
    generationAfterReRoot,
    "a repeated no-op root patch does not advance visibility again",
  );
  await patchProject(created.id, { root: "/tmp/test" });

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

  // repoUrl: same string-sets / undefined-keeps / null-clears contract as color.
  const linked = await patchProject(created.id, { repoUrl: "https://github.com/OpenCoven/coven-cave" });
  assert.equal(linked?.repoUrl, "https://github.com/OpenCoven/coven-cave", "string sets the GitHub link");
  const untouchedKeepsRepo = await patchProject(created.id, { name: "New" });
  assert.equal(untouchedKeepsRepo?.repoUrl, "https://github.com/OpenCoven/coven-cave", "untouched patch keeps the link");
  const unlinked = await patchProject(created.id, { repoUrl: null });
  assert.equal(unlinked?.repoUrl, undefined, "null unlinks the repository");
  assert.equal(
    Object.prototype.hasOwnProperty.call(unlinked ?? {}, "repoUrl"),
    false,
    "cleared repoUrl is removed from the record, not persisted as null",
  );
  const createdLinked = await createProject({
    name: "Linked",
    root: "/tmp/linked",
    repoUrl: "https://github.com/OpenCoven/coven-docs",
  });
  assert.equal(createdLinked.repoUrl, "https://github.com/OpenCoven/coven-docs", "create persists a provided link");
  assert.equal(await deleteProject(createdLinked.id), true);

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
  const homeAbs = path.join(os.homedir(), "dupe-home").replace(/\\/g, "/");
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      visibilityGeneration: "dedupe-fixture",
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

  assert.equal(
    typeof projectForPickerQuery,
    "function",
    "the shared picker exposes a pure typed-query resolver",
  );
  const pickerProjects = [
    { id: "partial", name: "Alpha Coven tools", root: "/work/alpha", createdAt: "", updatedAt: "" },
    { id: "exact", name: "Coven", root: "/work/coven", createdAt: "", updatedAt: "" },
    { id: "root", name: "Toolkit", root: "/work/coven-runtime", createdAt: "", updatedAt: "" },
  ];
  assert.equal(
    projectForPickerQuery(pickerProjects, "  COVEN  ")?.id,
    "exact",
    "an exact project-name match wins over an alphabetically earlier partial match",
  );
  assert.equal(
    projectForPickerQuery(pickerProjects, "coven-r")?.id,
    "root",
    "typed queries retain the picker's existing root matching",
  );
  assert.equal(projectForPickerQuery(pickerProjects, "   "), null, "blank input selects nothing");

  // ── Task5 quality finding — project registry mutations invalidate the
  // shared sessions-list cache. Adding/removing a project or changing its
  // root can move sessions between the always-visible "(no project)" bucket
  // and a grant-checked known project, so registry writes are, just like a
  // permission-file write, a class of mutation that can alter effective
  // visibility. `saveProjects` (the one function every registry mutation
  // funnels through) must bust the shared cache AFTER a successful durable
  // write, and must NOT bust it when the write fails. ─────────────────────
  {
    const { sessionsListCache } = await import("./server/sessions-list-cache.ts");
    const { writeFile } = await import("node:fs/promises");
    const cacheKey = "cave-projects-invalidation-test";
    let computeCount = 0;
    const compute = async () => {
      computeCount += 1;
      return { payload: { ok: true, sessions: [] } };
    };

    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 1, "cache primed by the first read");
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 1, "sanity check: a fresh (unexpired) entry is served without recomputing");

    // A successful createProject busts the cache: the SAME key recomputes.
    const invalidationProject = await createProject({
      name: "Invalidation check",
      root: "/tmp/cache-invalidation-check",
    });
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 2, "a successful createProject invalidates the shared sessions-list cache");

    // A successful root change (patchProject) also busts it.
    await patchProject(invalidationProject.id, { root: "/tmp/cache-invalidation-check-2" });
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(
      computeCount,
      3,
      "a successful patchProject root change invalidates the shared sessions-list cache",
    );

    // A successful project removal also busts it.
    await deleteProject(invalidationProject.id);
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(computeCount, 4, "a successful deleteProject invalidates the shared sessions-list cache");

    // A FAILED registry write must NOT invalidate — a failed write never
    // pretends state changed. Force writeProjectsFile to fail by pointing
    // the registry path's parent directory segment at a plain file
    // (mkdir(..., {recursive:true}) throws ENOTDIR). The cache is already
    // warm (fresh) at computeCount 4 from the deleteProject read above.
    const blockerFile = path.join(tmpDir, "blocked-by-a-file");
    await writeFile(blockerFile, "not a directory", "utf8");
    const previousProjectsPathOverride = process.env.CAVE_PROJECTS_PATH_OVERRIDE;
    process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(blockerFile, "projects.json");
    await assert.rejects(
      () => createProject({ name: "Should fail", root: "/tmp/should-fail-registry-write" }),
      undefined,
      "createProject rejects when its durable write cannot land",
    );
    process.env.CAVE_PROJECTS_PATH_OVERRIDE = previousProjectsPathOverride;
    await sessionsListCache.get(cacheKey, compute);
    assert.equal(
      computeCount,
      4,
      "a failed project-registry write must NOT invalidate the cache — a failed write never pretends state changed",
    );

    sessionsListCache.clear(); // leave no test entry behind for later test files
  }

  console.log("cave-projects.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  await rm(tmpDir, { recursive: true, force: true });
}
