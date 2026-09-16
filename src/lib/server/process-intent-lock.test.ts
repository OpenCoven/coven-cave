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

// ── Lamport's choosing phase (issue #5443) ───────────────────────────────────
// The ticket is taken before the intent file exists, with an await between, so
// a descheduled process registers late carrying an early ticket and can win the
// comparison against a contender that already decided it was oldest. Both then
// enter the critical section and one update is lost. These pin the guard.

test("a live chooser blocks ticket comparison until its intent is published", async () => {
  const intentsDirectory = path.join(temporary, "choosing-live");
  await mkdir(intentsDirectory, { recursive: true });
  // A marker naming THIS process, which is definitionally alive and whose
  // start identity therefore matches — a contender mid-choice.
  const seed = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-choosing-seed",
  });
  const [seedName] = await readdir(intentsDirectory);
  const identityHash = /-(\w{16})-/.exec(seedName)![1];
  await seed();
  const chooser = path.join(
    intentsDirectory,
    `${process.pid}-${identityHash}-abcdef0123456789.choosing`,
  );
  await writeFile(chooser, `${process.pid}\n`);

  try {
    // No intent file exists at all, so without the guard this would acquire
    // immediately. It must instead wait for the chooser to publish.
    await assert.rejects(
      () =>
        acquireProcessIntentLock({
          intentsDirectory,
          timeoutMs: 120,
          label: "test-choosing-live",
        }),
      /timed out/,
      "a contender must not compare tickets while another process is choosing one",
    );
  } finally {
    await rm(chooser, { force: true });
  }

  // Once the chooser is gone the lock is available again — the guard delays,
  // it does not wedge.
  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-choosing-cleared",
  });
  await release();
});

test("a failed acquire leaves no choosing marker behind", async () => {
  const intentsDirectory = path.join(temporary, "choosing-cleanup");
  await mkdir(intentsDirectory, { recursive: true });
  // Hold the lock, then force a contender to fail by timing out. Whatever the
  // failure, its marker must not survive: the marker names a live process, so
  // the liveness check would read it as an active chooser and stall every
  // later contender — an outage caused by the very guard meant to prevent a
  // lost update. Copilot caught this on PR #5452; cleanup used to sit outside
  // the guard, so a rejecting close() escaped with the marker still on disk.
  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-cleanup-holder",
  });
  try {
    await assert.rejects(
      () =>
        acquireProcessIntentLock({
          intentsDirectory,
          timeoutMs: 60,
          label: "test-cleanup-loser",
        }),
      /timed out/,
    );
    const leftovers = (await readdir(intentsDirectory))
      .filter((name) => name.endsWith(".choosing"));
    assert.deepEqual(leftovers, [], "a failed acquire must not strand its choosing marker");
  } finally {
    await release();
  }
  // And the directory is still usable afterwards.
  const next = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-cleanup-successor",
  });
  await next();
});

test("a chooser from a dead incarnation is reclaimed rather than blocking forever", async () => {
  const intentsDirectory = path.join(temporary, "choosing-stale");
  await mkdir(intentsDirectory, { recursive: true });
  // Same PID, deliberately wrong start identity: the process at that PID is
  // alive but is demonstrably a different incarnation, which is the one thing
  // that makes a marker reclaimable. Age alone never is.
  const stale = path.join(
    intentsDirectory,
    `${process.pid}-0000000000000000-abcdef0123456789.choosing`,
  );
  await writeFile(stale, "orphan\n");

  const release = await acquireProcessIntentLock({
    intentsDirectory,
    timeoutMs: 5_000,
    label: "test-choosing-stale",
  });
  assert.ok(
    !(await readdir(intentsDirectory)).includes(path.basename(stale)),
    "the unreclaimable-looking marker must be removed, not waited on forever",
  );
  await release();
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
