// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { access, chmod, lstat, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const originalCwd = process.cwd();
const artifactRoot = path.join(originalCwd, ".test-artifacts", `changes-route-revert-${process.pid}`);
const repoRoot = path.join(artifactRoot, "repo");
const projectRoot = path.join(repoRoot, "packages", "app");
const siblingRoot = path.join(repoRoot, "packages", "sibling");
const spacedProjectRoot = path.join(repoRoot, "packages", "trail-project ");
const trimmedProjectRoot = path.join(repoRoot, "packages", "trail-project");
const runnerCwd = path.join(artifactRoot, "runner");
const projectsPath = path.join(artifactRoot, "projects.json");
const appFile = path.join(projectRoot, "src", "a.ts");
const unrelatedUntrackedFile = path.join(projectRoot, "notes", "keep.txt");
const spacedFile = path.join(projectRoot, "src", "name ");
const trimmedSiblingFile = path.join(projectRoot, "src", "name");
const parentFile = path.join(repoRoot, "src", "a.ts");
const siblingFile = path.join(siblingRoot, "src", "a.ts");
const hookMarker = path.join(artifactRoot, "post-checkout-ran");
const filterMarker = path.join(artifactRoot, "smudge-filter-ran");
const markerScript = path.join(artifactRoot, "mark.mjs");
const filterScript = path.join(artifactRoot, "filter.mjs");
const spacedProjectFile = path.join(spacedProjectRoot, "src", "same.ts");
const trimmedProjectFile = path.join(trimmedProjectRoot, "src", "same.ts");
const deletedFile = path.join(projectRoot, "src", "deleted.ts");
const renamedFromFile = path.join(projectRoot, "src", "renamed-from.ts");
const renamedToFile = path.join(projectRoot, "src", "renamed-to.ts");
const escapedSymlink = path.join(projectRoot, "src", "outside-link.ts");
const envKeys = [
  "CAVE_PROJECTS_PATH_OVERRIDE",
  "COVEN_HOME",
  "COVEN_CAVE_HOME",
  "COVEN_SOCKET",
  "COVEN_WORKSPACES_ROOT",
  "COVEN_WORKSPACE_ROOT",
  "WORKSPACE_ROOT",
  "NEXT_PUBLIC_WORKSPACE_ROOT",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function revertRequest(
  targetPath: string,
  confirmUntracked = false,
  root = projectRoot,
): Request {
  return new Request("http://127.0.0.1/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify({
      action: "revert",
      projectRoot: root,
      path: targetPath,
      confirmUntracked,
    }),
  });
}

function repoRelativeRevertRequest(
  repoRelativePath: string,
  confirmUntracked = false,
  root = projectRoot,
): Request {
  return new Request("http://127.0.0.1/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify({
      action: "revert",
      projectRoot: root,
      repoRelativePath,
      confirmUntracked,
    }),
  });
}

function checkpointRequest(
  action: "restore-checkpoint" | "delete-checkpoint",
  root: string,
  checkpoint: string,
): Request {
  return new Request("http://127.0.0.1/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify({ action, projectRoot: root, checkpoint }),
  });
}

async function withRenameSyncHook(
  hook: (
    source: string,
    destination: string,
    rename: typeof fs.renameSync,
  ) => void,
  action: () => Promise<Response>,
): Promise<Response> {
  const renameSync = fs.renameSync;
  fs.renameSync = ((source, destination) => {
    hook(String(source), String(destination), renameSync);
  }) as typeof fs.renameSync;
  try {
    return await action();
  } finally {
    fs.renameSync = renameSync;
  }
}

await rm(artifactRoot, { recursive: true, force: true });
try {
  await Promise.all([
    mkdir(path.dirname(appFile), { recursive: true }),
    mkdir(path.dirname(parentFile), { recursive: true }),
    mkdir(path.dirname(siblingFile), { recursive: true }),
    mkdir(path.dirname(spacedProjectFile), { recursive: true }),
    mkdir(path.dirname(trimmedProjectFile), { recursive: true }),
    mkdir(runnerCwd, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(appFile, "app base\n"),
    writeFile(spacedFile, "spaced base\n"),
    writeFile(trimmedSiblingFile, "trimmed base\n"),
    writeFile(parentFile, "parent base\n"),
    writeFile(siblingFile, "sibling base\n"),
    writeFile(spacedProjectFile, "spaced project base\n"),
    writeFile(trimmedProjectFile, "trimmed project base\n"),
    writeFile(deletedFile, "deleted base\n"),
    writeFile(renamedFromFile, "renamed base\n"),
    writeFile(
      path.join(repoRoot, ".gitattributes"),
      "packages/app/src/a.ts filter=cave-malicious\n",
    ),
  ]);
  if (process.platform !== "win32") await symlink(parentFile, escapedSymlink);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Cave Tests",
      "-c",
      "user.email=cave@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    ],
    { cwd: repoRoot },
  );
  await Promise.all([
    writeFile(
      markerScript,
      'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], "ran\\n");\n',
    ),
    writeFile(
      filterScript,
      'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], "ran\\n");\nprocess.stdin.pipe(process.stdout);\n',
    ),
  ]);
  const hookPath = path.join(repoRoot, ".git", "hooks", "post-checkout");
  await writeFile(
    hookPath,
    `#!/bin/sh\n${shellQuote(process.execPath)} ${shellQuote(markerScript)} ${shellQuote(hookMarker)}\n`,
  );
  await chmod(hookPath, 0o755);
  execFileSync(
    "git",
    [
      "config",
      "filter.cave-malicious.smudge",
      `${shellQuote(process.execPath)} ${shellQuote(filterScript)} ${shellQuote(filterMarker)}`,
    ],
    { cwd: repoRoot },
  );
  execFileSync("git", ["config", "filter.cave-malicious.required", "true"], {
    cwd: repoRoot,
  });
  await Promise.all([
    writeFile(appFile, "app edited\n"),
    writeFile(spacedFile, "spaced edited\n"),
    writeFile(trimmedSiblingFile, "trimmed edited\n"),
    writeFile(parentFile, "parent edited\n"),
    writeFile(siblingFile, "sibling edited\n"),
    writeFile(spacedProjectFile, "spaced project edited\n"),
    writeFile(trimmedProjectFile, "trimmed project edited\n"),
    mkdir(path.dirname(unrelatedUntrackedFile), { recursive: true }).then(() =>
      writeFile(unrelatedUntrackedFile, "keep me\n")
    ),
  ]);
  if (process.platform !== "win32") {
    await rm(escapedSymlink);
    await symlink(siblingFile, escapedSymlink);
  }
  await rm(deletedFile);
  execFileSync(
    "git",
    [
      "mv",
      "--",
      path.relative(repoRoot, renamedFromFile),
      path.relative(repoRoot, renamedToFile),
    ],
    { cwd: repoRoot },
  );

  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "nested-app", name: "Nested App", root: projectRoot },
        ...(process.platform === "win32"
          ? []
          : [{ id: "spaced-project", name: "Spaced Project", root: spacedProjectRoot }]),
      ],
    }),
  );
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = projectsPath;
  process.env.COVEN_HOME = path.join(artifactRoot, "coven-home");
  process.env.COVEN_CAVE_HOME = path.join(artifactRoot, "cave-home");
  process.env.COVEN_SOCKET = path.join(artifactRoot, "offline.sock");
  process.env.COVEN_WORKSPACES_ROOT = path.join(artifactRoot, "workspaces");
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;
  process.chdir(runnerCwd);

  const { GET, POST } = await import("./route.ts");
  const canonicalProjectRoot = await realpath(projectRoot);
  const canonicalRepoRoot = await realpath(repoRoot);

  const unauthorized = await POST(
    revertRequest(path.join(canonicalProjectRoot, "src", "a.ts")),
  );
  assert.equal(
    unauthorized.status,
    403,
    "a registered nested project cannot authorize hook-capable worktree commands in its unregistered Git parent",
  );
  for (const [target, confirmUntracked] of [
    [deletedFile, false],
    [renamedFromFile, false],
    [renamedToFile, false],
    [unrelatedUntrackedFile, true],
  ] as const) {
    const rejectedShape = await POST(revertRequest(target, confirmUntracked));
    assert.equal(
      rejectedShape.status,
      403,
      `unauthorized parent rejection precedes ${path.basename(target)} revert handling`,
    );
  }
  await assert.rejects(
    () => access(hookMarker),
    "an unauthorized parent repository post-checkout hook never executes",
  );
  await assert.rejects(
    () => access(filterMarker),
    "an unauthorized parent repository filter never executes",
  );

  const broadCheckpoint = await POST(new Request("http://127.0.0.1/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify({ action: "checkpoint", projectRoot }),
  }));
  assert.equal(
    broadCheckpoint.status,
    403,
    "the enclosing Git root must be authorized for non-revert operations too",
  );

  execFileSync("git", ["config", "--unset-all", "filter.cave-malicious.smudge"], {
    cwd: repoRoot,
  });
  execFileSync("git", ["config", "--unset-all", "filter.cave-malicious.required"], {
    cwd: repoRoot,
  });
  await rm(hookPath, { force: true });
  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "parent-repo", name: "Parent Repo", root: repoRoot },
        { id: "nested-app", name: "Nested App", root: projectRoot },
        ...(process.platform === "win32"
          ? []
          : [{ id: "spaced-project", name: "Spaced Project", root: spacedProjectRoot }]),
      ],
    }),
  );

  const nestedChanges = await GET({
    nextUrl: new URL(
      `http://127.0.0.1/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`,
    ),
  });
  assert.equal(nestedChanges.status, 200);
  const nestedChangesBody = await nestedChanges.json();
  assert.equal(nestedChangesBody.repoRoot, canonicalRepoRoot);
  const listedAppFile = nestedChangesBody.files.find(
    (file: { path: string }) => file.path === "packages/app/src/a.ts",
  );
  assert.equal(
    listedAppFile?.path,
    "packages/app/src/a.ts",
    "GET exposes the changed file relative to the enclosing repository",
  );
  assert.equal(
    listedAppFile?.revertible,
    true,
    "GET marks a changed file inside the nested project as revertible",
  );
  assert.equal(
    nestedChangesBody.files.find(
      (file: { path: string }) => file.path === "src/a.ts",
    )?.revertible,
    false,
    "GET keeps parent-repository context but marks it read only",
  );
  assert.equal(
    nestedChangesBody.files.find(
      (file: { path: string }) => file.path === "packages/sibling/src/a.ts",
    )?.revertible,
    false,
    "GET keeps sibling-project context but marks it read only",
  );
  for (const repoRelativePath of [
    "../outside.ts",
    "packages/sibling/src/a.ts",
    canonicalProjectRoot,
  ]) {
    const rejected = await POST(repoRelativeRevertRequest(repoRelativePath));
    assert.equal(rejected.status, 403, `${repoRelativePath} cannot escape the nested project`);
  }
  if (process.platform !== "win32") {
    const listedSymlink = nestedChangesBody.files.find(
      (file: { path: string }) => file.path === "packages/app/src/outside-link.ts",
    );
    assert.equal(listedSymlink?.path, "packages/app/src/outside-link.ts");
    assert.equal(
      listedSymlink?.revertible,
      false,
      "GET fail-closes a project-contained symlink that resolves outside",
    );
    const symlinkEscape = await POST(repoRelativeRevertRequest(listedSymlink.path));
    assert.equal(symlinkEscape.status, 403, "a changed symlink resolving outside the project is rejected");
  }

  const reverted = await POST(repoRelativeRevertRequest(listedAppFile.path));
  assert.equal(reverted.status, 200, await reverted.clone().text());
  const revertedBody = await reverted.json();
  assert.equal(revertedBody.path, "packages/app/src/a.ts");
  assert.equal(await readFile(appFile, "utf8"), "app base\n", "Undo restores the nested-project file");
  assert.equal(await readFile(parentFile, "utf8"), "parent edited\n", "Undo leaves the parent project untouched");
  assert.equal(await readFile(siblingFile, "utf8"), "sibling edited\n", "Undo leaves sibling projects untouched");

  const checkpoint = await readFile(
    path.join(revertedBody.checkpointPath, "checkpoint.patch"),
    "utf8",
  );
  assert.match(
    checkpoint,
    /diff --git a\/packages\/app\/src\/a\.ts b\/packages\/app\/src\/a\.ts/,
    "the safety checkpoint captures the authorized nested project",
  );
  assert.doesNotMatch(
    checkpoint,
    /diff --git a\/src\/a\.ts b\/src\/a\.ts/,
    "the safety checkpoint excludes parent-project files",
  );
  assert.doesNotMatch(
    checkpoint,
    /diff --git a\/packages\/sibling\//,
    "the safety checkpoint excludes sibling projects",
  );
  assert.doesNotMatch(
    checkpoint,
    /packages\/app\/notes\/keep\.txt/,
    "an automatic safety checkpoint contains only the reverted target",
  );

  const checkpointName = path.basename(revertedBody.checkpointPath);
  const projectCheckpointList = await GET({
    nextUrl: new URL(
      `http://127.0.0.1/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`,
    ),
  });
  assert.equal(projectCheckpointList.status, 200);
  assert.equal(
    (await projectCheckpointList.json()).checkpoints.some(
      (entry: { name: string }) => entry.name === checkpointName,
    ),
    true,
    "a nested-project revert is immediately listed under the same project identity",
  );
  const restored = await POST(checkpointRequest("restore-checkpoint", projectRoot, checkpointName));
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal(await readFile(appFile, "utf8"), "app edited\n", "the nested-project edit round-trips");
  assert.equal(
    await readFile(unrelatedUntrackedFile, "utf8"),
    "keep me\n",
    "an unrelated untracked file neither blocks nor changes during restore",
  );

  if (process.platform !== "win32") {
    const spacedProjectReverted = await POST(
      revertRequest(spacedProjectFile, false, spacedProjectRoot),
    );
    assert.equal(
      spacedProjectReverted.status,
      200,
      await spacedProjectReverted.clone().text(),
    );
    assert.equal(
      await readFile(spacedProjectFile, "utf8"),
      "spaced project base\n",
      "Undo preserves a trailing-space POSIX repository root",
    );
    assert.equal(
      await readFile(trimmedProjectFile, "utf8"),
      "trimmed project edited\n",
      "the trimmed sibling repository path is never substituted",
    );

    const spacedReverted = await POST(revertRequest(spacedFile));
    assert.equal(spacedReverted.status, 200, await spacedReverted.clone().text());
    assert.equal(
      await readFile(spacedFile, "utf8"),
      "spaced base\n",
      "Undo targets the exact trailing-space filename",
    );
    assert.equal(
      await readFile(trimmedSiblingFile, "utf8"),
      "trimmed edited\n",
      "Undo never falls through to the trimmed sibling",
    );
  }

  const binaryFile = path.join(projectRoot, "src", "blob.bin");
  const binaryContents = Buffer.from([0, 1, 2, 3, 255, 0, 128]);
  await writeFile(binaryFile, binaryContents);
  const binaryReverted = await POST(revertRequest(binaryFile, true));
  assert.equal(binaryReverted.status, 200, await binaryReverted.clone().text());
  await assert.rejects(() => readFile(binaryFile), "reverting the untracked binary deletes it");
  const binaryCheckpointName = path.basename(
    (await binaryReverted.json()).checkpointPath,
  );
  const binaryRestored = await POST(
    checkpointRequest("restore-checkpoint", projectRoot, binaryCheckpointName),
  );
  assert.equal(binaryRestored.status, 200, await binaryRestored.clone().text());
  assert.deepEqual(
    await readFile(binaryFile),
    binaryContents,
    "an untracked binary target round-trips through its automatic checkpoint",
  );

  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "parent-repo", name: "Parent Repo", root: repoRoot },
        { id: "nested-app", name: "Nested App", root: projectRoot },
        { id: "nested-sibling", name: "Nested Sibling", root: siblingRoot },
      ],
    }),
  );
  const wrongProjectRestore = await POST(
    checkpointRequest("restore-checkpoint", siblingRoot, checkpointName),
  );
  assert.equal(wrongProjectRestore.status, 403);
  assert.equal(
    (await wrongProjectRestore.json()).error,
    "checkpoint not authorized for project",
    "a scoped checkpoint cannot authorize restoration under another captured project",
  );
  const siblingCheckpointList = await GET({
    nextUrl: new URL(
      `http://127.0.0.1/api/changes?projectRoot=${encodeURIComponent(siblingRoot)}&checkpoints=1`,
    ),
  });
  assert.equal(siblingCheckpointList.status, 200);
  assert.equal(
    (await siblingCheckpointList.json()).checkpoints.some(
      (entry: { name: string }) => entry.name === checkpointName,
    ),
    false,
    "a sibling project cannot list another project's scoped checkpoint",
  );
  const wrongProjectDelete = await POST(
    checkpointRequest("delete-checkpoint", siblingRoot, checkpointName),
  );
  assert.equal(wrongProjectDelete.status, 403);
  assert.equal(
    (await wrongProjectDelete.json()).error,
    "checkpoint not authorized for project",
  );
  await access(revertedBody.checkpointPath);
  await access(
    path.join(revertedBody.checkpointPath, "metadata.scope.json"),
  );

  const checkpointDir = path.dirname(revertedBody.checkpointPath);
  const checkpointContents = await readFile(
    path.join(revertedBody.checkpointPath, "checkpoint.patch"),
  );
  const metadataContents = await readFile(
    path.join(revertedBody.checkpointPath, "metadata.scope.json"),
  );
  const cloneCheckpoint = async (name: string, includeMetadata = true) => {
    const checkpointPath = path.join(checkpointDir, name);
    const metadataPath = `${checkpointPath}.scope.json`;
    await writeFile(checkpointPath, checkpointContents);
    if (includeMetadata) await writeFile(metadataPath, metadataContents);
    return { checkpointPath, metadataPath };
  };
  const readStoredCheckpoint = async (checkpointPath: string) => {
    const stat = await lstat(checkpointPath);
    return readFile(
      stat.isDirectory()
        ? path.join(checkpointPath, "checkpoint.patch")
        : checkpointPath,
    );
  };
  const readStoredMetadata = async (
    checkpointPath: string,
    metadataPath: string,
  ) => {
    const stat = await lstat(checkpointPath);
    return readFile(
      stat.isDirectory()
        ? path.join(checkpointPath, "metadata.scope.json")
        : metadataPath,
    );
  };

  const checkpointRaceName = "2026-08-05T17-20-00-001Z.patch";
  const checkpointRace = await cloneCheckpoint(checkpointRaceName);
  const heldCheckpoint = `${checkpointRace.checkpointPath}.attacker-held`;
  let checkpointReplacementInjected = false;
  const checkpointRaceDelete = await withRenameSyncHook(
    (source, destination, rename) => {
      if (!checkpointReplacementInjected && source === checkpointRace.checkpointPath) {
        checkpointReplacementInjected = true;
        rename(source, heldCheckpoint);
        fs.writeFileSync(source, "replacement checkpoint\n");
      }
      rename(source, destination);
    },
    () => POST(checkpointRequest("delete-checkpoint", projectRoot, checkpointRaceName)),
  );
  assert.equal(
    checkpointRaceDelete.status,
    500,
    "a checkpoint replacement between inspection and quarantine aborts deletion",
  );
  assert.equal(
    await readStoredCheckpoint(checkpointRace.checkpointPath).then((contents) =>
      contents.toString("utf8"),
    ),
    "replacement checkpoint\n",
    "the unverified checkpoint replacement is restored rather than deleted",
  );
  assert.deepEqual(
    await readFile(heldCheckpoint),
    checkpointContents,
    "the inspected checkpoint displaced by the race remains untouched",
  );
  assert.deepEqual(
    await readStoredMetadata(
      checkpointRace.checkpointPath,
      checkpointRace.metadataPath,
    ),
    metadataContents,
    "checkpoint replacement rollback leaves paired metadata untouched",
  );

  const metadataRaceName = "2026-08-05T17-20-00-002Z.patch";
  const metadataRace = await cloneCheckpoint(metadataRaceName);
  const heldMetadata = `${metadataRace.metadataPath}.attacker-held`;
  let metadataReplacementInjected = false;
  const metadataRaceDelete = await withRenameSyncHook(
    (source, destination, rename) => {
      if (!metadataReplacementInjected && source === metadataRace.metadataPath) {
        metadataReplacementInjected = true;
        rename(source, heldMetadata);
        fs.writeFileSync(source, '{"version":1,"kind":"revert-target","projectRoot":"/replacement","targetProjectRelativePath":"outside","targetGitPath":"outside"}');
      }
      rename(source, destination);
    },
    () => POST(checkpointRequest("delete-checkpoint", projectRoot, metadataRaceName)),
  );
  assert.equal(
    metadataRaceDelete.status,
    500,
    "a metadata replacement between authorization and quarantine aborts deletion",
  );
  await Promise.all([
    assert.rejects(() => access(metadataRace.checkpointPath)),
    assert.rejects(() => access(metadataRace.metadataPath)),
  ]);
  const metadataRaceQuarantine = (await readdir(checkpointDir, {
    withFileTypes: true,
  })).find(
    (entry) =>
      entry.isDirectory() &&
      entry.name.startsWith(`.delete-legacy-${metadataRaceName}-`),
  );
  assert.ok(metadataRaceQuarantine);
  assert.deepEqual(
    await readFile(
      path.join(
        checkpointDir,
        metadataRaceQuarantine.name,
        "checkpoint.patch",
      ),
    ),
    checkpointContents,
    "the verified checkpoint stays quarantined beside unverified metadata",
  );
  assert.match(
    await readFile(
      path.join(
        checkpointDir,
        metadataRaceQuarantine.name,
        "metadata.scope.json",
      ),
      "utf8",
    ),
    /"projectRoot":"\/replacement"/,
    "the unverified metadata replacement remains quarantined and untouched",
  );
  assert.deepEqual(
    await readFile(heldMetadata),
    metadataContents,
    "the authorized metadata displaced by the race remains untouched",
  );

  const partialRenameName = "2026-08-05T17-20-00-003Z.patch";
  const partialRename = await cloneCheckpoint(partialRenameName);
  const partialRenameDelete = await withRenameSyncHook(
    (source, destination, rename) => {
      if (source === partialRename.metadataPath) {
        const error = new Error("injected metadata rename failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      rename(source, destination);
    },
    () => POST(checkpointRequest("delete-checkpoint", projectRoot, partialRenameName)),
  );
  assert.equal(
    partialRenameDelete.status,
    500,
    "a paired metadata rename failure aborts deletion",
  );
  assert.deepEqual(
    await readFile(partialRename.checkpointPath),
    checkpointContents,
    "a partial paired rename restores the checkpoint",
  );
  assert.deepEqual(
    await readFile(partialRename.metadataPath),
    metadataContents,
    "a partial paired rename preserves metadata",
  );

  const rollbackConflictName = "2026-08-05T17-20-00-006Z.patch";
  const rollbackConflict = await cloneCheckpoint(rollbackConflictName);
  const rollbackConflictDelete = await withRenameSyncHook(
    (source, destination, rename) => {
      if (source === rollbackConflict.metadataPath) {
        fs.writeFileSync(rollbackConflict.checkpointPath, "rollback replacement\n");
        const error = new Error("injected paired rename failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      rename(source, destination);
    },
    () => POST(checkpointRequest("delete-checkpoint", projectRoot, rollbackConflictName)),
  );
  assert.equal(
    rollbackConflictDelete.status,
    500,
    "a replacement arriving before rollback keeps the partial rename failed",
  );
  assert.equal(
    await readFile(rollbackConflict.checkpointPath, "utf8"),
    "rollback replacement\n",
    "rollback never overwrites an unverified replacement at the public path",
  );
  const retainedQuarantines = (await readdir(checkpointDir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith(`.delete-legacy-${rollbackConflictName}-`),
    )
    .map((entry) => path.join(checkpointDir, entry.name, "checkpoint.patch"));
  assert.equal(retainedQuarantines.length, 1);
  assert.deepEqual(
    await readFile(retainedQuarantines[0]),
    checkpointContents,
    "a verified checkpoint that cannot be restored remains safely quarantined",
  );
  const rollbackConflictDirectory = path.dirname(retainedQuarantines[0]);
  await access(path.join(rollbackConflictDirectory, ".conflict.json"));
  await rm(rollbackConflict.checkpointPath);
  const recoveryProbe = await POST(
    checkpointRequest(
      "delete-checkpoint",
      projectRoot,
      "2026-08-05T17-20-00-999Z.patch",
    ),
  );
  assert.equal(recoveryProbe.status, 200, await recoveryProbe.clone().text());
  await assert.rejects(() => access(rollbackConflict.checkpointPath));
  assert.deepEqual(
    await readFile(retainedQuarantines[0]),
    checkpointContents,
    "generic locked recovery never republishes an authorization-conflicted quarantine",
  );
  await access(path.join(rollbackConflictDirectory, ".conflict.json"));

  const legacyName = "2026-08-05T17-20-00-004Z.patch";
  const legacyCheckpoint = await cloneCheckpoint(legacyName, false);
  const legacyDelete = await POST(
    checkpointRequest("delete-checkpoint", projectRoot, legacyName),
  );
  assert.equal(
    legacyDelete.status,
    403,
    "a metadata-free repository checkpoint cannot be deleted through a nested project",
  );
  await access(legacyCheckpoint.checkpointPath);
  const repoLegacyDelete = await POST(
    checkpointRequest("delete-checkpoint", repoRoot, legacyName),
  );
  assert.equal(repoLegacyDelete.status, 200, await repoLegacyDelete.clone().text());
  await assert.rejects(
    () => access(legacyCheckpoint.checkpointPath),
    "the enclosing repository can still delete its legacy checkpoint",
  );

  const legacyRaceName = "2026-08-05T17-20-00-005Z.patch";
  const legacyRace = await cloneCheckpoint(legacyRaceName, false);
  let legacyMetadataInjected = false;
  const legacyRaceDelete = await withRenameSyncHook(
    (source, destination, rename) => {
      if (!legacyMetadataInjected && source === legacyRace.checkpointPath) {
        legacyMetadataInjected = true;
        fs.writeFileSync(legacyRace.metadataPath, '{"replacement":true}');
      }
      rename(source, destination);
    },
    () => POST(checkpointRequest("delete-checkpoint", repoRoot, legacyRaceName)),
  );
  assert.equal(
    legacyRaceDelete.status,
    500,
    "metadata appearing after a legacy checkpoint inspection aborts deletion",
  );
  await Promise.all([
    assert.rejects(() => access(legacyRace.checkpointPath)),
    assert.rejects(() => access(legacyRace.metadataPath)),
  ]);
  const legacyRaceQuarantine = (await readdir(checkpointDir, {
    withFileTypes: true,
  })).find(
    (entry) =>
      entry.isDirectory() &&
      entry.name.startsWith(`.delete-legacy-${legacyRaceName}-`),
  );
  assert.ok(legacyRaceQuarantine);
  assert.deepEqual(
    await readFile(
      path.join(
        checkpointDir,
        legacyRaceQuarantine.name,
        "checkpoint.patch",
      ),
    ),
    checkpointContents,
    "legacy metadata races retain the verified checkpoint in quarantine",
  );
  assert.equal(
    await readFile(
      path.join(
        checkpointDir,
        legacyRaceQuarantine.name,
        "metadata.scope.json",
      ),
      "utf8",
    ),
    '{"replacement":true}',
    "metadata that appeared during legacy deletion remains quarantined",
  );

  const unverifiedName = "2026-08-05T17-20-00-007Z.patch";
  const unverifiedDirectory = path.join(checkpointDir, unverifiedName);
  const unexpectedDirectory = path.join(
    unverifiedDirectory,
    "unexpected-directory",
  );
  const unexpectedLink = path.join(unverifiedDirectory, "unexpected-link");
  await mkdir(unexpectedDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(unverifiedDirectory, "checkpoint.patch"),
      checkpointContents,
    ),
    writeFile(
      path.join(unverifiedDirectory, "metadata.scope.json"),
      metadataContents,
    ),
  ]);
  await symlink(
    unexpectedDirectory,
    unexpectedLink,
    process.platform === "win32" ? "junction" : "dir",
  );
  const listWithUnverified = await GET({
    nextUrl: new URL(
      `http://127.0.0.1/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`,
    ),
  });
  assert.equal(listWithUnverified.status, 200);
  assert.equal(
    (await listWithUnverified.json()).checkpoints.some(
      (entry: { name: string }) => entry.name === unverifiedName,
    ),
    false,
    "a checkpoint directory with unknown entries is never listed",
  );
  const unverifiedDelete = await POST(
    checkpointRequest("delete-checkpoint", projectRoot, unverifiedName),
  );
  assert.equal(unverifiedDelete.status, 200);
  assert.equal(
    (await lstat(unexpectedDirectory)).isDirectory(),
    true,
    "delete leaves an unknown directory untouched",
  );
  assert.equal(
    (await lstat(unexpectedLink)).isSymbolicLink(),
    true,
    "delete leaves an unknown symlink untouched",
  );

  const authorizedDelete = await POST(
    checkpointRequest("delete-checkpoint", projectRoot, checkpointName),
  );
  assert.equal(authorizedDelete.status, 200, await authorizedDelete.clone().text());
  await assert.rejects(
    () => access(revertedBody.checkpointPath),
    "an authorized delete removes the checkpoint",
  );
  await assert.rejects(
    () =>
      access(
        path.join(revertedBody.checkpointPath, "metadata.scope.json"),
      ),
    "an authorized delete removes its scope metadata",
  );
  const repeatedDelete = await POST(
    checkpointRequest("delete-checkpoint", projectRoot, checkpointName),
  );
  assert.equal(
    repeatedDelete.status,
    200,
    "repeating an already completed checkpoint deletion is idempotent",
  );
  const deletedCheckpointList = await GET({
    nextUrl: new URL(
      `http://127.0.0.1/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`,
    ),
  });
  assert.equal(deletedCheckpointList.status, 200);
  assert.equal(
    (await deletedCheckpointList.json()).checkpoints.some(
      (entry: { name: string }) => entry.name === checkpointName,
    ),
    false,
    "the same nested project no longer lists its deleted checkpoint",
  );

  for (const targetPath of [
    path.join(canonicalRepoRoot, "src", "a.ts"),
    path.join(canonicalRepoRoot, "packages", "sibling", "src", "a.ts"),
    "../../src/a.ts",
  ]) {
    const rejected = await POST(revertRequest(targetPath));
    assert.equal(rejected.status, 403, `${targetPath} is outside the captured project root`);
    assert.equal((await rejected.json()).error, "path not allowed");
  }
  assert.equal(await readFile(parentFile, "utf8"), "parent edited\n");
  assert.equal(await readFile(siblingFile, "utf8"), "sibling edited\n");
} finally {
  process.chdir(originalCwd);
  restoreEnv();
  await rm(artifactRoot, { recursive: true, force: true });
}

console.log("changes route-revert.test.ts: ok");
