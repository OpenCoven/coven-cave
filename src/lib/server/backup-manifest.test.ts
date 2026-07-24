// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(os.tmpdir(), "cave-backup-manifest-"));
const roots = { cave: path.join(temp, "cave"), coven: path.join(temp, "coven") };

try {
  await mkdir(roots.cave, { recursive: true });
  await mkdir(roots.coven, { recursive: true });
  await writeFile(path.join(roots.cave, "queue-project.json"), '{"version":1,"projectId":"selected"}');

  const { isAllowedBackupEntry, listBackupFiles } = await import("./backup-manifest.ts");
  assert.equal(isAllowedBackupEntry("cave", "queue-project.json"), true, "Queue selection is a supported backup entry");
  const files = await listBackupFiles(roots);
  assert.ok(
    files.some((file) => file.root === "cave" && file.rel === "queue-project.json"),
    "backup collection preserves the Queue-specific project selection",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("backup-manifest.test.ts: ok");
