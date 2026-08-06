// @ts-nocheck
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const originalCwd = process.cwd();
const fixedCheckpointIso = "2026-08-05T20:00:00.000Z";

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

function installFixedClock(iso: string): () => void {
  const OriginalDate = globalThis.Date;
  const fixedMs = OriginalDate.parse(iso);
  class FixedDate extends OriginalDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixedMs);
      else super(...args);
    }

    static now() {
      return fixedMs;
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
  return () => {
    globalThis.Date = OriginalDate;
  };
}

async function runCheckpointWorker(): Promise<void> {
  const projectRoot = process.env.CHANGES_TEST_PROJECT_ROOT;
  const runnerCwd = process.env.CHANGES_TEST_RUNNER_CWD;
  if (!projectRoot || !runnerCwd) throw new Error("checkpoint worker environment is incomplete");
  process.chdir(runnerCwd);
  const restoreClock = installFixedClock(fixedCheckpointIso);
  try {
    const { POST } = await import("./route.ts");
    const response = await POST(request(projectRoot, "checkpoint"));
    const body = await response.json();
    console.log(`CHANGES_CHECKPOINT_RESULT:${JSON.stringify({ status: response.status, body })}`);
  } finally {
    restoreClock();
  }
}

async function runParent(): Promise<void> {
  const artifactRoot = path.join(
    originalCwd,
    ".test-artifacts",
    `changes-route-concurrency-${process.pid}`,
  );
  const repoRoot = path.join(artifactRoot, "repo");
  const projectA = path.join(repoRoot, "packages", "a");
  const projectB = path.join(repoRoot, "packages", "b");
  const fileA = path.join(projectA, "src", "a.ts");
  const fileB = path.join(projectB, "src", "b.ts");
  const runnerCwd = path.join(artifactRoot, "runner");
  const projectsPath = path.join(artifactRoot, "projects.json");
  const signingKey = path.join(artifactRoot, "test-signing-key");
  const hookMarker = path.join(artifactRoot, "pre-commit-started");
  const hookScript = path.join(artifactRoot, "pre-commit.mjs");
  const envKeys = [
    "CAVE_PROJECTS_PATH_OVERRIDE",
    "COVEN_HOME",
    "COVEN_CAVE_HOME",
    "COVEN_SOCKET",
    "COVEN_WORKSPACES_ROOT",
    "COVEN_WORKSPACE_ROOT",
    "WORKSPACE_ROOT",
    "NEXT_PUBLIC_WORKSPACE_ROOT",
    "COVEN_CAVE_CHANGES_LOCK_TIMEOUT_MS",
  ] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  }

  function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }

  async function waitForFile(file: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        await access(file);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.fail(`timed out waiting for ${file}`);
  }

  async function spawnCheckpointWorker(projectRoot: string) {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--require",
        "./scripts/css-source-contract-hook.cjs",
        "--experimental-strip-types",
        "--import",
        "./scripts/test-alias-register.mjs",
        "src/app/api/changes/route-concurrency.test.ts",
      ],
      {
        cwd: originalCwd,
        env: {
          ...process.env,
          CHANGES_ROUTE_CHECKPOINT_WORKER: "1",
          CHANGES_TEST_PROJECT_ROOT: projectRoot,
          CHANGES_TEST_RUNNER_CWD: runnerCwd,
        },
      },
    );
    const resultLine = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("CHANGES_CHECKPOINT_RESULT:"));
    assert.ok(resultLine, `checkpoint worker produced no result: ${stderr || stdout}`);
    return JSON.parse(resultLine.slice("CHANGES_CHECKPOINT_RESULT:".length));
  }

  await rm(artifactRoot, { recursive: true, force: true });
  try {
    await Promise.all([
      mkdir(path.dirname(fileA), { recursive: true }),
      mkdir(path.dirname(fileB), { recursive: true }),
      mkdir(runnerCwd, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(fileA, "a base\n"),
      writeFile(fileB, "b base\n"),
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
          { id: "a", name: "A", root: projectA },
          { id: "b", name: "B", root: projectB },
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

    await Promise.all([
      writeFile(fileA, "a checkpoint\n"),
      writeFile(fileB, "b checkpoint\n"),
    ]);
    const [workerA, workerB] = await Promise.all([
      spawnCheckpointWorker(projectA),
      spawnCheckpointWorker(projectB),
    ]);
    assert.equal(workerA.status, 200, JSON.stringify(workerA.body));
    assert.equal(workerB.status, 200, JSON.stringify(workerB.body));
    assert.notEqual(
      workerA.body.checkpointPath,
      workerB.body.checkpointPath,
      "separate processes publishing in the same millisecond reserve distinct checkpoint names",
    );
    const [patchA, patchB, metadataA, metadataB, patchStatA, metadataStatA] =
      await Promise.all([
        readFile(
          path.join(workerA.body.checkpointPath, "checkpoint.patch"),
          "utf8",
        ),
        readFile(
          path.join(workerB.body.checkpointPath, "checkpoint.patch"),
          "utf8",
        ),
        readFile(
          path.join(workerA.body.checkpointPath, "metadata.scope.json"),
          "utf8",
        ).then(JSON.parse),
        readFile(
          path.join(workerB.body.checkpointPath, "metadata.scope.json"),
          "utf8",
        ).then(JSON.parse),
        lstat(path.join(workerA.body.checkpointPath, "checkpoint.patch")),
        lstat(path.join(workerA.body.checkpointPath, "metadata.scope.json")),
      ]);
    assert.equal(
      patchStatA.nlink,
      1,
      "published checkpoint files never gain extra hard links",
    );
    assert.equal(metadataStatA.nlink, 1);
    assert.match(patchA, /packages\/a\/src\/a\.ts/);
    assert.doesNotMatch(patchA, /packages\/b\/src\/b\.ts/);
    assert.match(patchB, /packages\/b\/src\/b\.ts/);
    assert.doesNotMatch(patchB, /packages\/a\/src\/a\.ts/);
    assert.equal(metadataA.projectRoot, projectA);
    assert.equal(metadataB.projectRoot, projectB);

    const checkpointDir = path.dirname(workerA.body.checkpointPath);
    const existingPath = path.join(checkpointDir, "2026-08-05T20-00-00-000Z.patch");
    const existingPatchPath = path.join(existingPath, "checkpoint.patch");
    const existingMetadataPath = path.join(existingPath, "metadata.scope.json");
    const [existingPatch, existingMetadata, beforeEntries] = await Promise.all([
      readFile(existingPatchPath),
      readFile(existingMetadataPath),
      readdir(checkpointDir).then((entries) => entries.sort()),
    ]);
    const { POST } = await import("./route.ts");

    const { acquireProcessIntentLock } = await import(
      "../../../lib/server/process-intent-lock.ts"
    );
    const releaseHeldLock = await acquireProcessIntentLock({
      intentsDirectory: path.join(
        repoRoot,
        ".git",
        "coven-cave",
        "changes-transactions.locks",
      ),
      label: "changes concurrency test holder",
    });
    process.env.COVEN_CAVE_CHANGES_LOCK_TIMEOUT_MS = "50";
    const busyStartedAt = Date.now();
    let busyResponse: Response;
    try {
      busyResponse = await POST(request(projectA, "checkpoint"));
    } finally {
      await releaseHeldLock();
      delete process.env.COVEN_CAVE_CHANGES_LOCK_TIMEOUT_MS;
    }
    assert.equal(busyResponse.status, 409);
    assert.equal(busyResponse.headers.get("retry-after"), "1");
    assert.match((await busyResponse.json()).error, /repository is busy/);
    assert.ok(
      Date.now() - busyStartedAt < 1_000,
      "repository contention respects the configured bounded wait",
    );

    const crashedTemp = path.join(checkpointDir, ".publish-deadbeef.tmp");
    const crashedReserve = path.join(
      checkpointDir,
      "2026-08-05T20-00-00-111Z.patch.reserve",
    );
    await mkdir(crashedTemp);
    await Promise.all([
      writeFile(path.join(crashedTemp, "checkpoint.patch"), "crashed patch\n"),
      writeFile(
        path.join(crashedTemp, "metadata.scope.json"),
        JSON.stringify(metadataA),
      ),
      writeFile(crashedReserve, "orphan reservation\n"),
    ]);

    const originalMkdirSync = fs.mkdirSync;
    let collisionInjected = false;
    let injectedDestination = "";
    fs.mkdirSync = ((directory, options) => {
      if (
        !collisionInjected &&
        String(directory).endsWith(".patch") &&
        !fs.existsSync(directory)
      ) {
        collisionInjected = true;
        injectedDestination = String(directory);
        originalMkdirSync(directory, options);
      }
      return originalMkdirSync(directory, options);
    }) as typeof fs.mkdirSync;
    const originalLinkSync = fs.linkSync;
    fs.linkSync = (() => {
      throw new Error("hard links are unsupported");
    }) as typeof fs.linkSync;
    const restoreClock = installFixedClock(fixedCheckpointIso);
    let collisionResponse: Response;
    try {
      collisionResponse = await POST(request(projectA, "checkpoint"));
    } finally {
      restoreClock();
      fs.linkSync = originalLinkSync;
      fs.mkdirSync = originalMkdirSync;
    }
    assert.equal(collisionResponse.status, 200, await collisionResponse.clone().text());
    assert.equal(
      collisionInjected,
      true,
      "atomic destination reservation collisions retry with a new name",
    );
    assert.deepEqual(await readdir(injectedDestination), []);
    await assert.rejects(() => access(crashedTemp));
    await access(crashedReserve);
    assert.deepEqual(await readFile(existingPatchPath), existingPatch);
    assert.deepEqual(await readFile(existingMetadataPath), existingMetadata);

    const originalOpenSync = fs.openSync;
    fs.openSync = ((file, flags, ...args) => {
      if (
        flags === fs.constants.O_RDONLY &&
        (String(file) === checkpointDir || String(file).includes(".publish-"))
      ) {
        const error = new Error("directory fsync unsupported") as NodeJS.ErrnoException;
        error.code = "EINVAL";
        throw error;
      }
      return originalOpenSync(file, flags, ...args);
    }) as typeof fs.openSync;
    let limitedDirectoryFsync: Response;
    try {
      limitedDirectoryFsync = await POST(request(projectA, "checkpoint"));
    } finally {
      fs.openSync = originalOpenSync;
    }
    assert.equal(
      limitedDirectoryFsync.status,
      200,
      "Windows-style directory fsync limitations rely on next-operation recovery",
    );

    git(["reset", "--hard", "HEAD"]);
    git(["branch", "feature-b"]);
    git(["switch", "-c", "feature-a"]);
    await Promise.all([
      writeFile(fileA, "a committed on feature a\n"),
      writeFile(fileB, "b committed on feature b\n"),
    ]);
    await writeFile(
      hookScript,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(hookMarker)}, "started\\n");`,
        "await new Promise((resolve) => setTimeout(resolve, 500));",
        "",
      ].join("\n"),
    );
    const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");
    await writeFile(
      hookPath,
      `#!/bin/sh\n${shellQuote(process.execPath)} ${shellQuote(hookScript)}\n`,
      { mode: 0o755 },
    );

    const commitPromise = POST(
      request(projectA, "commit", { message: "commit on feature a" }),
    );
    await waitForFile(hookMarker);
    const switchThenCommit = (async () => {
      const switchResponse = await POST(
        request(repoRoot, "switch-branch", { branch: "feature-b" }),
      );
      if (switchResponse.status !== 200) {
        return { switchResponse, secondCommitResponse: null };
      }
      const secondCommitResponse = await POST(
        request(projectB, "commit", { message: "commit on feature b" }),
      );
      return { switchResponse, secondCommitResponse };
    })();
    const [commitResponse, switched] = await Promise.all([
      commitPromise,
      switchThenCommit,
    ]);
    assert.equal(commitResponse.status, 200, await commitResponse.clone().text());
    assert.equal(
      switched.switchResponse.status,
      200,
      "a concurrent branch switch waits for the complete commit transaction",
    );
    assert.ok(switched.secondCommitResponse);
    assert.equal(
      switched.secondCommitResponse.status,
      200,
      await switched.secondCommitResponse.clone().text(),
    );
    const commitBody = await commitResponse.json();
    const secondCommitBody = await switched.secondCommitResponse.json();
    assert.equal(commitBody.branch, "feature-a");
    assert.equal(commitBody.sha, git(["rev-parse", "--short", "feature-a"]).trim());
    assert.equal(secondCommitBody.branch, "feature-b");
    assert.equal(
      secondCommitBody.sha,
      git(["rev-parse", "--short", "feature-b"]).trim(),
    );
    assert.equal(git(["branch", "--show-current"]).trim(), "feature-b");
    assert.equal(
      git(["show", "feature-a:packages/a/src/a.ts"]),
      "a committed on feature a\n",
    );
    assert.equal(git(["show", "feature-b:packages/a/src/a.ts"]), "a base\n");
    assert.equal(git(["show", "feature-a:packages/b/src/b.ts"]), "b base\n");
    assert.equal(
      git(["show", "feature-b:packages/b/src/b.ts"]),
      "b committed on feature b\n",
    );
  } finally {
    process.chdir(originalCwd);
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(artifactRoot, { recursive: true, force: true });
  }
}

if (process.env.CHANGES_ROUTE_CHECKPOINT_WORKER === "1") {
  await runCheckpointWorker();
} else {
  await runParent();
  console.log("changes route-concurrency.test.ts: ok");
}
