// @ts-nocheck
import assert from "node:assert/strict";
import { link, mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(os.tmpdir(), "cave-backup-manifest-"));
const roots = { cave: path.join(temp, "cave"), coven: path.join(temp, "coven") };

try {
  await mkdir(roots.cave, { recursive: true });
  await mkdir(roots.coven, { recursive: true });
  await writeFile(path.join(roots.cave, "queue-project.json"), '{"version":1,"projectId":"selected"}');
  const research = path.join(roots.cave, "research-resources");
  for (const directory of [
    "manifests", "snapshots", "blobs/sha256/aa", "tombstones", "migration",
    "jobs", "failures", "fences", "deletions", "locks/intents", "index",
  ]) await mkdir(path.join(research, directory), { recursive: true });
  for (const [relative, contents] of [
    ["manifests/resource.json", "manifest"],
    ["snapshots/snapshot.json", "snapshot"],
    ["blobs/sha256/aa/digest", "private extracted text"],
    ["tombstones/resource.json", "tombstone"],
    ["migration/research-links-projection.json", "projection"],
    ["migration/research-links-journal.json", "journal"],
    ["jobs/job.json", "job"],
    ["failures/job.json", "failure"],
    ["fences/resource.json", "fence"],
    ["deletions/resource.json", "deletion"],
    ["locks/intents/owner.json", "lock"],
    ["index/research-resources.sqlite", "sqlite plaintext"],
    ["index/research-resources.sqlite-wal", "wal plaintext"],
    ["index/research-resources.sqlite-shm", "shm plaintext"],
    ["index/research-resources.sqlite.corrupt-1", "quarantined plaintext"],
  ] as const) await writeFile(path.join(research, relative), contents);

  const { isAllowedBackupEntry, listBackupFiles } = await import("./backup-manifest.ts");
  assert.equal(isAllowedBackupEntry("cave", "queue-project.json"), true, "Queue selection is a supported backup entry");
  const files = await listBackupFiles(roots);
  assert.ok(
    files.some((file) => file.root === "cave" && file.rel === "queue-project.json"),
    "backup collection preserves the Queue-specific project selection",
  );
  for (const relative of [
    "manifests/resource.json", "snapshots/snapshot.json", "blobs/sha256/aa/digest",
    "tombstones/resource.json", "migration/research-links-projection.json",
    "migration/research-links-journal.json",
  ]) {
    assert.equal(
      isAllowedBackupEntry("cave", `research-resources/${relative}`),
      true,
      `${relative} is authoritative Research backup state`,
    );
    assert.ok(files.some((file) => file.rel === `research-resources/${relative}`));
  }
  for (const directory of ["jobs", "failures", "fences", "deletions", "locks", "index"]) {
    assert.equal(
      files.some((file) => file.rel.startsWith(`research-resources/${directory}/`)),
      false,
      `${directory} remains reconstructible and excluded`,
    );
    assert.equal(
      isAllowedBackupEntry("cave", `research-resources/${directory}/record.json`),
      false,
    );
  }
  if (process.platform !== "win32") {
    const outside = path.join(temp, "outside-private.txt");
    const unsafe = path.join(research, "manifests", "unsafe.json");
    await writeFile(outside, "outside private bytes");
    await symlink(outside, unsafe);
    await assert.rejects(() => listBackupFiles(roots), /Research backup entry is unsafe/);
    await unlink(unsafe);
    await link(outside, unsafe);
    await assert.rejects(() => listBackupFiles(roots), /Research backup entry is unsafe/);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("backup-manifest.test.ts: ok");
