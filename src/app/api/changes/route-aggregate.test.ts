// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const originalCwd = process.cwd();
const artifactRoot = path.join(originalCwd, ".test-artifacts", `changes-route-aggregate-${process.pid}`);
const repoRoot = path.join(artifactRoot, "repo");
const indexedProjectRoot = path.join(repoRoot, "packages", "mixedcaseapp");
const windowsProjectRoot = path.join(repoRoot, "packages", "MixedCaseApp");
const siblingRoot = path.join(repoRoot, "packages", "sibling");
const literalProjectRoot = path.join(repoRoot, "packages", "project[1]");
const patternSiblingRoot = path.join(repoRoot, "packages", "project1");
const runnerCwd = path.join(artifactRoot, "runner");
const projectsPath = path.join(artifactRoot, "projects.json");
const signingKey = path.join(artifactRoot, "test-signing-key");
const parentFile = path.join(repoRoot, "parent.txt");
const nestedFile = path.join(indexedProjectRoot, "src", "nested.ts");
const siblingFile = path.join(siblingRoot, "src", "sibling.ts");
const literalFile = path.join(literalProjectRoot, "src", "literal.ts");
const patternSiblingFile = path.join(patternSiblingRoot, "src", "sibling.ts");
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

function request(
  projectRoot: string,
  action: string,
  body: Record<string, unknown> = {},
): Request {
  return new Request("http://127.0.0.1/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify({ projectRoot, action, ...body }),
  });
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

await rm(artifactRoot, { recursive: true, force: true });
try {
  await Promise.all([
    mkdir(path.dirname(nestedFile), { recursive: true }),
    mkdir(path.dirname(siblingFile), { recursive: true }),
    mkdir(path.dirname(literalFile), { recursive: true }),
    mkdir(path.dirname(patternSiblingFile), { recursive: true }),
    mkdir(runnerCwd, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(parentFile, "parent base\n"),
    writeFile(nestedFile, "nested base\n"),
    writeFile(siblingFile, "sibling base\n"),
    writeFile(literalFile, "literal base\n"),
    writeFile(patternSiblingFile, "pattern sibling base\n"),
  ]);
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git([
    "-c",
    "user.name=Cave Tests",
    "-c",
    "user.email=cave@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  ]);

  let projectRoot = indexedProjectRoot;
  if (process.platform === "win32") {
    const intermediate = path.join(repoRoot, "packages", "case-rename-intermediate");
    await rename(indexedProjectRoot, intermediate);
    await rename(intermediate, windowsProjectRoot);
    projectRoot = windowsProjectRoot;
  }

  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", signingKey]);
  git(["config", "user.name", "Cave Tests"]);
  git(["config", "user.email", "cave@example.invalid"]);
  git(["config", "gpg.format", "ssh"]);
  git(["config", "user.signingkey", signingKey]);

  await writeFile(
    projectsPath,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "repo", name: "Repo", root: repoRoot },
        { id: "nested", name: "Nested", root: projectRoot },
        { id: "sibling", name: "Sibling", root: siblingRoot },
        { id: "literal", name: "Literal", root: literalProjectRoot },
        { id: "pattern-sibling", name: "Pattern sibling", root: patternSiblingRoot },
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
  const projectGitPath = "packages/mixedcaseapp/src/nested.ts";
  await Promise.all([
    writeFile(path.join(projectRoot, "src", "nested.ts"), "nested checkpoint\n"),
    writeFile(parentFile, "parent checkpoint\n"),
    writeFile(siblingFile, "sibling checkpoint\n"),
  ]);

  const listed = await GET({
    nextUrl: new URL(
      `http://127.0.0.1/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`,
    ),
  });
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  const listedNested = listedBody.files.find(
    (file: { path: string }) => file.path.toLowerCase() === projectGitPath,
  );
  assert.equal(
    listedNested?.path,
    projectGitPath,
    "GET preserves the Git/index spelling even when the Windows project root casing differs",
  );
  assert.equal(listedNested?.revertible, true);

  if (process.platform === "win32") {
    const undone = await POST(
      request(projectRoot, "revert", { repoRelativePath: listedNested.path }),
    );
    assert.equal(undone.status, 200, await undone.clone().text());
    assert.equal((await undone.json()).path, projectGitPath);
    assert.equal(
      await readFile(path.join(projectRoot, "src", "nested.ts"), "utf8"),
      "nested base\n",
    );
    await writeFile(path.join(projectRoot, "src", "nested.ts"), "nested checkpoint\n");
  }

  const checkpointResponse = await POST(request(projectRoot, "checkpoint"));
  assert.equal(checkpointResponse.status, 200, await checkpointResponse.clone().text());
  const checkpointPath = (await checkpointResponse.json()).checkpointPath as string;
  const checkpointName = path.basename(checkpointPath);
  const checkpointPatch = await readFile(checkpointPath, "utf8");
  assert.match(checkpointPatch, /packages\/mixedcaseapp\/src\/nested\.ts/i);
  assert.doesNotMatch(checkpointPatch, /diff --git a\/parent\.txt b\/parent\.txt/);
  assert.doesNotMatch(checkpointPatch, /packages\/sibling/);
  const checkpointMetadata = JSON.parse(
    await readFile(`${checkpointPath}.scope.json`, "utf8"),
  );
  assert.equal(
    process.platform === "win32"
      ? checkpointMetadata.projectRoot.toLowerCase()
      : checkpointMetadata.projectRoot,
    process.platform === "win32" ? projectRoot.toLowerCase() : projectRoot,
  );
  assert.deepEqual(
    {
      version: checkpointMetadata.version,
      kind: checkpointMetadata.kind,
      projectPathspec: checkpointMetadata.projectPathspec,
    },
    {
      version: 1,
      kind: "project-scope",
      projectPathspec: process.platform === "win32"
        ? "packages/MixedCaseApp"
        : "packages/mixedcaseapp",
    },
    "aggregate checkpoints persist their explicit project pathspec",
  );

  git(["checkout", "HEAD", "--", ":(literal)packages/mixedcaseapp/src/nested.ts"]);
  await Promise.all([
    writeFile(parentFile, "parent after checkpoint\n"),
    writeFile(siblingFile, "sibling after checkpoint\n"),
  ]);
  const wrongProjectRestore = await POST(
    request(siblingRoot, "restore-checkpoint", { checkpoint: checkpointName }),
  );
  assert.equal(wrongProjectRestore.status, 403);
  const wrongProjectDelete = await POST(
    request(siblingRoot, "delete-checkpoint", { checkpoint: checkpointName }),
  );
  assert.equal(wrongProjectDelete.status, 403);
  const restored = await POST(
    request(projectRoot, "restore-checkpoint", { checkpoint: checkpointName }),
  );
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal(
    await readFile(path.join(projectRoot, "src", "nested.ts"), "utf8"),
    "nested checkpoint\n",
  );
  assert.equal(await readFile(parentFile, "utf8"), "parent after checkpoint\n");
  assert.equal(await readFile(siblingFile, "utf8"), "sibling after checkpoint\n");

  const escapedPatch = git([
    "diff",
    "--binary",
    "--no-renames",
    "HEAD",
    "--",
    ":(literal)packages/sibling",
  ]);
  const escapedCheckpointName = "2026-08-06T00-00-00-997Z.patch";
  const escapedCheckpointPath = path.join(path.dirname(checkpointPath), escapedCheckpointName);
  await Promise.all([
    writeFile(escapedCheckpointPath, checkpointPatch + escapedPatch),
    writeFile(
      `${escapedCheckpointPath}.scope.json`,
      JSON.stringify(checkpointMetadata),
    ),
  ]);
  git([
    "checkout",
    "HEAD",
    "--",
    ":(literal)packages/mixedcaseapp/src/nested.ts",
    ":(literal)packages/sibling/src/sibling.ts",
  ]);
  const escapedRestore = await POST(
    request(projectRoot, "restore-checkpoint", { checkpoint: escapedCheckpointName }),
  );
  assert.equal(
    escapedRestore.status,
    500,
    "project metadata cannot authorize a patch containing a sibling path",
  );
  assert.equal(
    await readFile(path.join(projectRoot, "src", "nested.ts"), "utf8"),
    "nested base\n",
    "a rejected mixed-scope patch applies nothing",
  );
  assert.equal(await readFile(siblingFile, "utf8"), "sibling base\n");
  const restoredAgain = await POST(
    request(projectRoot, "restore-checkpoint", { checkpoint: checkpointName }),
  );
  assert.equal(restoredAgain.status, 200, await restoredAgain.clone().text());
  await writeFile(siblingFile, "sibling after checkpoint\n");

  const legacyCheckpointName = "2026-08-06T00-00-00-998Z.patch";
  await writeFile(
    path.join(path.dirname(checkpointPath), legacyCheckpointName),
    checkpointPatch,
  );
  const nestedLegacyRestore = await POST(
    request(projectRoot, "restore-checkpoint", { checkpoint: legacyCheckpointName }),
  );
  assert.equal(
    nestedLegacyRestore.status,
    403,
    "metadata-free repo-wide checkpoints are not authorized from a nested project",
  );

  git(["add", "--", "parent.txt"]);
  await GET({
    nextUrl: new URL(
      `http://127.0.0.1/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`,
    ),
  });
  const lateSibling = path.join(siblingRoot, "src", "after-get.ts");
  await writeFile(lateSibling, "late sibling\n");
  const committed = await POST(
    request(projectRoot, "commit", { message: "commit nested only" }),
  );
  assert.equal(committed.status, 200, await committed.clone().text());
  assert.deepEqual(
    git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
      .trim()
      .split("\n"),
    [projectGitPath],
    "a direct commit includes only the nested project",
  );
  const retainedStatus = git(["status", "--porcelain=v1"]);
  assert.match(retainedStatus, /parent\.txt/);
  assert.match(retainedStatus, /packages\/sibling\/src\/sibling\.ts/);
  assert.match(retainedStatus, /packages\/sibling\/src\/after-get\.ts/);
  await access(lateSibling);

  await Promise.all([
    writeFile(literalFile, "literal edited\n"),
    writeFile(patternSiblingFile, "pattern sibling edited\n"),
  ]);
  const literalCheckpointResponse = await POST(
    request(literalProjectRoot, "checkpoint"),
  );
  assert.equal(
    literalCheckpointResponse.status,
    200,
    await literalCheckpointResponse.clone().text(),
  );
  const literalCheckpointPath = (await literalCheckpointResponse.json()).checkpointPath as string;
  const literalPatch = await readFile(literalCheckpointPath, "utf8");
  assert.match(literalPatch, /packages\/project\[1\]\/src\/literal\.ts/);
  assert.doesNotMatch(
    literalPatch,
    /packages\/project1\/src\/sibling\.ts/,
    "pathspec metacharacters in project names are matched literally",
  );
  git(["checkout", "HEAD", "--", ":(literal)packages/project[1]/src/literal.ts"]);
  const literalRestored = await POST(
    request(literalProjectRoot, "restore-checkpoint", {
      checkpoint: path.basename(literalCheckpointPath),
    }),
  );
  assert.equal(literalRestored.status, 200, await literalRestored.clone().text());
  assert.equal(await readFile(literalFile, "utf8"), "literal edited\n");
  assert.equal(await readFile(patternSiblingFile, "utf8"), "pattern sibling edited\n");

  const literalCommitted = await POST(
    request(literalProjectRoot, "commit", { message: "commit literal project only" }),
  );
  assert.equal(literalCommitted.status, 200, await literalCommitted.clone().text());
  assert.deepEqual(
    git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
      .trim()
      .split("\n"),
    ["packages/project[1]/src/literal.ts"],
  );
  assert.match(git(["status", "--porcelain=v1"]), /packages\/project1\/src\/sibling\.ts/);

  const deleted = await POST(
    request(projectRoot, "delete-checkpoint", { checkpoint: checkpointName }),
  );
  assert.equal(deleted.status, 200, await deleted.clone().text());
  await assert.rejects(() => access(checkpointPath));
  await assert.rejects(() => access(`${checkpointPath}.scope.json`));

  const unsupported = await POST(request(projectRoot, "discard"));
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).error, "unsupported action");

  const rootCheckpoint = await POST(request(repoRoot, "checkpoint"));
  assert.equal(rootCheckpoint.status, 200, await rootCheckpoint.clone().text());
  const rootCheckpointPath = (await rootCheckpoint.json()).checkpointPath as string;
  assert.equal(
    JSON.parse(await readFile(`${rootCheckpointPath}.scope.json`, "utf8")).projectPathspec,
    ".",
    "the repository root itself uses a literal dot pathspec",
  );
} finally {
  process.chdir(originalCwd);
  restoreEnv();
  await rm(artifactRoot, { recursive: true, force: true });
}

console.log("changes route-aggregate.test.ts: ok");
