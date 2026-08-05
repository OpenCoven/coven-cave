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
    acknowledgeProjectRootMigrations,
    loadProjects,
    patchProject,
    projectById,
    projectForRoot,
    seedDefaultProjectsIfEmpty,
    sortProjectsAlphabetically,
  } = await import("./cave-projects.ts");
  const {
    normalizeProjectRoot,
    projectForPickerQuery,
    projectIdMigrationMap,
  } = await import("./cave-projects-types.ts");
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

  const driveRoot = await createProject({ name: "Drive root", root: "C:\\" });
  assert.equal(
    driveRoot.root,
    normalizeProjectRoot("C:\\"),
    "server and client preserve the same canonical drive-root form",
  );
  const driveRootLegacyAlias = await createProject({ name: "Legacy drive alias", root: "C:" });
  assert.equal(driveRootLegacyAlias.id, driveRoot.id, "C: and C:/ cannot split project identity");
  const uncRoot = await createProject({ name: "UNC root", root: "\\\\Server\\Share\\" });
  assert.equal(
    uncRoot.root,
    normalizeProjectRoot("\\\\Server\\Share\\"),
    "server and client preserve the same canonical UNC root",
  );
  const windowsCase = await createProject({ name: "Windows case", root: "C:/Work/Case-App" });
  const windowsCaseAlias = await createProject({
    name: "Windows case alias",
    root: "c:\\work\\CASE-app\\",
  });
  assert.equal(
    windowsCaseAlias.id,
    windowsCase.id,
    "drive-root project creation uses case-insensitive path identity",
  );
  assert.equal(
    projectForRoot("c:/WORK/case-APP", await loadProjects())?.id,
    windowsCase.id,
    "drive-root lookup uses the same path identity as creation",
  );
  const uncCase = await createProject({ name: "UNC case", root: "//Server/Share/Case-App" });
  const uncCaseAlias = await createProject({
    name: "UNC case alias",
    root: "\\\\server\\share\\CASE-app",
  });
  assert.equal(
    uncCaseAlias.id,
    uncCase.id,
    "UNC project creation uses case-insensitive path identity",
  );
  const collisionSource = await createProject({ name: "Collision source", root: "D:/Work/Other" });
  const windowsCollision = await patchProject(collisionSource.id, {
    root: "c:/work/case-app",
  });
  assert.equal(
    windowsCollision?.root,
    "D:/Work/Other",
    "patch collision checks use case-insensitive drive identity",
  );
  const posixUpper = await createProject({ name: "POSIX upper", root: "/Work/Case-App" });
  const posixLower = await createProject({ name: "POSIX lower", root: "/work/case-app" });
  assert.notEqual(posixUpper.id, posixLower.id, "POSIX project identity stays case-sensitive");
  let posixBackslash;
  let posixSeparator;
  if (process.platform !== "win32") {
    posixBackslash = await createProject({
      name: "POSIX backslash",
      root: String.raw`/repo/packages/app\name`,
    });
    posixSeparator = await createProject({
      name: "POSIX separator",
      root: "/repo/packages/app/name",
    });
    assert.notEqual(
      posixBackslash.id,
      posixSeparator.id,
      "POSIX project storage cannot collapse a filename backslash into a separator",
    );
    assert.equal(posixBackslash.root, String.raw`/repo/packages/app\name`);
    const collisionProjects = await loadProjects();
    assert.equal(
      projectIdMigrationMap(collisionProjects).size,
      0,
      "normalizer alias collisions never merge project ids or their grants",
    );
  }

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
  assert.equal(
    projectById("reused-id", [
      {
        id: "survivor",
        name: "Survivor",
        root: "/survivor",
        legacyProjectIds: ["reused-id"],
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "reused-id",
        name: "Current",
        root: "/current",
        createdAt: "",
        updatedAt: "",
      },
    ])?.name,
    "Current",
    "an exact current project id wins over a stale legacy alias",
  );

  assert.equal(await deleteProject(created.id), true);
  assert.equal(await deleteProject(created.id), false);
  assert.equal(await deleteProject(slashHeavy.id), true);
  assert.equal(await deleteProject(driveRoot.id), true);
  assert.equal(await deleteProject(uncRoot.id), true);
  assert.equal(await deleteProject(windowsCase.id), true);
  assert.equal(await deleteProject(uncCase.id), true);
  assert.equal(await deleteProject(collisionSource.id), true);
  assert.equal(await deleteProject(posixUpper.id), true);
  assert.equal(await deleteProject(posixLower.id), true);
  if (posixBackslash && posixSeparator) {
    assert.equal(await deleteProject(posixBackslash.id), true);
    assert.equal(await deleteProject(posixSeparator.id), true);
  }
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
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "slash-row",
          name: "Trailing slash",
          root: `${homeAbs}/`,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "abs-row",
          name: "Absolute",
          root: homeAbs,
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  const dedupedLoad = await loadProjects();
  assert.deepEqual(
    dedupedLoad.map((entry) => entry.id).sort(),
    ["abs-row", "disk-new"],
    "loadProjects collapses on-disk duplicates by normalized path, newest wins",
  );
  assert.deepEqual(
    dedupedLoad.find((entry) => entry.id === "abs-row")?.legacyRoots,
    ["~/dupe-home", `${homeAbs}/`],
    "canonical dedupe retains every original root alias for client migrations",
  );
  assert.deepEqual(
    dedupedLoad.find((entry) => entry.id === "abs-row")?.legacyProjectIds,
    ["tilde-row", "slash-row"],
    "canonical dedupe retains every losing project id for durable reference migration",
  );
  assert.equal(
    projectForRoot("/tmp/dupe/", dedupedLoad)?.id,
    "disk-new",
    "path lookups resolve to the surviving (newest) duplicate",
  );
  // An unrelated mutation persists the deduped list but MUST retain migration
  // metadata until the client confirms every root-keyed store succeeded.
  assert.equal((await patchProject("disk-new", { name: "Newest" }))?.name, "Newest");
  const pendingMigration = JSON.parse(
    await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
  );
  assert.deepEqual(
    pendingMigration.projects.find((entry) => entry.id === "abs-row")?.legacyRoots,
    ["~/dupe-home", `${homeAbs}/`],
    "an unrelated project mutation cannot erase pending root aliases",
  );
  assert.deepEqual(
    pendingMigration.projects.find((entry) => entry.id === "abs-row")?.legacyProjectIds,
    ["tilde-row", "slash-row"],
    "losing-id aliases remain durable while references still use them",
  );

  await acknowledgeProjectRootMigrations([
    { projectId: "abs-row", legacyRoots: ["~/dupe-home", `${homeAbs}/`] },
    { projectId: "disk-new", legacyRoots: ["/tmp/dupe/"] },
  ]);
  const acknowledged = JSON.parse(
    await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
  );
  for (const entry of acknowledged.projects) {
    assert.equal("legacyRoot" in entry, false, "acknowledgment removes the singular root alias");
    assert.equal("legacyRoots" in entry, false, "acknowledgment removes completed root retries");
  }
  assert.deepEqual(
    acknowledged.projects.find((entry) => entry.id === "abs-row")?.legacyProjectIds,
    ["tilde-row", "slash-row"],
    "root migration acknowledgment never drops the independent project-id map",
  );

  assert.equal(await deleteProject("abs-row"), true);
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

  if (process.platform !== "win32") {
    const upgradeProjects = [
      {
        id: "safe-backslash",
        name: "Safe backslash",
        root: String.raw`/upgrade/safe\name`,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "safe-whitespace",
        name: "Safe whitespace",
        root: "/upgrade/edge ",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "collision-backslash",
        name: "Collision backslash",
        root: String.raw`/upgrade/collision\name`,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "collision-separator",
        name: "Collision separator",
        root: "/upgrade/collision/name",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "collision-whitespace",
        name: "Collision whitespace",
        root: "/upgrade/occupied ",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "collision-trimmed",
        name: "Collision trimmed",
        root: "/upgrade/occupied",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    await writeFile(
      process.env.CAVE_PROJECTS_PATH_OVERRIDE,
      JSON.stringify({ version: 1, projects: upgradeProjects }),
      "utf8",
    );
    const upgraded = await loadProjects();
    assert.equal(upgraded.length, upgradeProjects.length, "current POSIX roots stay distinct");
    assert.deepEqual(
      upgraded.find((project) => project.id === "safe-backslash")?.legacyRoots,
      ["/upgrade/safe/name"],
      "a preserved POSIX backslash root advertises the prior canonical client key",
    );
    assert.deepEqual(
      upgraded.find((project) => project.id === "safe-whitespace")?.legacyRoots,
      ["/upgrade/edge"],
      "a preserved POSIX edge-space root advertises the prior trimmed client key",
    );
    assert.equal(
      upgraded.find((project) => project.id === "collision-backslash")?.legacyRoots,
      undefined,
      "a separator sibling blocks an unsafe prior backslash alias",
    );
    assert.equal(
      upgraded.find((project) => project.id === "collision-whitespace")?.legacyRoots,
      undefined,
      "a trimmed sibling blocks an unsafe prior whitespace alias",
    );
    assert.equal(
      projectIdMigrationMap(upgraded).size,
      0,
      "root-key collisions never become project-id migrations",
    );

    await acknowledgeProjectRootMigrations([
      { projectId: "safe-backslash", legacyRoots: ["/upgrade/safe/name"] },
      { projectId: "safe-whitespace", legacyRoots: ["/upgrade/edge"] },
    ]);
    const upgradedDisk = JSON.parse(
      await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
    );
    assert.equal(
      upgradedDisk.rootKeyNormalizerVersion,
      2,
      "the projects file records that prior canonical aliases were materialized",
    );
    assert.equal(
      (await loadProjects()).some((project) => project.legacyRoots?.length),
      false,
      "acknowledged POSIX aliases are not re-derived on every load",
    );
    for (const project of upgradeProjects) {
      assert.equal(await deleteProject(project.id), true);
    }
  }

  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: "legacy-drive-root",
          name: "Legacy drive root",
          root: "C:",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  const [migratedDriveRoot] = await loadProjects();
  assert.equal(migratedDriveRoot?.root, "C:/");
  assert.equal(migratedDriveRoot?.legacyRoot, "C:", "clients can re-key stores from the legacy root");
  assert.deepEqual(migratedDriveRoot?.legacyRoots, ["C:"]);
  const persistedDriveRoot = await patchProject("legacy-drive-root", { name: "Migrated drive root" });
  assert.equal(persistedDriveRoot?.root, "C:/");
  const migratedDisk = JSON.parse(
    await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
  );
  assert.equal(migratedDisk.projects[0]?.root, "C:/", "the next mutation self-heals legacy C:");
  assert.deepEqual(
    migratedDisk.projects[0]?.legacyRoots,
    ["C:"],
    "self-healing the root retains its pending client migration",
  );
  await acknowledgeProjectRootMigrations([
    { projectId: "legacy-drive-root", legacyRoots: ["C:"] },
  ]);
  const acknowledgedDrive = JSON.parse(
    await readFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"),
  );
  assert.equal("legacyRoot" in acknowledgedDrive.projects[0], false);
  assert.equal("legacyRoots" in acknowledgedDrive.projects[0], false);
  assert.equal(await deleteProject("legacy-drive-root"), true);

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
      root: "c:/WORK/ALPHA",
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
    dedupeProjectsByRoot(duplicateRootProjects)[0]?.legacyProjectIds,
    ["old"],
    "the survivor carries a deterministic map from every losing project id",
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

  console.log("cave-projects.test.ts: ok");
} finally {
  delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
  await rm(tmpDir, { recursive: true, force: true });
}
