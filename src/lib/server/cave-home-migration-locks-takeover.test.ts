// @ts-nocheck
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const { ensureCaveHomeReconciled, migrateCaveHome, withCaveHomeReconciledStore } = await import("./cave-home-migration.ts");
const { reconcileCaveHome } = await import("./cave-home-reconciliation.ts");
const { caveHomeMigrationStatus } = await import("./cave-home-migration-status.ts");
const { createDefaultPreferences } = await import("../preferences-schema.ts");

async function home(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), `cave-home-${name}-`));
  roots.push(root);
  process.env.COVEN_HOME = path.join(root, ".coven");
  delete process.env.COVEN_CAVE_HOME;
  delete process.env.COVEN_PREFERENCES_PATH;
  delete process.env.COVEN_THEME_PATH;
  delete process.env.COVEN_BACKDROP_PATH;
  await mkdir(process.env.COVEN_HOME, { recursive: true });
  return { root, coven: process.env.COVEN_HOME, cave: path.join(process.env.COVEN_HOME, "cave") };
}

async function json(target: string) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function kind(target: string) {
  try {
    const value = await lstat(target);
    return value.isSymbolicLink() ? "symlink" : value.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}

async function denySymlink() {
  const error = new Error("Administrator privilege required") as NodeJS.ErrnoException;
  error.code = "EPERM";
  throw error;
}

const baseState = () => ({
  sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {},
  sessionKeep: {}, sessionArchiveExtendedUntil: {}, sessionOwned: {}, mergedPrAutoArchived: {},
  travel: {
    manualOffline: false, hubUnreachableSince: null, lastHubReachableAt: null,
    staleCache: false, localSubdaemonWakeRequestedAt: null, localBindHost: "127.0.0.1",
    offlineQueue: [],
  },
});

try {
  // Every write boundary resumes idempotently. Backup-boundary faults return
  // an entry error; journal-boundary faults reject after releasing the lock.
  for (const boundary of [
    "after-backup-directory", "after-backup-legacy", "after-backup-canonical",
    "after-backup-manifest", "after-merge-write", "before-journal-write", "after-journal-write",
  ]) {
    const { coven, cave } = await home(`fault-${boundary}`);
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "shared", title: "legacy", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" },
    ] }));
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "shared", title: "canonical", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
    ] }));
    if (boundary.includes("journal")) await assert.rejects(migrateCaveHome({ faultAt: boundary, createSymlink: denySymlink }));
    else assert.ok((await migrateCaveHome({ faultAt: boundary, createSymlink: denySymlink })).errors.length > 0);
    const resumed = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(resumed.errors, [], `resume after ${boundary}`);
    assert.equal((await caveHomeMigrationStatus()).migrated, true, `complete after ${boundary}`);
  }

  // A failure after atomic canonical installation resumes through the
  // identical-copy path while the original legacy bytes remain available.
  {
    const { coven, cave } = await home("fault-after-legacy-move");
    await writeFile(path.join(coven, "cave-config.json"), '{"durable":true}');
    const failed = await migrateCaveHome({ faultAt: "after-legacy-move", createSymlink: denySymlink });
    assert.equal(failed.errors.length, 1);
    assert.deepEqual(await json(path.join(coven, "cave-config.json")), { durable: true });
    assert.deepEqual(await json(path.join(cave, "config.json")), { durable: true });
    assert.deepEqual((await migrateCaveHome({ createSymlink: denySymlink })).errors, []);
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
  }

  // A real process termination does not run the replacement finally blocks.
  // Recover an atomically retired path before migration classifies either side
  // as missing, then resume the ordinary reconciliation flow.
  {
    const { coven, cave } = await home("crash-after-retirement");
    const legacyPath = path.join(coven, "cave-config.json");
    const canonicalPath = path.join(cave, "config.json");
    await mkdir(cave, { recursive: true });
    await writeFile(legacyPath, '{"source":"legacy"}');
    await writeFile(canonicalPath, '{"source":"canonical"}');
    await rename(legacyPath, path.join(coven, ".cave-config.json.migration-retired-123-deadbeef"));
    await rename(canonicalPath, path.join(cave, ".config.json.migration-retired-123-deadbeef"));

    const resumed = await migrateCaveHome({ legacy: "cave-config.json", createSymlink: denySymlink });
    assert.deepEqual(resumed.errors, []);
    assert.deepEqual(await json(legacyPath), { source: "legacy" });
    assert.deepEqual(await json(canonicalPath), { source: "canonical" });
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-config.json"), true);
  }

  // Completed backup bundles are bounded while the active recovery bundle is
  // retained and remains hash-verifiable.
  {
    const { coven, cave } = await home("retention");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "config.json"), '{"canonical":true}');
    for (let index = 0; index < 13; index += 1) {
      await writeFile(path.join(coven, "cave-config.json"), JSON.stringify({ legacy: index }));
      assert.deepEqual((await migrateCaveHome({
        legacy: "cave-config.json", action: "keep-canonical", createSymlink: denySymlink,
      })).errors, []);
    }
    assert.ok((await readdir(path.join(cave, "migration-backups"))).length <= 10);
  }

  // More than the retention limit can become unresolved in one transaction.
  // Protect bundles recorded in the in-memory journal before it is committed,
  // rather than pruning an earlier conflict while processing a later one.
  {
    const { coven, cave } = await home("same-run-retention");
    await mkdir(cave, { recursive: true });
    const entries = Array.from({ length: 11 }, (_, index) => ({
      legacy: `legacy-${index}.json`, next: `canonical-${index}.json`, strategy: "manual" as const,
    }));
    for (let index = 0; index < entries.length; index += 1) {
      await writeFile(path.join(coven, entries[index].legacy), JSON.stringify({ legacy: index }));
      await writeFile(path.join(cave, entries[index].next), JSON.stringify({ canonical: index }));
    }
    assert.deepEqual((await reconcileCaveHome(entries, { createSymlink: denySymlink })).errors, []);
    const journal = await json(path.join(cave, "migration-state.json"));
    for (const entry of entries) {
      const backupId = journal.entries[entry.legacy].backupId;
      assert.equal(await kind(path.join(cave, "migration-backups", backupId)), "dir", `${entry.legacy} keeps its recovery bundle`);
    }
  }

  // A malformed or unsupported journal fails closed before touching either
  // data copy; it is never silently replaced with a fresh journal.
  {
    const { coven, cave } = await home("corrupt-journal");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "migration-state.json"), "not-json");
    await writeFile(path.join(coven, "cave-config.json"), '{"untouched":true}');
    await assert.rejects(migrateCaveHome({ createSymlink: denySymlink }));
    assert.deepEqual(await json(path.join(coven, "cave-config.json")), { untouched: true });
    assert.equal(await kind(path.join(cave, "config.json")), "missing");
  }

  // Two processes entering concurrently serialize on the filesystem lock.
  {
    const { coven, cave } = await home("concurrent");
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');
    const [first, second] = await Promise.all([
      migrateCaveHome({ createSymlink: denySymlink }),
      migrateCaveHome({ createSymlink: denySymlink }),
    ]);
    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
  }

  // A process crash leaves a fresh lock directory behind. Its recorded dead
  // owner is enough to reclaim immediately instead of blocking stores.
  {
    const { coven, cave } = await home("fresh-dead-lock");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');

    const startedAt = Date.now();
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    assert.ok(Date.now() - startedAt < 2_000, "a crashed owner is reclaimed without waiting for the stale-age threshold");
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // Competing stale-lock observers serialize through an exclusive takeover
  // claim; neither can remove the successor lock after the first reclaims it.
  {
    const { coven, cave } = await home("stale-lock-takeover");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));
    const stale = new Date(Date.now() - 10 * 60_000);
    await utimes(lock, stale, stale);
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');

    let staleObservers = 0;
    let releaseObservers!: () => void;
    const bothObserved = new Promise<void>((resolve) => { releaseObservers = resolve; });
    let active = 0;
    let maxActive = 0;
    const lockProbe = async (event: "stale-observed" | "acquired" | "released") => {
      if (event === "stale-observed") {
        staleObservers += 1;
        if (staleObservers === 2) releaseObservers();
        await bothObserved;
      } else if (event === "acquired") {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
      } else {
        active -= 1;
      }
    };
    const [first, second] = await Promise.all([
      migrateCaveHome({ createSymlink: denySymlink, lockProbe }),
      migrateCaveHome({ createSymlink: denySymlink, lockProbe }),
    ]);
    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    assert.ok(staleObservers >= 2, "both stale-lock contenders observed reclamation");
    assert.equal(maxActive, 1);
    assert.equal(active, 0);
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // A contender can crash after publishing its takeover claim but before it
  // renames the stale lock. Competing observers fence that immutable claim to
  // one deterministic retained path, so a delayed observer cannot rename a
  // successor lock after the first observer wins.
  {
    const { coven, cave } = await home("orphan-takeover-claim");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));
    const takeover = path.join(lock, ".takeover");
    await writeFile(takeover, JSON.stringify({ takeoverToken: "abandoned", ownerToken: "dead-owner" }));
    const stale = new Date(Date.now() - 10 * 60_000);
    await utimes(lock, stale, stale);
    await utimes(takeover, stale, stale);
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');

    let observers = 0;
    let releaseObservers!: () => void;
    const bothObserved = new Promise<void>((resolve) => { releaseObservers = resolve; });
    let active = 0;
    let maxActive = 0;
    const options = {
      createSymlink: denySymlink,
      takeoverRemovalProbe: async () => {
        observers += 1;
        if (observers === 2) releaseObservers();
        await bothObserved;
      },
      lockProbe: async (event: "stale-observed" | "acquired" | "released") => {
        if (event === "acquired") {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
        } else if (event === "released") {
          active -= 1;
        }
      },
    };
    const startedAt = Date.now();
    const [first, second] = await Promise.all([migrateCaveHome(options), migrateCaveHome(options)]);
    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    assert.ok(Date.now() - startedAt < 2_000, "an orphan takeover claim is reclaimed without hanging");
    assert.ok(observers >= 2, "both orphan observers reached the immutable claim");
    assert.equal(maxActive, 1);
    assert.equal(active, 0);
    const fences = (await readdir(cave)).filter((entry) => entry.startsWith(".migration.lock.reclaimed-"));
    assert.equal(fences.length, 1, "all orphan observers target one retained generation fence");
    assert.equal((await json(path.join(cave, fences[0], ".takeover"))).takeoverToken, "abandoned");
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // A crashed claimant's PID can be reused by an unrelated process. Even when
  // that PID appears live, an aged claim must not block migration forever.
  {
    const { coven, cave } = await home("reused-pid-takeover-claim");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      pid: process.pid,
      token: "released-owner",
      releasedAt: new Date().toISOString(),
    }));
    const takeover = path.join(lock, ".takeover");
    await writeFile(takeover, JSON.stringify({
      pid: process.ppid,
      takeoverToken: "crashed-claim-with-reused-pid",
      ownerToken: "released-owner",
    }));
    const stale = new Date(Date.now() - 10 * 60_000);
    await utimes(takeover, stale, stale);
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');

    const startedAt = Date.now();
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    assert.ok(Date.now() - startedAt < 2_000, "an aged claim is reclaimed despite PID reuse");
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // Registration must precede publication. Pause the first same-process
  // contender after writeFile and prove a second contender leaves its active
  // marker intact while waiting for the takeover to finish.
  {
    const { coven, cave } = await home("takeover-register-before-publish");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');

    let markPublished!: (token: string) => void;
    const published = new Promise<string>((resolve) => { markPublished = resolve; });
    let releasePublisher!: () => void;
    const publisherMayContinue = new Promise<void>((resolve) => { releasePublisher = resolve; });
    let paused = false;
    const first = migrateCaveHome({
      createSymlink: denySymlink,
      takeoverPublishProbe: async (token) => {
        if (paused) return;
        paused = true;
        markPublished(token);
        await publisherMayContinue;
      },
    });
    const publishedToken = await published;
    const second = migrateCaveHome({ createSymlink: denySymlink });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await json(path.join(lock, ".takeover"))).takeoverToken, publishedToken);
    releasePublisher();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(firstResult.errors, []);
    assert.deepEqual(secondResult.errors, []);
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // A failed Windows unlock rename can leave a lock owned by this still-live
  // process on disk. Process liveness alone cannot distinguish that orphan
  // from an active critical section, so the process-wide active-token set is
  // authoritative for same-PID recovery.
  {
    const { coven, cave } = await home("same-process-orphan-lock");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      pid: process.pid,
      token: "abandoned-same-process-owner",
      startedAt: new Date().toISOString(),
    }));
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');

    const startedAt = Date.now();
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    assert.ok(Date.now() - startedAt < 2_000, "a same-process orphan is reclaimed without timing out");
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // A failed Windows reclaim rename can also leave a takeover claim from this
  // still-live process. Only an actively tracked token represents an in-flight
  // contender; an untracked same-process marker must not block later stores.
  {
    const { coven, cave } = await home("same-process-orphan-takeover");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      pid: process.pid,
      token: "released-same-process-owner",
      startedAt: new Date().toISOString(),
      releasedAt: new Date().toISOString(),
    }));
    await writeFile(path.join(lock, ".takeover"), JSON.stringify({
      pid: process.pid,
      takeoverToken: "abandoned-same-process-takeover",
      ownerToken: "released-same-process-owner",
      startedAt: new Date().toISOString(),
    }));
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');

    const startedAt = Date.now();
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    assert.ok(Date.now() - startedAt < 2_000, "a same-process orphan takeover is reclaimed without hanging");
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // Publishing release intent must not let a waiter reclaim the lock before
  // its owner finishes the unlock rename. Otherwise the old release path can
  // rename a newly acquired successor lock and break mutual exclusion.
  {
    const { coven } = await home("release-publication-order");
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');
    let finishRelease!: () => void;
    const releaseMayFinish = new Promise<void>((resolve) => { finishRelease = resolve; });
    let markReleasing!: () => void;
    const ownerIsReleasing = new Promise<void>((resolve) => { markReleasing = resolve; });
    let active = 0;
    let maxActive = 0;
    const owner = migrateCaveHome({
      createSymlink: denySymlink,
      lockProbe: async (event) => {
        if (event === "acquired") {
          active += 1;
          maxActive = Math.max(maxActive, active);
        } else if (event === "released") {
          markReleasing();
          await releaseMayFinish;
          active -= 1;
        }
      },
    });
    await ownerIsReleasing;
    const contender = migrateCaveHome({
      createSymlink: denySymlink,
      lockProbe: (event) => {
        if (event === "acquired") {
          active += 1;
          maxActive = Math.max(maxActive, active);
        } else if (event === "released") {
          active -= 1;
        }
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(maxActive, 1);
    finishRelease();
    const [ownerResult, contenderResult] = await Promise.all([owner, contender]);
    assert.deepEqual(ownerResult.errors, []);
    assert.deepEqual(contenderResult.errors, []);
    assert.equal(maxActive, 1);
    assert.equal(active, 0);
  }

  // A transient Windows unlock failure is completed by publishing release
  // intent. The operation itself succeeds, and the next waiter reclaims the
  // leftover directory rather than surfacing a 500 or waiting indefinitely.
  {
    const { coven, cave } = await home("failed-unlock-rename");
    await writeFile(path.join(coven, "cave-config.json"), '{"safe":true}');
    let failUnlock = true;
    const first = await migrateCaveHome({
      createSymlink: denySymlink,
      lockReleaseRename: async (source, destination) => {
        if (failUnlock) {
          failUnlock = false;
          const error = new Error("injected Windows unlock failure") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        }
        await rename(source, destination);
      },
    });
    assert.deepEqual(first.errors, []);
    const lock = path.join(cave, ".migration.lock");
    assert.equal(typeof (await json(path.join(lock, "owner.json"))).releasedAt, "string");

    const second = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(second.errors, []);
    assert.equal(await kind(lock), "missing");
  }

  // An active owner has a hard acquisition deadline. Timing out removes every
  // contender-owned candidate and emits bounded, data-free terminal telemetry.
  {
    const { cave } = await home("active-lock-timeout");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      pid: process.ppid,
      token: "active-parent-owner",
      startedAt: new Date().toISOString(),
    }));
    const diagnostics = [];
    const startedAt = Date.now();
    await assert.rejects(
      migrateCaveHome({ lockTimeoutMs: 150, lockDiagnostic: (event) => diagnostics.push(event) }),
      (error) => error?.code === "ETIMEDOUT",
    );
    assert.ok(Date.now() - startedAt >= 100 && Date.now() - startedAt < 1_500);
    assert.equal(diagnostics[0]?.phase, "waiting");
    assert.deepEqual(diagnostics.at(-1), {
      phase: "failed",
      result: "timeout",
      durationMs: diagnostics.at(-1).durationMs,
      errorCode: "ETIMEDOUT",
    });
    assert.equal(
      (await readdir(cave)).some((name) => name.startsWith(".migration.lock.candidate-")),
      false,
      "timed-out contenders remove their own candidate directories",
    );
  }

  // A transient failure while writing the owner record leaves the retained
  // candidate directory behind. Retrying must reuse that directory rather
  // than treating its next mkdir as external lock contention until timeout.
  {
    const { cave } = await home("candidate-owner-write-eperm");
    await mkdir(cave, { recursive: true });
    let ownerWriteAttempts = 0;
    const candidates = new Set<string>();
    const transientOwnerWrite = async (candidate: string, owner: unknown) => {
      ownerWriteAttempts += 1;
      candidates.add(candidate);
      if (ownerWriteAttempts === 1) {
        const error = new Error("injected Windows candidate owner write failure") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      await writeFile(path.join(candidate, "owner.json"), JSON.stringify(owner));
    };
    const result = await migrateCaveHome({ lockCandidateOwnerWrite: transientOwnerWrite });
    assert.deepEqual(result.errors, []);
    assert.equal(ownerWriteAttempts, 2, "candidate owner write retries after transient EPERM");
    assert.equal(candidates.size, 1, "candidate owner write reuses the retained directory");
  }

  // Persistent Windows EPERM while publishing a candidate is retryable but
  // bounded. No lock is published and no candidate debris survives timeout.
  {
    const { cave } = await home("candidate-eperm-timeout");
    await mkdir(cave, { recursive: true });
    let renameAttempts = 0;
    const candidates = new Set<string>();
    const epermRename = async (candidate: string) => {
      renameAttempts += 1;
      candidates.add(candidate);
      const error = new Error("injected Windows candidate failure") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    };
    await assert.rejects(
      migrateCaveHome({ lockTimeoutMs: 150, lockCandidateRename: epermRename }),
      (error) => error?.code === "ETIMEDOUT",
    );
    assert.ok(renameAttempts >= 2, "candidate publication retries until the deadline");
    assert.equal(candidates.size, 1, "candidate publication reuses one directory for every retry");
    assert.equal(
      (await readdir(cave)).some((name) => name.startsWith(".migration.lock.candidate-")),
      false,
    );
  }

  // Persistent Windows EPERM while fencing a released lock likewise stops at
  // the deadline without deleting or replacing the still-owned lock directory.
  {
    const { cave } = await home("reclaim-eperm-timeout");
    await mkdir(cave, { recursive: true });
    const lock = path.join(cave, ".migration.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      pid: process.ppid,
      token: "released-owner",
      startedAt: new Date().toISOString(),
      releasedAt: new Date().toISOString(),
    }));
    let fenceAttempts = 0;
    const epermRename = async () => {
      fenceAttempts += 1;
      const error = new Error("injected Windows reclaim failure") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    };
    await assert.rejects(
      migrateCaveHome({ lockTimeoutMs: 150, lockFenceRename: epermRename }),
      (error) => error?.code === "ETIMEDOUT",
    );
    assert.ok(fenceAttempts >= 2, "released-lock fencing retries until the deadline");
    assert.equal(await kind(lock), "dir", "failed fencing never removes the owned lock");
    assert.equal((await json(path.join(lock, "owner.json"))).token, "released-owner");
  }

  console.log("cave-home-migration-locks-takeover.test.ts: ok");
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
