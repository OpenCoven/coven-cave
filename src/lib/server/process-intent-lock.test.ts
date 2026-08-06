import assert from "node:assert/strict";
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

import { acquireProcessIntentLock } from "./process-intent-lock.ts";

const temporary = await mkdtemp(
  path.join(process.cwd(), ".process-intent-lock-test-"),
);

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test("a contender paused before publication cannot preempt a published owner", async () => {
  const intentsDirectory = path.join(temporary, "publish-order");
  const firstPaused = deferred();
  const resumeFirst = deferred();
  let firstEntered = false;

  const first = acquireProcessIntentLock({
    intentsDirectory,
    label: "test-paused-publisher",
    beforePublish: async () => {
      firstPaused.resolve();
      await resumeFirst.promise;
    },
  }).then((release) => {
    firstEntered = true;
    return release;
  });

  const paused = await Promise.race([
    firstPaused.promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  if (!paused) {
    const release = await first;
    await release();
    assert.fail("the contender never reached the pre-publication boundary");
  }
  const releaseSecond = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-published-successor",
  });
  resumeFirst.resolve();

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    firstEntered,
    false,
    "the late publication must remain queued behind the current owner",
  );

  await releaseSecond();
  const releaseFirst = await first;
  assert.equal(firstEntered, true);
  await releaseFirst();
});

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
  const reusedPath = path.join(intentsDirectory, liveName);
  await mkdir(reusedPath);
  await writeFile(
    path.join(reusedPath, "owner.json"),
    `${JSON.stringify({
      pid: process.pid,
      startIdentityHash: "0000000000000000",
    })}\n`,
  );

  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-pid-reuse",
  });
  assert.ok(!(await readdir(intentsDirectory)).includes(liveName));
  await release();
});

test("a malformed published intent fails closed within the absolute timeout", async () => {
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

test("an aborted contender removes its published intent", async () => {
  const intentsDirectory = path.join(temporary, "abort");
  const releaseHolder = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-abort-holder",
  });
  const controller = new AbortController();
  const contender = acquireProcessIntentLock({
    intentsDirectory,
    label: "test-abort-contender",
    signal: controller.signal,
  });
  while ((await readdir(intentsDirectory)).length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  controller.abort();
  await assert.rejects(contender, { name: "AbortError" });
  assert.equal((await readdir(intentsDirectory)).length, 1);
  await releaseHolder();
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
