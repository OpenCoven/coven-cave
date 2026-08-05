// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
const spacedFile = path.join(projectRoot, "src", "space.ts ");
const trimmedSiblingFile = path.join(projectRoot, "src", "space.ts");
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

  const { POST } = await import("./route.ts");
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

  const reverted = await POST(revertRequest(path.join(canonicalProjectRoot, "src", "a.ts")));
  assert.equal(reverted.status, 200, await reverted.clone().text());
  const revertedBody = await reverted.json();
  assert.equal(revertedBody.path, "packages/app/src/a.ts");
  assert.equal(await readFile(appFile, "utf8"), "app base\n", "Undo restores the nested-project file");
  assert.equal(await readFile(parentFile, "utf8"), "parent edited\n", "Undo leaves the parent project untouched");
  assert.equal(await readFile(siblingFile, "utf8"), "sibling edited\n", "Undo leaves sibling projects untouched");

  const checkpoint = await readFile(revertedBody.checkpointPath, "utf8");
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
