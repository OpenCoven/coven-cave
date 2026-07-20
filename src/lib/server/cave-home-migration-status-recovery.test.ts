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

  console.log("cave-home-migration-status-recovery.test.ts: ok");
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
