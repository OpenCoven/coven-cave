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

  // Do not treat an arbitrary or broken legacy symlink as a completed
  // compatibility bridge. Its target may contain the only remaining data.
  {
    const { coven, cave } = await home("foreign-legacy-symlink");
    const foreign = path.join(coven, "foreign-config.json");
    await mkdir(cave, { recursive: true });
    await writeFile(foreign, '{"source":"foreign"}', "utf8");
    await writeFile(path.join(cave, "config.json"), '{"source":"canonical"}', "utf8");
    await symlink(path.basename(foreign), path.join(coven, "cave-config.json"), "file");
    const status = await caveHomeMigrationStatus();
    assert.equal(status.conflicts.includes("cave-config.json"), true);
    assert.deepEqual(status.details.find((detail) => detail.legacy === "cave-config.json")?.actions, ["defer"]);
    const result = await migrateCaveHome();
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(foreign), { source: "foreign" });
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

  // An old tool can recreate the ordinary legacy file after reconciliation
  // removes it but before the compatibility bridge is installed. Never let
  // the mirror fallback overwrite that concurrent write.
  {
    const { coven, cave } = await home("windows-mirror-race");
    const legacyPath = path.join(coven, "cave-config.json");
    await writeFile(legacyPath, '{"source":"startup"}', "utf8");
    const concurrentWriter: typeof denySymlink = async () => {
      await writeFile(legacyPath, '{"source":"older-tool"}', "utf8");
      const error = new Error("legacy path was recreated") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    };
    const result = await migrateCaveHome({ createSymlink: concurrentWriter });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(path.join(cave, "config.json")), { source: "startup" });
    assert.deepEqual(await json(legacyPath), { source: "older-tool" });
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-config.json"), true);
  }

  // A stale writer can also change the existing legacy path after its backup
  // was verified but before bridge installation starts. Preserve that write
  // instead of deleting it as though it were the snapshot we inspected.
  {
    const { coven, cave } = await home("windows-pre-bridge-write");
    const legacyPath = path.join(coven, "cave-config.json");
    await writeFile(legacyPath, '{"source":"startup"}', "utf8");
    const result = await migrateCaveHome({
      createSymlink: denySymlink,
      compatibilityProbe: async () => {
        await writeFile(legacyPath, '{"source":"older-tool"}', "utf8");
      },
    });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(path.join(cave, "config.json")), { source: "startup" });
    assert.deepEqual(await json(legacyPath), { source: "older-tool" });
    assert.equal((await readdir(coven)).some((name) => name.includes("migration-retired")), false);
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-config.json"), true);
  }

  // A canonical writer can also race bridge installation. If it changes the
  // validated canonical bytes, keep the original legacy copy at its ordinary
  // path instead of replacing it with the unvalidated canonical write.
  {
    const { coven, cave } = await home("canonical-pre-bridge-write");
    const legacyPath = path.join(coven, "cave-config.json");
    const canonicalPath = path.join(cave, "config.json");
    await mkdir(cave, { recursive: true });
    await writeFile(legacyPath, '{"source":"known-good"}', "utf8");
    await writeFile(canonicalPath, '{"source":"known-good"}', "utf8");
    const result = await migrateCaveHome({
      createSymlink: denySymlink,
      compatibilityProbe: async () => {
        await writeFile(canonicalPath, "not-json", "utf8");
      },
    });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(legacyPath), { source: "known-good" });
    assert.equal(await readFile(canonicalPath, "utf8"), "not-json");
  }

  // A symlink can be installed before canonical validation notices a late
  // invalid write. Remove that attempted link and restore the original legacy
  // pathname instead of hiding the recoverable bytes in a retired file.
  {
    const { coven, cave } = await home("canonical-post-link-write");
    const legacyPath = path.join(coven, "cave-config.json");
    const canonicalPath = path.join(cave, "config.json");
    await mkdir(cave, { recursive: true });
    await writeFile(legacyPath, '{"source":"known-good"}', "utf8");
    await writeFile(canonicalPath, '{"source":"known-good"}', "utf8");
    const result = await migrateCaveHome({
      createSymlink: async (target, linkPath, type) => {
        await symlink(target, linkPath, type);
        await writeFile(canonicalPath, "not-json", "utf8");
      },
    });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(legacyPath), { source: "known-good" });
    assert.equal(await readFile(canonicalPath, "utf8"), "not-json");
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-config.json"), true);
  }

  // The directory fallback must also fail closed if an old tool recreates the
  // legacy directory after removal but before the compatibility copy starts.
  {
    const { coven, cave } = await home("windows-directory-mirror-race");
    const legacyPath = path.join(coven, "cave-conversations");
    await mkdir(legacyPath, { recursive: true });
    await writeFile(path.join(legacyPath, "startup.json"), "startup");
    const concurrentWriter: typeof denySymlink = async () => {
      await mkdir(legacyPath, { recursive: true });
      await writeFile(path.join(legacyPath, "older-tool.json"), "older-tool");
      const error = new Error("legacy directory was recreated") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    };
    const result = await migrateCaveHome({ createSymlink: concurrentWriter });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-conversations"), true);
    assert.equal(await readFile(path.join(cave, "conversations", "startup.json"), "utf8"), "startup");
    assert.equal(await readFile(path.join(legacyPath, "older-tool.json"), "utf8"), "older-tool");
    assert.equal(await kind(path.join(legacyPath, "startup.json")), "missing");
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

  // Canonical data can change after validation but before a managed mirror is
  // refreshed. Stage and hash-check the exact validated snapshot before
  // retiring the last known-good mirror.
  {
    const { coven, cave } = await home("canonical-mirror-refresh-race");
    const legacyPath = path.join(coven, "cave-config.json");
    const canonicalPath = path.join(cave, "config.json");
    await writeFile(legacyPath, '{"knownGood":true}', "utf8");
    assert.deepEqual((await migrateCaveHome({ createSymlink: denySymlink })).errors, []);
    await writeFile(canonicalPath, '{"newer":true}', "utf8");
    const result = await migrateCaveHome({
      createSymlink: denySymlink,
      managedMirrorProbe: async () => {
        await writeFile(canonicalPath, "not-json", "utf8");
      },
    });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(legacyPath), { knownGood: true });
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

  // Inbox records present in both snapshots merge by stable ID; the newer
  // revision/timestamp wins.
  {
    const { coven, cave } = await home("inbox");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "shared", title: "newer", revision: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" },
    ] }));
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "shared", title: "older", revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
    ] }));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.deepEqual(result.errors, []);
    const merged = await json(path.join(cave, "inbox.json"));
    assert.deepEqual(merged.items.map((item) => item.id), ["shared"]);
    assert.equal(merged.items.find((item) => item.id === "shared").title, "newer");
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
  }

  // Inbox deletion removes an ID without leaving a tombstone. A one-sided
  // item may therefore be either a new item or one deleted from the other
  // snapshot, so automatic union must leave both files for explicit review.
  {
    const { coven, cave } = await home("inbox-ambiguous-deletion");
    await mkdir(cave, { recursive: true });
    const deleted = { id: "deleted", title: "Removed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [deleted] }));
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [] }));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(result.skipped.includes("cave-inbox.json"));
    assert.deepEqual((await json(path.join(cave, "inbox.json"))).items, [], "deleted canonical item is not resurrected");
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-inbox.json"), true);
  }

  // Duplicate IDs inside one snapshot are malformed. Collapsing them through
  // a Map would silently discard one record during automatic reconciliation.
  {
    const { coven, cave } = await home("inbox-duplicate-id");
    await mkdir(cave, { recursive: true });
    const first = { id: "duplicate", title: "first", revision: 1, updatedAt: "2026-01-01T00:00:00Z" };
    const second = { id: "duplicate", title: "second", revision: 2, updatedAt: "2026-02-01T00:00:00Z" };
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [first, second] }));
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [first] }));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(result.skipped.includes("cave-inbox.json"));
    assert.deepEqual((await json(path.join(cave, "inbox.json"))).items, [first]);
  }

  // Append-only state maps and queued work are unioned without dropping
  // legacy-only keys.
  {
    const { coven, cave } = await home("state");
    await mkdir(cave, { recursive: true });
    const legacy = baseState();
    legacy.sessionFamiliar.legacy = "nova";
    legacy.travel.offlineQueue.push({ id: "legacy-work", kind: "job", summary: "Legacy", createdAt: "2026-01-01T00:00:00Z", status: "pending" });
    const canonical = baseState();
    canonical.sessionFamiliar.current = "salem";
    canonical.travel.offlineQueue.push({ id: "current-work", kind: "job", summary: "Current", createdAt: "2026-02-01T00:00:00Z", status: "pending" });
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    await migrateCaveHome({ createSymlink: denySymlink });
    const merged = await json(path.join(cave, "state.json"));
    assert.deepEqual(Object.keys(merged.sessionFamiliar).sort(), ["current", "legacy"]);
    assert.deepEqual(merged.travel.offlineQueue.map((item) => item.id).sort(), ["current-work", "legacy-work"]);
  }

  // Session titles, archive markers, and keep markers delete keys during
  // ordinary user actions. A one-sided key cannot be distinguished from a
  // later deletion, so preserve both snapshots for explicit review.
  {
    const { coven, cave } = await home("state-ambiguous-deleted-key");
    await mkdir(cave, { recursive: true });
    const legacy = baseState();
    legacy.sessionArchived.session = "2026-01-01T00:00:00Z";
    const canonical = baseState();
    canonical.sessionFamiliar.current = "salem";
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(result.skipped.includes("cave-state.json"));
    assert.deepEqual((await json(path.join(cave, "state.json"))).sessionArchived, {});
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-state.json"), true);
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

  // A duplicate queue ID within one snapshot is likewise ambiguous and must
  // not be deduplicated as though it were the same item from both snapshots.
  {
    const { coven, cave } = await home("state-duplicate-queue-id");
    await mkdir(cave, { recursive: true });
    const legacy = baseState();
    legacy.travel.offlineQueue.push(
      { id: "duplicate", status: "pending" },
      { id: "duplicate", status: "failed" },
    );
    const canonical = baseState();
    canonical.travel.offlineQueue.push({ id: "duplicate", status: "pending" });
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(result.skipped.includes("cave-state.json"));
    assert.deepEqual((await json(path.join(cave, "state.json"))).travel.offlineQueue, canonical.travel.offlineQueue);
  }

  // Travel mode can transition in both directions. Without a transition
  // revision, an older true value must not override a newer return-online
  // snapshot during an otherwise mergeable state reconciliation.
  {
    const { coven, cave } = await home("state-ambiguous-travel-mode");
    await mkdir(cave, { recursive: true });
    const legacy = baseState();
    legacy.travel.manualOffline = true;
    legacy.travel.staleCache = true;
    const canonical = baseState();
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.ok(result.skipped.includes("cave-state.json"));
    assert.equal((await json(path.join(cave, "state.json"))).travel.manualOffline, false);
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

  // Explicit recovery must not overwrite a canonical write that lands after
  // the recovery bundle is verified.
  {
    const { coven, cave } = await home("recovery-canonical-race");
    await mkdir(cave, { recursive: true });
    const legacy = baseState();
    const canonical = baseState();
    legacy.sessionTitles.shared = "Legacy title";
    canonical.sessionTitles.shared = "Canonical title";
    await writeFile(path.join(coven, "cave-state.json"), JSON.stringify(legacy));
    await writeFile(path.join(cave, "state.json"), JSON.stringify(canonical));
    const result = await migrateCaveHome({
      legacy: "cave-state.json",
      action: "recover-legacy",
      createSymlink: denySymlink,
      resolutionProbe: async (canonicalPath) => {
        const late = baseState();
        late.sessionTitles.shared = "Late canonical title";
        await writeFile(canonicalPath, JSON.stringify(late));
      },
    });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-state.json"), true);
    assert.equal((await json(path.join(cave, "state.json"))).sessionTitles.shared, "Late canonical title");
    assert.equal((await json(path.join(coven, "cave-state.json"))).sessionTitles.shared, "Legacy title");
  }

  // Automatic JSON merge has the same late-writer boundary: preserve the new
  // canonical snapshot and leave the pair reviewable rather than replacing it.
  {
    const { coven, cave } = await home("merge-canonical-race");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "shared", title: "legacy", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" },
    ] }));
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [
      { id: "shared", title: "canonical", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
    ] }));
    const late = { version: 1, items: [
      { id: "late", createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-03T00:00:00Z" },
    ] };
    const result = await migrateCaveHome({
      legacy: "cave-inbox.json",
      createSymlink: denySymlink,
      resolutionProbe: async (canonicalPath) => {
        await writeFile(canonicalPath, JSON.stringify(late));
      },
    });
    assert.equal(result.errors.some((entry) => entry.legacy === "cave-inbox.json"), true);
    assert.deepEqual(await json(path.join(cave, "inbox.json")), late);
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-inbox.json"), true);
  }

  // Deferring a divergent pair retains a verified recovery source in the
  // journal instead of making its bundle eligible for retention pruning. A
  // later canonical failure must still fail the store gate rather than letting
  // deferral turn missing data into a default-store overwrite.
  {
    const { coven, cave } = await home("deferred-backup");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-config.json"), JSON.stringify({ source: "legacy" }));
    await writeFile(path.join(cave, "config.json"), JSON.stringify({ source: "canonical" }));
    const result = await migrateCaveHome({
      legacy: "cave-config.json",
      action: "defer",
      createSymlink: denySymlink,
    });
    assert.equal(result.backedUp.length, 1);
    const journal = await json(path.join(cave, "migration-state.json"));
    const entry = journal.entries["cave-config.json"];
    assert.equal(entry.decision, "deferred");
    assert.equal(await kind(path.join(cave, "migration-backups", entry.backupId)), "dir");
    await rm(path.join(cave, "config.json"));
    globalThis.__caveHomeMigration = Promise.resolve(result);
    await assert.rejects(ensureCaveHomeReconciled("cave-config.json"), /canonical path is missing/);
    const retry = await migrateCaveHome({ createSymlink: denySymlink });
    assert.equal(retry.errors.some((error) => error.legacy === "cave-config.json"), true);
    assert.deepEqual(await json(path.join(coven, "cave-config.json")), { source: "legacy" });
  }

  // A legacy-only file is the sole usable store, so a crafted defer request
  // cannot suppress migration and let readers continue against missing
  // canonical storage.
  {
    const { coven, cave } = await home("defer-pending");
    await writeFile(path.join(coven, "cave-config.json"), JSON.stringify({ source: "only-copy" }));
    const result = await migrateCaveHome({
      legacy: "cave-config.json",
      action: "defer",
      createSymlink: denySymlink,
    });
    assert.equal(result.errors.some((error) => error.legacy === "cave-config.json"), true);
    assert.equal(await kind(path.join(cave, "config.json")), "missing");
    assert.deepEqual(await json(path.join(coven, "cave-config.json")), { source: "only-copy" });
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
  // Explicit recovery also validates the verified legacy backup before it
  // replaces a good canonical store.
  {
    const { coven, cave } = await home("malformed-recovery");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-inbox.json"), "not-json");
    await writeFile(path.join(cave, "inbox.json"), JSON.stringify({ version: 1, items: [{ id: "safe" }] }));
    const result = await migrateCaveHome({
      legacy: "cave-inbox.json",
      action: "recover-legacy",
      createSymlink: denySymlink,
    });
    assert.equal(result.errors.length, 1);
    assert.deepEqual(await json(path.join(cave, "inbox.json")), { version: 1, items: [{ id: "safe" }] });
    assert.equal(await readFile(path.join(coven, "cave-inbox.json"), "utf8"), "not-json");
  }
  // The status surface offers Recover legacy when canonical storage is an
  // invalid symlink. Retire that exact link safely instead of advertising an
  // action that can never replace it; the link target itself remains intact.
  {
    const { coven, cave } = await home("canonical-symlink-recovery");
    const legacyPath = path.join(coven, "cave-config.json");
    const canonicalPath = path.join(cave, "config.json");
    const foreignPath = path.join(cave, "foreign-config.json");
    await mkdir(cave, { recursive: true });
    await writeFile(legacyPath, '{"source":"legacy"}');
    await writeFile(foreignPath, '{"source":"foreign"}');
    await symlink(path.basename(foreignPath), canonicalPath, "file");
    assert.deepEqual(
      (await caveHomeMigrationStatus()).details.find((detail) => detail.legacy === "cave-config.json")?.actions,
      ["recover-legacy"],
    );

    const result = await migrateCaveHome({
      legacy: "cave-config.json",
      action: "recover-legacy",
      createSymlink: denySymlink,
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(await json(canonicalPath), { source: "legacy" });
    assert.deepEqual(await json(foreignPath), { source: "foreign" });
    assert.equal((await caveHomeMigrationStatus()).migrated, true);
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

  // Directory entries can be deleted, so automatic reconciliation must not
  // resurrect a legacy-only child. An explicit merge may copy it while still
  // preserving divergent collisions for review after a verified backup.
  {
    const { coven, cave } = await home("directory");
    await mkdir(path.join(coven, "cave-conversations"), { recursive: true });
    await mkdir(path.join(cave, "conversations"), { recursive: true });
    await writeFile(path.join(coven, "cave-conversations", "legacy.json"), "legacy-only");
    await writeFile(path.join(coven, "cave-conversations", "shared.json"), "legacy");
    await writeFile(path.join(cave, "conversations", "shared.json"), "canonical");
    const result = await migrateCaveHome({ createSymlink: denySymlink });
    assert.equal(result.merged.find((entry) => entry.legacy === "cave-conversations"), undefined);
    assert.equal(await kind(path.join(cave, "conversations", "legacy.json")), "missing");
    assert.equal(await readFile(path.join(cave, "conversations", "shared.json"), "utf8"), "canonical");
    assert.equal((await caveHomeMigrationStatus()).conflicts.includes("cave-conversations"), true);

    const merged = await migrateCaveHome({
      legacy: "cave-conversations",
      action: "merge",
      createSymlink: denySymlink,
    });
    assert.deepEqual(merged.merged.find((entry) => entry.legacy === "cave-conversations"), {
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
    assert.equal(staleObservers, 2);
    assert.equal(maxActive, 1);
    assert.equal(active, 0);
    assert.deepEqual(await json(path.join(cave, "config.json")), { safe: true });
  }

  // Store transactions share the cross-process migration lock. A writer that
  // already passed startup reconciliation must not read an old snapshot while
  // a manual recovery is replacing canonical storage and overwrite it later.
  {
    const { coven, cave } = await home("store-transaction-lock");
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(coven, "cave-config.json"), JSON.stringify({ source: "legacy" }));
    await writeFile(path.join(cave, "config.json"), JSON.stringify({ source: "canonical" }));
    const initial = await migrateCaveHome({ legacy: "cave-config.json", createSymlink: denySymlink });
    globalThis.__caveHomeMigration = Promise.resolve(initial);

    let continueRecovery!: () => void;
    const recoveryPaused = new Promise<void>((resolve) => { continueRecovery = resolve; });
    let recoveryReached!: () => void;
    const atReplacement = new Promise<void>((resolve) => { recoveryReached = resolve; });
    const recovery = migrateCaveHome({
      legacy: "cave-config.json",
      action: "recover-legacy",
      createSymlink: denySymlink,
      resolutionProbe: async () => {
        recoveryReached();
        await recoveryPaused;
      },
    });
    await atReplacement;

    let storeEntered = false;
    const store = withCaveHomeReconciledStore("cave-config.json", async () => {
      storeEntered = true;
      return json(path.join(cave, "config.json"));
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(storeEntered, false);
    continueRecovery();
    assert.deepEqual((await recovery).errors, []);
    assert.deepEqual(await store, { source: "legacy" });
  }

  // Store readers fail closed on a bad migration, then retry on the next call
  // after the recoverable input is repaired instead of caching the failure.
  {
    const { coven, cave } = await home("reader-gate-retry");
    globalThis.__caveHomeMigration = undefined;
    await writeFile(path.join(coven, "cave-inbox.json"), "not-json");
    await assert.rejects(ensureCaveHomeReconciled("cave-inbox.json"), /cave-inbox\.json/);
    await writeFile(path.join(coven, "cave-inbox.json"), JSON.stringify({ version: 1, items: [] }));
    await ensureCaveHomeReconciled("cave-inbox.json");
    assert.deepEqual(await json(path.join(cave, "inbox.json")), { version: 1, items: [] });
  }

  // An unrelated legacy-path problem must not take every gated Cave store
  // offline or force a full reconciliation pass on every state read.
  {
    const { coven, cave } = await home("reader-gate-scoped");
    globalThis.__caveHomeMigration = undefined;
    await mkdir(cave, { recursive: true });
    await writeFile(path.join(cave, "state.json"), JSON.stringify(baseState()));
    await writeFile(path.join(cave, "backdrop.jpg"), "canonical");
    await writeFile(path.join(coven, "foreign-backdrop.jpg"), "foreign");
    await symlink("foreign-backdrop.jpg", path.join(coven, "cave-backdrop.jpg"), "file");

    await ensureCaveHomeReconciled("cave-state.json");
    const cached = await globalThis.__caveHomeMigration;
    assert.deepEqual(cached?.errors.map((entry) => entry.legacy), ["cave-backdrop.jpg"]);
    await ensureCaveHomeReconciled("cave-state.json");
  }

  console.log("cave-home-migration.test.ts: ok");
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
