// @ts-nocheck
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const { ensureCaveHomeReconciled, migrateCaveHome } = await import("./cave-home-migration.ts");
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
  // Fresh and canonical-only installs are complete and create a durable journal.
  {
    const { cave } = await home("fresh");
    const result = await migrateCaveHome();
    assert.deepEqual(result.errors, []);
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
    assert.equal((await json(path.join(cave, "migration-state.json"))).migrationVersion, 2);
  }
  {
    const { cave } = await home("canonical-only");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "config.json"), "{}", "utf8");
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
  }

  // Legacy-only data moves to canonical storage. On normal Windows, a verified
  // ordinary mirror replaces the unavailable file symlink and does not warn.
  {
    const { coven, cave } = await home("windows-mirror");
    await writeFile(path.join(coven, "cave-config.json"), '{"source":"legacy"}', "utf8");
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(await json(path.join(cave, "config.json")), { source: "legacy" });
    assert.equal(await kind(path.join(coven, "cave-config.json")), "file");
    const journal = await json(path.join(cave, "migration-state.json"));
    assert.equal(journal.entries["cave-config.json"].decision, "moved");
    assert.equal(journal.entries["cave-config.json"].compatibility, "mirror");
    assert.equal((await caveHomeMigrationStatus()).migrated, true, "unchanged managed mirror is not a conflict");

    await writeFile(path.join(coven, "cave-config.json"), '{"source":"older-tool"}', "utf8");
    assert.deepEqual((await caveHomeMigrationStatus()).conflicts, ["cave-config.json"], "changed mirror is detected");
    const resolved = await migrateCaveHome({ legacy: "cave-config.json", action: "keep-canonical", createSymlink: denySymlink });
    assert.deepEqual(resolved.errors, []);
    assert.deepEqual(await json(path.join(coven, "cave-config.json")), { source: "legacy" });
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
    const recovery = path.join(cave, "migration-backups");
    const bundles = await readdir(recovery);
    assert.equal(bundles.length, 1);
    const manifest = await json(path.join(recovery, bundles[0], "manifest.json"));
    assert.equal(manifest.files.length, 2);
    assert.ok(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.hash)));
    assert.equal(JSON.stringify(manifest).includes("older-tool"), false, "backup metadata never logs file contents");
  }

  // A damaged canonical copy must never overwrite the last known-good managed
  // mirror, and the status endpoint must surface the repair instead of hiding it.
  {
    const { coven, cave } = await home("damaged-canonical-mirror");
    await writeFile(path.join(coven, "cave-config.json"), '{"knownGood":true}', "utf8");
    assert.deepEqual((await migrateCaveHome({ createSymlink: denySymlink })).errors, []);
    await writeFile(path.join(cave, "config.json"), "not-json", "utf8");
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(path.join(coven, "cave-config.json")), { knownGood: true });
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-config.json"), true);
  }

  // If the canonical side is deleted after startup, an unchanged managed
  // mirror is still pending recovery rather than falsely reported as migrated.
  {
    const { coven, cave } = await home("missing-canonical-mirror");
    await writeFile(path.join(coven, "cave-config.json"), '{"recoverable":true}', "utf8");
    assert.deepEqual((await migrateCaveHome({ createSymlink: denySymlink })).errors, []);
    await rm(path.join(cave, "config.json"));
    const status = await caveHomeMigrationStatus();
    assert.equal(status.pending.includes("cave-config.json"), true);
    assert.equal(status.migrated, false);
  }

  // Inbox records merge by stable ID; the newer revision/timestamp wins.
  {
    const { coven, cave } = await home("inbox");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "legacy-only", title: "legacy", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "shared", title: "newer", revision: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" },
    ] }));
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "canonical-only", title: "canonical", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
      { id: "shared", title: "older", revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
    ] }));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    const merged = await json(path.join(cave, "inbox.json"));
    assert.deepEqual(merged.items.map((item) => item.id), ["legacy-only", "shared", "canonical-only"]);
    assert.equal(merged.items.find((item) => item.id === "shared").title, "newer");
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
  }

  // State maps and queued work are unioned without dropping legacy-only keys.
  {
    const { coven, cave } = await home("state");
    await mkdir(cave, { recursive: true });
    const legacy = baseState();
    legacy.sessionTitles.legacy = "Legacy session";
    legacy.sessionFamiliar.legacy = "nova";
    legacy.travel.offlineQueue.push({ id: "legacy-work", kind: "job", summary: "Legacy", createdAt: "2026-01-01T00:00:00Z", status: "pending" });
    const canonical = baseState();
    canonical.sessionTitles.current = "Current session";
    canonical.sessionFamiliar.current = "salem";
    canonical.travel.offlineQueue.push({ id: "current-work", kind: "job", summary: "Current", createdAt: "2026-02-01T00:00:00Z", status: "pending" });
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    await migrateCaveHome({ createSymlink: denySymlink });
    const merged = await json(path.join(cave, "state.json"));
    assert.deepEqual(Object.keys(merged.sessionTitles).sort(), ["current", "legacy"]);
    assert.deepEqual(merged.travel.offlineQueue.map((item) => item.id).sort(), ["current-work", "legacy-work"]);
  }

  // Queue statuses have no revision and can move from failed back to syncing
  // on retry, so divergent snapshots must not be ranked as if monotonic.
  {
    const { coven, cave } = await home("state-ambiguous-queue-status");
    await mkdir(cave, { recursive: true });
    const item = { id: "shared-work", kind: "job", summary: "Shared", createdAt: "2026-01-01T00:00:00Z" };
    const legacy = baseState();
    legacy.travel.offlineQueue.push({ ...item, status: "failed", lastError: "old failure" });
    const canonical = baseState();
    canonical.travel.offlineQueue.push({ ...item, status: "syncing" });
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(result.skipped.includes("cave-state.json"));
    assert.equal((await json(path.join(cave, "state.json"))).travel.offlineQueue[0].status, "syncing");
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-state.json"), true);
  }

  // Theme selection can merge independently because it has its own revision
  // and timestamp.
  {
    const { coven, cave } = await home("preferences");
    await mkdir(cave, { recursive: true });
    const legacy = createDefaultPreferences(true);
    legacy.revision = 2;
    legacy.updatedAt = "2026-01-01T00:00:00Z";
    legacy.appearance.theme.id = "tide";
    legacy.appearance.theme.selectionRevision = 9;
    legacy.appearance.theme.updatedAt = "2026-04-01T00:00:00Z";
    const canonical = createDefaultPreferences(true);
    canonical.revision = 8;
    canonical.updatedAt = "2026-03-01T00:00:00Z";
    await writeFile(path.join(coven, "cave-preferences.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "preferences.json"), JSON.stringify(canonical));
    await migrateCaveHome({ createSymlink: denySymlink });
    const merged = await json(path.join(cave, "preferences.json"));
    assert.equal(merged.appearance.theme.id, "tide", "newer independent theme selection wins");
    assert.equal(merged.revision, 9);
  }

  // A file-wide revision cannot establish which side owns independent
  // section edits. Leave both snapshots reviewable instead of letting the
  // larger revision silently discard a unique change from the other side.
  {
    const { coven, cave } = await home("preferences-ambiguous-sections");
    await mkdir(cave, { recursive: true });
    const legacy = createDefaultPreferences(true);
    legacy.revision = 2;
    legacy.updatedAt = "2026-01-01T00:00:00Z";
    legacy.general.stopPhrase = "legacy stop";
    const canonical = createDefaultPreferences(true);
    canonical.revision = 8;
    canonical.updatedAt = "2026-03-01T00:00:00Z";
    canonical.general.newsHeadlines = false;
    await writeFile(path.join(coven, "cave-preferences.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "preferences.json"), JSON.stringify(canonical));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(result.skipped.includes("cave-preferences.json"));
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-preferences.json"), true);
    assert.equal((await json(path.join(coven, "cave-preferences.json"))).general.stopPhrase, "legacy stop");
    assert.equal((await json(path.join(cave, "preferences.json"))).general.newsHeadlines, false);
  }

  // Existing Cave-home and per-store path overrides remain authoritative.
  {
    const { root, coven } = await home("overrides");
    process.env.COVEN_CAVE_HOME = path.join(root, "custom-cave");
    process.env.COVEN_PREFERENCES_PATH = path.join(root, "custom-store", "prefs.json");
    const legacy = createDefaultPreferences(true);
    legacy.revision = 3;
    legacy.updatedAt = "2026-04-01T00:00:00Z";
    await writeFile(path.join(coven, "cave-preferences.json"), JSON.stringify(legacy));
    await migrateCaveHome({ createSymlink: denySymlink });
    assert.equal((await json(process.env.COVEN_PREFERENCES_PATH)).revision, 3);
    assert.equal((await json(path.join(process.env.COVEN_CAVE_HOME, "migration-state.json"))).migrationVersion, 2);
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
  }

  // An override may intentionally retain the historical path. Treat that
  // path as canonical instead of deleting it while creating a compat bridge.
  {
    const { coven } = await home("legacy-path-override");
    const legacyPath = path.join(coven, "cave-preferences.json");
    process.env.COVEN_PREFERENCES_PATH = legacyPath;
    const preferences = createDefaultPreferences(true);
    preferences.revision = 4;
    await writeFile(legacyPath, JSON.stringify(preferences));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    assert.equal(await kind(legacyPath), "file");
    assert.equal((await json(legacyPath)).revision, 4);
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
    await rm(legacyPath);
    assert.deepEqual((await migrateCaveHome({ createSymlink: denySymlink })).errors, []);
  }

  // Ambiguous state is backed up and left untouched until an explicit recovery.
  {
    const { coven, cave } = await home("ambiguous");
    await mkdir(cave, { recursive: true });
    const legacy = baseState();
    const canonical = baseState();
    legacy.sessionTitles.shared = "Legacy title";
    canonical.sessionTitles.shared = "Canonical title";
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    const first = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(first.skipped.includes("cave-state.json"));
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-state.json"), true);
    assert.equal((await json(path.join(cave, "state.json"))).sessionTitles.shared, "Canonical title");
    await migrateCaveHome({ legacy: "cave-state.json", action: "recover-legacy", createSymlink: denySymlink });
    assert.equal((await json(path.join(cave, "state.json"))).sessionTitles.shared, "Legacy title");
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
  }

  // Malformed JSON never overwrites either side and remains reviewable.
  {
    const { coven, cave } = await home("malformed");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-inbox.json"), "not-json");
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [] }));
    await migrateCaveHome({ createSymlink: denySymlink });
    assert.equal(await readFile(path.join(coven, "cave-inbox.json"), "utf8"), "not-json");
    assert.deepEqual(await json(path.join(cave, "inbox.json")), { version: 1, items: [] });
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-inbox.json"), true);
  }
  {
    const { coven, cave } = await home("malformed-identical");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-config.json"), "not-json");
    await writeFile(path.join(cave, "config.json"), "not-json");
    assert.equal((await migrateCaveHome({ createSymlink: denySymlink })).errors.length, 1);
    assert.equal(await readFile(path.join(coven, "cave-config.json"), "utf8"), "not-json");
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-config.json"), true);
  }

  // Directory merge copies legacy-only children but preserves divergent
  // collisions for review after a verified backup.
  {
    const { coven, cave } = await home("directory");
    await mkdir(path.join(coven, "cave-conversations"), { recursive: true });
    await mkdir(path.join(cave, "conversations"), { recursive: true });
    await writeFile(path.join(coven, "cave-conversations", "legacy.json"), "legacy-only");
    await writeFile(path.join(coven, "cave-conversations", "shared.json"), "legacy");
    await writeFile(path.join(cave, "conversations", "shared.json"), "canonical");
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.merged.find((entry) => entry.legacy === "cave-conversations"), {
      legacy: "cave-conversations", files: 1, collisions: 1,
    });
    assert.equal(await readFile(path.join(cave, "conversations", "legacy.json"), "utf8"), "legacy-only");
    assert.equal(await readFile(path.join(cave, "conversations", "shared.json"), "utf8"), "canonical");
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-conversations"), true);
  }

  // Every write boundary resumes idempotently. Backup-boundary faults return
  // an entry error; journal-boundary faults reject after releasing the lock.
  for (const boundary of [
    "after-backup-directory", "after-backup-legacy", "after-backup-canonical",
    "after-backup-manifest", "after-merge-write", "before-journal-write", "after-journal-write",
  ]) {
    const { coven, cave } = await home(`fault-${boundary}`);
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "legacy", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    ] }));
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "canonical", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
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

  // Store readers fail closed on a bad migration, then retry on the next call
  // after the recoverable input is repaired instead of caching the failure.
  {
    const { coven, cave } = await home("reader-gate-retry");
    await writeFile(path.join(coven, "cave-inbox.json"), "not-json");
    await assert.rejects(ensureCaveHomeReconciled(), /cave-inbox\.json/);
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [] }));
    await ensureCaveHomeReconciled();
    assert.deepEqual(await json(path.join(cave, "inbox.json")), { version: 1, items: [] });
  }

  console.log("cave-home-migration.test.ts: ok");
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
