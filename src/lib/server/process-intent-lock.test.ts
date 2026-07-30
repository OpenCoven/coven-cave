import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { acquireProcessIntentLock } from "./process-intent-lock.ts";

const temporary = await mkdtemp(
  path.join(tmpdir(), "cave-process-intent-lock-"),
);

after(async () => {
  await rm(temporary, { recursive: true, force: true });
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
