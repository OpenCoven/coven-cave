import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { probeOwnedDirectoryWrite } from "./owned-directory-write.ts";

test("a real owned-directory write probe succeeds and removes its artifact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-write-probe-"));
  try {
    const target = path.join(root, "application-data");
    const result = await probeOwnedDirectoryWrite(target);
    assert.deepEqual(result, { exists: true, writeProbe: "passed" });
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the probe artifact is removed when the filesystem fails after creation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-write-probe-failure-"));
  try {
    const target = path.join(root, "application-data");
    const result = await probeOwnedDirectoryWrite(target, {
      stat,
      mkdir,
      rm,
      randomId: () => "failure-after-create",
      writeFile: async (...args) => {
        await writeFile(...args);
        throw new Error("simulated fsync failure");
      },
    });

    assert.deepEqual(result, { exists: true, writeProbe: "failed" });
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a cleanup failure cannot be reported as a successful write probe", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-write-probe-cleanup-"));
  try {
    const target = path.join(root, "application-data");
    const result = await probeOwnedDirectoryWrite(target, {
      stat,
      mkdir,
      writeFile,
      randomId: () => "cleanup-failure",
      rm: async () => {
        throw new Error("simulated cleanup denial");
      },
    });

    assert.deepEqual(result, { exists: true, writeProbe: "failed" });
    await rm(
      path.join(target, ".cave-write-probe-cleanup-failure"),
      { force: true },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

console.log("owned-directory-write.test.ts: ok");
