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

  console.log("cave-home-migration-backup-recovery.test.ts: ok");
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}

