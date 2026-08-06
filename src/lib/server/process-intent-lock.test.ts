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

async function compatibilityGates(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) =>
    /^\d{24}-\d+-[a-f0-9]{16}-[a-f0-9]+\.lock$/.test(name),
  );
}

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test("a contender paused before publication cannot preempt a published owner", async () => {
  const intentsDirectory = path.join(temporary, "publish-order");
  const firstPaused = deferred();
  const resumeFirst = deferred();
  let firstEntered = false;
  let pausedOnce = false;

  const first = acquireProcessIntentLock({
    intentsDirectory,
    label: "test-paused-publisher",
    publicationStage: async (stage) => {
      if (stage !== "gate-name-selected" || pausedOnce) return;
      pausedOnce = true;
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

test("simultaneous current contenders do not livelock while yielding stale priority", async () => {
  const intentsDirectory = path.join(temporary, "simultaneous-current");
  const bothPublished = deferred();
  const resumeBoth = deferred();
  let publishedCount = 0;
  const publicationStage = async (stage: string) => {
    if (stage !== "state-parent-synced") return;
    publishedCount += 1;
    if (publishedCount === 2) bothPublished.resolve();
    await resumeBoth.promise;
  };
  const first = acquireProcessIntentLock({
    intentsDirectory,
    label: "simultaneous current first",
    timeoutMs: 2_000,
    publicationStage,
  });
  const second = acquireProcessIntentLock({
    intentsDirectory,
    label: "simultaneous current second",
    timeoutMs: 2_000,
    publicationStage,
  });
  await bothPublished.promise;
  resumeBoth.resolve();

  const winner = await Promise.race([
    first.then((release) => ({ name: "first" as const, release })),
    second.then((release) => ({ name: "second" as const, release })),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("simultaneous contenders livelocked")), 500),
    ),
  ]);
  await winner.release();
  const loserRelease = await (winner.name === "first" ? second : first);
  await loserRelease();
});

test("an arbitrarily old live-owner intent is never reclaimed", async () => {
  const intentsDirectory = path.join(temporary, "live-owner");
  const releaseLiveOwner = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-live-owner-holder",
  });
  const [liveName] = await compatibilityGates(intentsDirectory);
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
  await initialRelease();
  const reusedName = "000000000000000000000001.lock";
  const reusedPath = path.join(intentsDirectory, reusedName);
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
  assert.ok(!(await readdir(intentsDirectory)).includes(reusedName));
  await release();
});

test("a fresh ownerless published intent fails closed during its publication grace", async () => {
  const intentsDirectory = path.join(temporary, "stale-removal-timeout");
  await mkdir(intentsDirectory);
  const staleName = "000000000000000000000001.lock";
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

test("old ownerless and malformed published intents are recovered", async () => {
  const intentsDirectory = path.join(temporary, "ownerless-recovery");
  const stalePath = path.join(
    intentsDirectory,
    "000000000000000000000001.lock",
  );
  const malformedPath = path.join(
    intentsDirectory,
    "000000000000000000000002.lock",
  );
  await mkdir(stalePath, { recursive: true });
  await mkdir(malformedPath);
  await writeFile(path.join(malformedPath, "owner.json"), "{broken\n");
  await Promise.all([
    utimes(stalePath, new Date(0), new Date(0)),
    utimes(malformedPath, new Date(0), new Date(0)),
  ]);

  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "test-ownerless-recovery",
  });
  assert.ok(!(await readdir(intentsDirectory)).includes(path.basename(stalePath)));
  assert.ok(
    !(await readdir(intentsDirectory)).includes(path.basename(malformedPath)),
  );
  await release();
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
  while ((await compatibilityGates(intentsDirectory)).length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  controller.abort();
  await assert.rejects(contender, { name: "AbortError" });
  assert.equal((await compatibilityGates(intentsDirectory)).length, 1);
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

test("released, draft, and published sidecar artifacts are recovered", async () => {
  const intentsDirectory = path.join(temporary, "artifact-recovery");
  await mkdir(intentsDirectory);
  const deadOwner = "2147483646-0000000000000000-deadbeef";
  const released = path.join(intentsDirectory, ".released-abandoned");
  const draft = path.join(
    intentsDirectory,
    `.intent-${deadOwner}.tmp`,
  );
  const gateName = `000000000000000000000001-${deadOwner}.lock`;
  const state = path.join(
    intentsDirectory,
    `.published-${gateName}.intent`,
  );
  await Promise.all([
    mkdir(released),
    mkdir(draft),
    mkdir(state),
  ]);

  const release = await acquireProcessIntentLock({
    intentsDirectory,
    label: "artifact recovery",
  });
  await release();
  const secondRelease = await acquireProcessIntentLock({
    intentsDirectory,
    label: "artifact recovery cleanup",
  });
  await secondRelease();
  const names = await readdir(intentsDirectory);
  assert.ok(!names.includes(path.basename(released)));
  assert.ok(!names.includes(path.basename(draft)));
  assert.ok(!names.includes(path.basename(state)));
});
