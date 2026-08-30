import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

import { acquireProcessIntentLock, withProcessIntentLock } from "./process-intent-lock.ts";

const temporary = await mkdtemp(
  path.join(process.cwd(), ".process-intent-lock-test-"),
);

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

function waitForLine(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (!stdout.split(/\r?\n/).includes(expected)) return;
      cleanup();
      resolve();
    };
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString("utf8"); };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`lock child exited ${code} before ${expected}: ${stdout}${stderr}`));
    };
    const cleanup = () => {
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
  });
}

test("an arbitrarily old live-owner intent is never reclaimed", async () => {
  const intentsDirectory = path.join(temporary, "live-owner");
  const releaseLiveOwner = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-live-owner-holder",
  });
  const [liveName] = await readdir(intentsDirectory);
  const livePath = path.join(intentsDirectory, liveName);
  await utimes(livePath, new Date(0), new Date(0));

  try {
    await assert.rejects(
      () =>
        acquireProcessIntentLock({
          intentsDirectory,
          timeoutMs: 40,
          label: "test-live-owner",
        }),
      /timed out/,
    );
    assert.ok((await readdir(intentsDirectory)).includes(liveName));
  } finally {
    await releaseLiveOwner();
  }
});

test("an orphan from a reused PID is reclaimed by process-start identity", async () => {
  const intentsDirectory = path.join(temporary, "pid-reuse");
  const initialRelease = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-pid-reuse-seed",
  });
  const [liveName] = await readdir(intentsDirectory);
  await initialRelease();
  const reusedName = liveName.replace(
    /-([a-f0-9]{16})-([a-f0-9]+)\.lock$/,
    "-0000000000000000-$2.lock",
  );
  assert.notEqual(reusedName, liveName);
  await writeFile(path.join(intentsDirectory, reusedName), "orphan\n");

  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-pid-reuse",
  });
  assert.ok(!(await readdir(intentsDirectory)).includes(reusedName));
  await release();
});

test("persistent stale-intent removal failure respects the absolute timeout", async () => {
  const intentsDirectory = path.join(temporary, "stale-removal-timeout");
  const seedRelease = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-stale-removal-seed",
  });
  const [seedName] = await readdir(intentsDirectory);
  await seedRelease();
  const staleName = seedName.replace(
    /-([a-f0-9]{16})-([a-f0-9]+)\.lock$/,
    "-0000000000000000-$2.lock",
  );
  const stalePath = path.join(intentsDirectory, staleName);
  await mkdir(stalePath);
  await writeFile(path.join(stalePath, "obstruction"), "blocked\n");

  const startedAt = Date.now();
  const attempt = acquireProcessIntentLock({
    intentsDirectory,
    timeoutMs: 50,
    label: "test-stale-removal",
  });
  let watchdog: NodeJS.Timeout | undefined;
  try {
    await assert.rejects(
      Promise.race([
        attempt,
        new Promise<never>((_, reject) => {
          watchdog = setTimeout(
            () => reject(new Error("lock attempt exceeded 300ms")),
            300,
          );
        }),
      ]),
      /^Error: timed out waiting for test-stale-removal lock$/,
    );
    assert.ok(Date.now() - startedAt < 300);
  } finally {
    if (watchdog) clearTimeout(watchdog);
    await rm(stalePath, { recursive: true, force: true });
    const release = await attempt.catch(() => null);
    if (release) await release();
  }
});

test("one release call retains cleanup until a failed removal recovers", async () => {
  const intentsDirectory = path.join(temporary, "release-retry");
  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-release-retry",
  });
  const [ownName] = await readdir(intentsDirectory);
  const ownPath = path.join(intentsDirectory, ownName);
  await rm(ownPath);
  await mkdir(ownPath);
  await writeFile(path.join(ownPath, "obstruction"), "blocked\n");

  await release();
  await rm(ownPath, { recursive: true });
  const successorRelease = await acquireProcessIntentLock({
    intentsDirectory,
    timeoutMs: 1_000,
    label: "test-release-retry-successor",
  });
  await successorRelease();
  assert.deepEqual(await readdir(intentsDirectory), []);
});

test("release is idempotent and cannot remove a successor intent", async () => {
  const intentsDirectory = path.join(temporary, "release");
  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-release",
  });
  await release();
  const successor =
    `999999999999999999999999-${process.pid + 1}-bbbbbbbbbbbbbbbb.lock`;
  await writeFile(path.join(intentsDirectory, successor), "successor\n");
  await release();
  assert.deepEqual(await readdir(intentsDirectory), [successor]);
});

test("an outer lease waits for detached reentrant work before a same-process successor enters", async () => {
  const intentsDirectory = path.join(temporary, "detached-reentrant-same-process");
  let releaseNested!: () => void;
  let markNestedStarted!: () => void;
  const nestedGate = new Promise<void>((resolve) => { releaseNested = resolve; });
  const nestedStarted = new Promise<void>((resolve) => { markNestedStarted = resolve; });
  let nestedFinished = false;
  const outer = withProcessIntentLock({ intentsDirectory, label: "detached outer" }, async () => {
    void withProcessIntentLock({ intentsDirectory, label: "detached nested" }, async () => {
      markNestedStarted();
      await nestedGate;
      nestedFinished = true;
    });
  });
  await nestedStarted;

  const successor = acquireProcessIntentLock({
    intentsDirectory,
    label: "detached same-process successor",
    timeoutMs: 2_000,
  });
  assert.equal(await Promise.race([
    successor.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]), false, "the successor cannot enter while detached nested work is suspended");

  releaseNested();
  await outer;
  const releaseSuccessor = await successor;
  assert.equal(nestedFinished, true);
  await releaseSuccessor();
});

test("an outer lease keeps a cross-process successor queued behind detached nested work", async () => {
  const intentsDirectory = path.join(temporary, "detached-reentrant-cross-process");
  let releaseNested!: () => void;
  let markNestedStarted!: () => void;
  const nestedGate = new Promise<void>((resolve) => { releaseNested = resolve; });
  const nestedStarted = new Promise<void>((resolve) => { markNestedStarted = resolve; });
  const outer = withProcessIntentLock({ intentsDirectory, label: "cross-process outer" }, async () => {
    void withProcessIntentLock({ intentsDirectory, label: "cross-process nested" }, async () => {
      markNestedStarted();
      await nestedGate;
    });
  });
  await nestedStarted;

  const moduleUrl = pathToFileURL(path.join(process.cwd(), "src/lib/server/process-intent-lock.ts")).href;
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `const { acquireProcessIntentLock } = await import(${JSON.stringify(moduleUrl)});
     process.stdout.write("STARTED\\n");
     const release = await acquireProcessIntentLock({
       intentsDirectory: process.argv[1], label: "detached child successor", timeoutMs: 5000,
     });
     process.stdout.write("ACQUIRED\\n");
     await release();`,
    intentsDirectory,
  ], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  const childExited = new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`detached lock child exited ${code}`));
    });
  });
  await waitForLine(child, "STARTED");
  const acquired = waitForLine(child, "ACQUIRED");
  assert.equal(await Promise.race([
    acquired.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
  ]), false, "another process remains queued until detached nested work settles");

  releaseNested();
  await outer;
  await acquired;
  await childExited;
});

test("a detached nested rejection releases the lease without masking an outer error", async () => {
  const intentsDirectory = path.join(temporary, "detached-reentrant-errors");
  const outerError = new Error("outer operation failed");
  const nestedError = new Error("nested operation failed");
  let nested: Promise<void> | undefined;
  const outer = withProcessIntentLock({ intentsDirectory, label: "error outer" }, async () => {
    nested = withProcessIntentLock({ intentsDirectory, label: "error nested" }, async () => {
      await Promise.resolve();
      throw nestedError;
    });
    throw outerError;
  });

  await assert.rejects(outer, (error) => error === outerError);
  await assert.rejects(nested!, (error) => error === nestedError);
  const releaseSuccessor = await acquireProcessIntentLock({
    intentsDirectory,
    label: "error successor",
    timeoutMs: 1_000,
  });
  await releaseSuccessor();
});

test("an inherited async context that starts after deactivation reacquires the lock", async () => {
  const intentsDirectory = path.join(temporary, "expired-inherited-context");
  let startInherited!: () => void;
  const inheritedGate = new Promise<void>((resolve) => { startInherited = resolve; });
  let inheritedEntered = false;
  let inherited: Promise<void> | undefined;
  await withProcessIntentLock({ intentsDirectory, label: "inherited outer" }, async () => {
    inherited = (async () => {
      await inheritedGate;
      await withProcessIntentLock({ intentsDirectory, label: "inherited late work" }, async () => {
        inheritedEntered = true;
      });
    })();
  });

  const releaseHolder = await acquireProcessIntentLock({
    intentsDirectory,
    label: "inherited successor holder",
    timeoutMs: 1_000,
  });
  startInherited();
  assert.equal(await Promise.race([
    inherited!.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]), false, "expired inherited context cannot bypass the current holder");
  assert.equal(inheritedEntered, false);
  await releaseHolder();
  await inherited;
  assert.equal(inheritedEntered, true);
});
