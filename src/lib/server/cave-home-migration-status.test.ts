// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "cave-home-migration-status-"));
process.env.COVEN_HOME = path.join(root, ".coven");
delete process.env.COVEN_CAVE_HOME;

const coven = process.env.COVEN_HOME;
const cave = path.join(coven, "cave");
const { caveHomeMigrationStatus } = await import("./cave-home-migration-status.ts");

try {
  await mkdir(coven, { recursive: true });
  let status = await caveHomeMigrationStatus();
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.conflicts, []);
  assert.equal(status.migrated, true);
  assert.ok(status.backupRoot.endsWith(path.join("cave", "migration-backups")));
  assert.ok(status.journalPath.endsWith(path.join("cave", "migration-state.json")));

  await writeFile(path.join(coven, "cave-config.json"), "{}");
  status = await caveHomeMigrationStatus();
  assert.deepEqual(status.pending, ["cave-config.json"]);
  assert.equal(status.details[0].state, "pending");
  assert.deepEqual(status.details[0].actions, ["merge"]);
  assert.match(status.details[0].differences[0], /only source/);

  await mkdir(cave, { recursive: true });
  await writeFile(path.join(cave, "config.json"), '{"canonical":true}');
  status = await caveHomeMigrationStatus();
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.conflicts, ["cave-config.json"]);
  assert.equal(status.details[0].strategy, "manual");
  assert.equal(status.details[0].legacyPath, path.join(coven, "cave-config.json"));
  assert.equal(status.details[0].canonicalPath, path.join(cave, "config.json"));
  assert.equal(typeof status.details[0].legacyMtimeMs, "number");
  assert.equal(typeof status.details[0].canonicalMtimeMs, "number");
  assert.deepEqual(status.details[0].actions, ["keep-canonical", "recover-legacy", "defer"]);
  assert.match(status.details[0].differences[0], /Changed top-level fields/);

  console.log("cave-home-migration-status.test.ts: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
