// @ts-nocheck
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
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

  // Persistent Windows EPERM while publishing candidate directories must stop
  // at the documented deadline and remove every contender-owned candidate.
  const candidateFailureHome = path.join(root, "candidate-eperm", ".coven");
  process.env.COVEN_HOME = candidateFailureHome;
  const candidateFailureCave = path.join(candidateFailureHome, "cave");
  await mkdir(candidateFailureCave, { recursive: true });
  let candidateAttempts = 0;
  const candidates = new Set<string>();
  const persistentEperm = async (candidate: string) => {
    candidateAttempts += 1;
    candidates.add(candidate);
    const error = new Error("injected persistent Windows EPERM") as NodeJS.ErrnoException;
    error.code = "EPERM";
    throw error;
  };
  await assert.rejects(
    migrateCaveHome({ lockTimeoutMs: 150, lockCandidateRename: persistentEperm }),
    (error) => error?.code === "ETIMEDOUT",
  );
  assert.ok(candidateAttempts >= 2);
  assert.equal(candidates.size, 1, "candidate retries reuse one directory on Windows");
  assert.equal(
    (await readdir(candidateFailureCave)).some((name) => name.startsWith(".migration.lock.candidate-")),
    false,
  );

  // The same bound applies when Windows repeatedly refuses to fence a lock
  // whose owner has published release intent.
  const reclaimFailureHome = path.join(root, "reclaim-eperm", ".coven");
  process.env.COVEN_HOME = reclaimFailureHome;
  const reclaimFailureCave = path.join(reclaimFailureHome, "cave");
  const reclaimFailureLock = path.join(reclaimFailureCave, ".migration.lock");
  await mkdir(reclaimFailureLock, { recursive: true });
  await writeFile(path.join(reclaimFailureLock, "owner.json"), JSON.stringify({
    pid: process.pid,
    token: "released-owner",
    releasedAt: new Date().toISOString(),
  }));
  let reclaimAttempts = 0;
  await assert.rejects(
    migrateCaveHome({
      lockTimeoutMs: 150,
      lockFenceRename: async () => {
        reclaimAttempts += 1;
        const error = new Error("injected persistent Windows reclaim EPERM") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      },
    }),
    (error) => error?.code === "ETIMEDOUT",
  );
  assert.ok(reclaimAttempts >= 2);
  assert.equal((await lstat(reclaimFailureLock)).isDirectory(), true);
  console.log("cave-home-migration-windows.test.ts: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
