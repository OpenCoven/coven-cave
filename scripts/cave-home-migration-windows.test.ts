// @ts-nocheck
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("cave-home-migration-windows.test.ts: skipped (not Windows)");
  process.exit(0);
}

const root = await mkdtemp(path.join(tmpdir(), "cave-home-windows-"));
process.env.COVEN_HOME = path.join(root, ".coven");
delete process.env.COVEN_CAVE_HOME;

const { migrateCaveHome } = await import("../src/lib/server/cave-home-migration.ts");
const { caveHomeMigrationStatus } = await import("../src/lib/server/cave-home-migration-status.ts");

try {
  await mkdir(process.env.COVEN_HOME, { recursive: true });
  const legacy = path.join(process.env.COVEN_HOME, "cave-config.json");
  const canonical = path.join(process.env.COVEN_HOME, "cave", "config.json");
  await writeFile(legacy, '{"windows":true}', "utf8");
  const result = await migrateCaveHome();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(JSON.parse(await readFile(canonical, "utf8")), { windows: true });
  const bridge = await lstat(legacy);
  assert.ok(bridge.isSymbolicLink() || bridge.isFile(), "Windows uses a link when permitted or an ordinary managed mirror");
  assert.equal((await caveHomeMigrationStatus()).migrated, true, "compatibility bridge never creates a false conflict");

  // On Windows, renaming a candidate directory over an existing lock reports
  // EPERM rather than EEXIST. A contender must wait for the owner instead of
  // treating ordinary lock contention as a migration failure.
  let markAcquired;
  const acquired = new Promise((resolve) => { markAcquired = resolve; });
  let releaseOwner;
  const ownerMayFinish = new Promise((resolve) => { releaseOwner = resolve; });
  const owner = migrateCaveHome({
    lockProbe: async (event) => {
      if (event !== "acquired") return;
      markAcquired();
      await ownerMayFinish;
    },
  });
  await acquired;
  const contender = migrateCaveHome();
  await new Promise((resolve) => setTimeout(resolve, 100));
  releaseOwner();
  const [ownerResult, contenderResult] = await Promise.all([owner, contender]);
  assert.deepEqual(ownerResult.errors, []);
  assert.deepEqual(contenderResult.errors, []);

  // A failed reclaim rename can leave a recent takeover marker owned by this
  // still-live sidecar. It is orphaned when its token is not actively tracked,
  // and later storage operations must recover it without waiting five minutes.
  const orphanHome = path.join(root, "same-process-orphan-takeover", ".coven");
  process.env.COVEN_HOME = orphanHome;
  const orphanCave = path.join(orphanHome, "cave");
  const orphanLock = path.join(orphanCave, ".migration.lock");
  await mkdir(orphanLock, { recursive: true });
  await writeFile(path.join(orphanLock, "owner.json"), JSON.stringify({
    pid: process.pid,
    token: "released-same-process-owner",
    startedAt: new Date().toISOString(),
    releasedAt: new Date().toISOString(),
  }));
  await writeFile(path.join(orphanLock, ".takeover"), JSON.stringify({
    pid: process.pid,
    takeoverToken: "abandoned-same-process-takeover",
    ownerToken: "released-same-process-owner",
    startedAt: new Date().toISOString(),
  }));
  await writeFile(path.join(orphanHome, "cave-config.json"), '{"windows":true}', "utf8");

  const orphanStartedAt = Date.now();
  const orphanResult = await migrateCaveHome();
  assert.deepEqual(orphanResult.errors, []);
  assert.ok(Date.now() - orphanStartedAt < 2_000, "same-process takeover orphan is reclaimed immediately");
  assert.deepEqual(JSON.parse(await readFile(path.join(orphanCave, "config.json"), "utf8")), { windows: true });

  // A crashed claimant's PID may be reused by another Windows process. Bound
  // apparently live claims by age so that reuse cannot recreate the hang.
  const reusedPidHome = path.join(root, "reused-pid-takeover", ".coven");
  process.env.COVEN_HOME = reusedPidHome;
  const reusedPidCave = path.join(reusedPidHome, "cave");
  const reusedPidLock = path.join(reusedPidCave, ".migration.lock");
  await mkdir(reusedPidLock, { recursive: true });
  await writeFile(path.join(reusedPidLock, "owner.json"), JSON.stringify({
    pid: process.pid,
    token: "released-owner",
    releasedAt: new Date().toISOString(),
  }));
  const reusedPidTakeover = path.join(reusedPidLock, ".takeover");
  await writeFile(reusedPidTakeover, JSON.stringify({
    pid: process.ppid,
    takeoverToken: "crashed-claim-with-reused-pid",
    ownerToken: "released-owner",
  }));
  const stale = new Date(Date.now() - 10 * 60_000);
  await utimes(reusedPidTakeover, stale, stale);
  await writeFile(path.join(reusedPidHome, "cave-config.json"), '{"windows":true}', "utf8");

  const reusedPidStartedAt = Date.now();
  const reusedPidResult = await migrateCaveHome();
  assert.deepEqual(reusedPidResult.errors, []);
  assert.ok(Date.now() - reusedPidStartedAt < 2_000, "aged claim is reclaimed despite PID reuse");
  assert.deepEqual(JSON.parse(await readFile(path.join(reusedPidCave, "config.json"), "utf8")), { windows: true });
  console.log("cave-home-migration-windows.test.ts: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
