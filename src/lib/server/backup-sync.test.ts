import assert from "node:assert/strict";
import test from "node:test";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

const statePath = path.join(home, "cave", "backup-sync.json");
const validState = await readFile(statePath, "utf8");
const invalidStateMessage = /invalid.*restore.*backup-sync\.json/i;
const rejectedStates = [
  { name: "malformed JSON", bytes: "{not-json\n", message: invalidStateMessage },
  { name: "null root", bytes: "null\n", message: invalidStateMessage },
  { name: "array root", bytes: "[]\n", message: invalidStateMessage },
  { name: "missing version", bytes: '{"config":{},"status":{}}', message: invalidStateMessage },
  { name: "invalid version", bytes: '{"version":0,"config":{},"status":{}}', message: invalidStateMessage },
  { name: "string version", bytes: '{"version":"1","config":{},"status":{}}', message: invalidStateMessage },
  { name: "invalid config", bytes: '{"version":1,"config":[],"status":{}}', message: invalidStateMessage },
  { name: "invalid status", bytes: '{"version":1,"config":{},"status":null}', message: invalidStateMessage },
  { name: "newer version", bytes: JSON.stringify({ ...JSON.parse(validState), version: 2, futureField: "preserve me" }), message: /newer.*update Cave/i },
];

for (const fixture of rejectedStates) {
  await test(`rejected backup state preserves ${fixture.name} on reads, writes and backup runs`, async () => {
    await writeFile(statePath, fixture.bytes);
    const snapshots = await readdir(destination);
    try {
      for (const read of [loadBackupSyncConfig, loadBackupSyncStatus, getBackupSyncOverview]) {
        await assert.rejects(read(), fixture.message);
      }
      await assert.rejects(updateBackupSyncConfig({ retainCount: 3 }), fixture.message);
      for (const reason of ["manual", "scheduled", "quit"] as const) {
        await assert.rejects(runBackupSync(reason), fixture.message);
      }
      assert.equal(await readFile(statePath, "utf8"), fixture.bytes);
      assert.deepEqual(await readdir(destination), snapshots, "rejected state cannot write or prune snapshots");
      assert.equal(await readFile(path.join(destination, "unrelated.txt"), "utf8"), "not a snapshot");
    } finally {
      await writeFile(statePath, validState);
    }
  });
}

await test("an unreadable backup state is not replaced with defaults", async () => {
  const savedPath = `${statePath}.original`;
  await rename(statePath, savedPath);
  await mkdir(statePath);
  try {
    await assert.rejects(loadBackupSyncConfig(), /read.*backup-sync\.json.*access/i);
    await assert.rejects(updateBackupSyncConfig({ enabled: false }), /read.*backup-sync\.json.*access/i);
    await assert.rejects(runBackupSync("manual"), /read.*backup-sync\.json.*access/i);
    assert.ok((await stat(statePath)).isDirectory(), "the unreadable path remains untouched");
    assert.equal(await readFile(savedPath, "utf8"), validState);
  } finally {
    await rm(statePath, { recursive: true });
    await rename(savedPath, statePath);
  }
});

await test("backup API refuses rejected state before saving or clearing the passphrase", async () => {
  const { GET, PUT } = await import("../../app/api/backup/sync/route.ts");
  const { POST } = await import("../../app/api/backup/sync/run/route.ts");
  const { getLocalEncryptedSecret } = await import("../local-encrypted-vault.ts");
  const invalid = "{invalid backup configuration\n";
  await writeFile(statePath, invalid);
  const request = (method: string, body?: object) => new Request("http://localhost/api/backup/sync", {
    method,
    headers: { host: "localhost", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    const read = await GET(request("GET"));
    assert.equal(read.status, 500);
    assert.match((await read.json()).error, invalidStateMessage);
    for (const patch of [{ passphrase: "replacement synthetic passphrase" }, { clearPassphrase: true }, { retainCount: 3, clearPassphrase: true }]) {
      const response = await PUT(request("PUT", patch));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, invalidStateMessage);
      assert.equal(getLocalEncryptedSecret("BACKUP_SYNC_PASSPHRASE"), passphrase);
      assert.equal(await readFile(statePath, "utf8"), invalid);
    }
    const run = await POST(request("POST"));
    assert.equal(run.status, 400);
    assert.match((await run.json()).error, invalidStateMessage);
    assert.equal(await readFile(statePath, "utf8"), invalid);
  } finally {
    await writeFile(statePath, validState);
    setBackupSyncPassphrase(passphrase);
  }
});

await test("a status write preserves state replaced after a snapshot was written", async (t) => {
  const newerState = JSON.stringify({ ...JSON.parse(validState), version: 2, futureField: "preserve after archive" });
  const originalStat = fsPromises.stat;
  let writtenSnapshot: string | null = null;
  // Interpose at the real archive's post-write stat, then let the real status
  // writer read a changed file. Archive creation and filesystem IO stay real.
  const hook = t.mock.method(fsPromises, "stat", async (...args: Parameters<typeof fsPromises.stat>) => {
    const result = await Reflect.apply(originalStat, fsPromises, args);
    const target = args[0];
    if (typeof target === "string" && target.startsWith(destination + path.sep) && target.endsWith(BACKUP_FILE_SUFFIX)) {
      writtenSnapshot = target;
      await writeFile(statePath, newerState);
    }
    return result;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(runBackupSync("manual"), /newer.*update Cave/i);
    assert.ok(writtenSnapshot, "the accepted archive was written before the state changed");
    assert.equal(await readFile(statePath, "utf8"), newerState);
    const saved = await decryptBackupArchive(await readFile(writtenSnapshot), passphrase);
    assert.ok(saved.manifest.entries.some((entry) => entry.path === "backup-sync.json"));
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
    await writeFile(statePath, validState);
  }
});

clearBackupSyncPassphrase();
assert.equal(hasBackupSyncPassphrase(), false);

await rm(root, { recursive: true, force: true });
console.log("backup-sync.test.ts: ok");
