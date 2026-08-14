import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "artifacts", "backup-sync-test");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const home = path.join(root, "home", ".coven");
const destination = path.join(root, "snapshots");
process.env.COVEN_HOME = home;
delete process.env.COVEN_CAVE_HOME;

await mkdir(path.join(home, "cave"), { recursive: true });
await mkdir(destination, { recursive: true });
await writeFile(path.join(home, "cave", "config.json"), JSON.stringify({ multiHost: { mode: "local" } }));

const {
  clearBackupSyncPassphrase,
  defaultBackupSyncDirectory,
  getBackupSyncOverview,
  hasBackupSyncPassphrase,
  isBackupSyncDue,
  loadBackupSyncConfig,
  loadBackupSyncStatus,
  runBackupSync,
  setBackupSyncPassphrase,
  updateBackupSyncConfig,
  validateBackupSyncDirectory,
  BACKUP_FILE_PREFIX,
  BACKUP_FILE_SUFFIX,
} = await import("./backup-sync.ts");
const { decryptBackupArchive } = await import("./backup-archive.ts");

// Defaults: disabled, daily cadence, two-week retention, on-quit push on.
const defaults = await loadBackupSyncConfig();
assert.equal(defaults.enabled, false);
assert.equal(defaults.retainCount, 14);
assert.equal(defaults.intervalHours, 24);
assert.equal(defaults.onQuitPush, true);
assert.equal(defaults.directory, null);
assert.ok(defaultBackupSyncDirectory().endsWith("Coven Cave Backups"), "default destination is a user-owned Coven Cave Backups folder");

// Destinations inside a backed-up home would snowball snapshots into snapshots.
assert.match(validateBackupSyncDirectory(path.join(home, "cave", "nested")) ?? "", /cannot live inside/);
assert.equal(validateBackupSyncDirectory(destination), null);
await assert.rejects(
  () => updateBackupSyncConfig({ directory: path.join(home, "backups") }),
  /cannot live inside/,
  "config update rejects destinations inside the Coven home",
);

const config = await updateBackupSyncConfig({ enabled: true, directory: destination, retainCount: 2 });
assert.equal(config.enabled, true);
assert.equal(config.directory, destination);
assert.equal(config.retainCount, 2);

// Due-ness: never-succeeded is due; fresh success is not; a stale success is.
const status0 = await loadBackupSyncStatus();
assert.equal(isBackupSyncDue(config, status0), true, "enabled with no prior success is due");
const now = Date.now();
assert.equal(
  isBackupSyncDue(config, { ...status0, lastSuccessAt: new Date(now - 60 * 60 * 1000).toISOString() }, now),
  false,
  "an hour-old success is not due on a daily cadence",
);
assert.equal(
  isBackupSyncDue(config, { ...status0, lastSuccessAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }, now),
  true,
  "a 25h-old success is due on a daily cadence",
);
assert.equal(isBackupSyncDue({ ...config, enabled: false }, status0), false, "disabled sync is never due");

// Without a saved passphrase a run records an actionable error and writes nothing.
const noPass = await runBackupSync("scheduled");
assert.match(noPass.lastError ?? "", /passphrase/i);
assert.equal((await readdir(destination)).length, 0, "no snapshot is written without a passphrase");

// Passphrase management: minimum length is enforced; storage is the local vault.
assert.throws(() => setBackupSyncPassphrase("short"), /at least 8/);
assert.equal(hasBackupSyncPassphrase(), false);
const passphrase = "correct horse battery staple";
setBackupSyncPassphrase(passphrase);
assert.equal(hasBackupSyncPassphrase(), true);

// A run writes one decryptable snapshot whose manifest carries the sync state
// file itself (backup-sync.json travels in backups via the CAVE_FILES allowlist).
const first = await runBackupSync("manual");
assert.equal(first.lastError, null);
assert.equal(first.lastReason, "manual");
assert.ok(first.lastSuccessAt, "success timestamp is recorded");
assert.ok((first.lastBytes ?? 0) > 0, "snapshot size is recorded");
const afterFirst = (await readdir(destination)).filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX));
assert.equal(afterFirst.length, 1, "one snapshot lands in the destination");
const snapshotBytes = await readFile(path.join(destination, afterFirst[0]));
const decrypted = await decryptBackupArchive(snapshotBytes, passphrase);
assert.ok(
  decrypted.manifest.entries.some((entry) => entry.root === "cave" && entry.path === "backup-sync.json"),
  "sync config travels inside the snapshot",
);
assert.ok(
  decrypted.manifest.entries.some((entry) => entry.root === "cave" && entry.path === "config.json"),
  "cave state travels inside the snapshot",
);

// Retention prunes oldest-first down to retainCount.
await writeFile(path.join(destination, `${BACKUP_FILE_PREFIX}2001-01-01T00-00-00-000Z${BACKUP_FILE_SUFFIX}`), "old-1");
await writeFile(path.join(destination, `${BACKUP_FILE_PREFIX}2002-01-01T00-00-00-000Z${BACKUP_FILE_SUFFIX}`), "old-2");
await writeFile(path.join(destination, "unrelated.txt"), "not a snapshot");
const second = await runBackupSync("manual");
assert.equal(second.lastError, null);
assert.equal(second.retainedCount, 2, "retention reports the kept count");
const afterSecond = (await readdir(destination)).filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX)).sort();
assert.equal(afterSecond.length, 2, "retention prunes down to retainCount");
assert.equal(afterSecond.includes(`${BACKUP_FILE_PREFIX}2001-01-01T00-00-00-000Z${BACKUP_FILE_SUFFIX}`), false, "oldest snapshot is pruned");
assert.equal(afterSecond.includes(`${BACKUP_FILE_PREFIX}2002-01-01T00-00-00-000Z${BACKUP_FILE_SUFFIX}`), false, "second-oldest snapshot is pruned");
assert.ok((await readdir(destination)).includes("unrelated.txt"), "non-snapshot files in the destination are untouched");

// Concurrent callers share one in-flight run — no double snapshot.
const before = (await readdir(destination)).filter((name) => name.startsWith(BACKUP_FILE_PREFIX)).sort();
const [a, b] = await Promise.all([runBackupSync("manual"), runBackupSync("scheduled")]);
assert.deepEqual(a, b, "concurrent runs resolve to the same status");
const after = (await readdir(destination)).filter((name) => name.startsWith(BACKUP_FILE_PREFIX)).sort();
assert.equal(after.length, before.length, "concurrent callers produce a single new snapshot generation");

// Overview: freshness for Settings, never the passphrase.
const overview = await getBackupSyncOverview();
assert.equal(overview.passphraseSet, true);
assert.equal(overview.effectiveDirectory, destination);
assert.equal(overview.due, false, "a just-pushed snapshot is not due");
assert.ok(overview.status.lastSuccessAt, "overview exposes freshness");
assert.equal(JSON.stringify(overview).includes(passphrase), false, "overview never leaks the passphrase");

// Status survives a reload from disk.
const persisted = await loadBackupSyncStatus();
assert.equal(persisted.lastSuccessAt, (await getBackupSyncOverview()).status.lastSuccessAt);

clearBackupSyncPassphrase();
assert.equal(hasBackupSyncPassphrase(), false);

await rm(root, { recursive: true, force: true });
console.log("backup-sync.test.ts: ok");
