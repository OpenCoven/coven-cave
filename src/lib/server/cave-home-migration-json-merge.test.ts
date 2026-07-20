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

  console.log("cave-home-migration-json-merge.test.ts: ok");
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
