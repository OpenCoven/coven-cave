import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  setAtomicWriteTestHooksForTest,
  writeFileAtomic,
  writeJsonAtomic,
} from "./atomic-write.ts";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const dir = await mkdtemp(path.join(testTmpRoot, "atomic-write-"));
const target = path.join(dir, "data.json");
const tmps = async () => (await readdir(dir)).filter((f) => f.endsWith(".tmp"));

// 1. The durable protocol must write + sync the unique temp before rename,
// then sync the parent directory after the renamed entry exists.
const ordering: string[] = [];
setAtomicWriteTestHooksForTest({
  afterTempWrite: () => { ordering.push("write-temp"); },
  afterTempSync: () => { ordering.push("sync-temp"); },
  beforeRename: () => { ordering.push("before-rename"); },
  afterRename: () => { ordering.push("after-rename"); },
  beforeDirectorySync: () => { ordering.push("sync-directory"); },
  afterDirectorySync: () => { ordering.push("synced-directory"); },
});
await writeFileAtomic(target, "hello");
assert.equal(await readFile(target, "utf8"), "hello", "first write lands");
assert.deepEqual(ordering, [
  "write-temp",
  "sync-temp",
  "before-rename",
  "after-rename",
  "sync-directory",
  "synced-directory",
], "temp contents must be synced before rename and the parent directory after it");
setAtomicWriteTestHooksForTest(null);

// 2. Replaces contents; leaves no temp files behind.
await writeJsonAtomic(target, { a: 1 });
assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { a: 1 }, "second write replaces");
assert.deepEqual(await tmps(), [], "no .tmp lingers after a write");

// Binary payloads use the same atomic path without string coercion.
const binaryTarget = path.join(dir, "image.bin");
const binary = Uint8Array.from([0x00, 0x89, 0xff, 0x7f]);
await writeFileAtomic(binaryTarget, binary);
assert.deepEqual(await readFile(binaryTarget), Buffer.from(binary), "binary bytes round-trip exactly");
assert.deepEqual(await tmps(), [], "no .tmp lingers after a binary write");

// 3. An injected pre-sync failure never reaches rename and removes the temp.
const beforeSyncFailure = new Error("injected temp sync failure");
setAtomicWriteTestHooksForTest({
  beforeTempSync: () => {
    throw beforeSyncFailure;
  },
});
await assert.rejects(() => writeFileAtomic(target, "must-not-replace"), beforeSyncFailure);
assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { a: 1 }, "a temp-sync failure preserves the old target");
assert.deepEqual(await tmps(), [], "a temp-sync failure leaves no temp behind");

// Rename is likewise never reached when a pre-rename fault fires.
const beforeRenameFailure = new Error("injected rename failure");
setAtomicWriteTestHooksForTest({
  beforeRename: () => {
    throw beforeRenameFailure;
  },
});
await assert.rejects(() => writeFileAtomic(target, "must-not-replace"), beforeRenameFailure);
assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { a: 1 }, "a rename failure preserves the old target");
assert.deepEqual(await tmps(), [], "a rename failure leaves no temp behind");

// A directory-sync failure occurs after rename and must be surfaced rather
// than misreported as durable success. The new contents may already be
// visible, so callers must treat this as an unknown-durability outcome.
const directorySyncFailure = new Error("injected directory sync failure");
setAtomicWriteTestHooksForTest({
  beforeDirectorySync: () => {
    throw directorySyncFailure;
  },
});
await assert.rejects(() => writeFileAtomic(target, "renamed-but-not-confirmed"), directorySyncFailure);
assert.equal(await readFile(target, "utf8"), "renamed-but-not-confirmed");
assert.deepEqual(await tmps(), [], "a directory-sync failure leaves no temp behind");
setAtomicWriteTestHooksForTest(null);

// Windows cannot FlushFileBuffers a read-only directory handle. That narrow
// platform-specific fallback must not turn POSIX permission failures into
// false durability successes.
const windowsDirectorySyncAccessDenied = Object.assign(
  new Error("Windows FlushFileBuffers requires write access"),
  { code: "EACCES" },
);
setAtomicWriteTestHooksForTest({
  platform: "win32",
  syncDirectory: () => {
    throw windowsDirectorySyncAccessDenied;
  },
});
await writeFileAtomic(target, "windows-directory-sync-fallback");
assert.equal(
  await readFile(target, "utf8"),
  "windows-directory-sync-fallback",
  "the injected Windows directory sync limitation is a supported fallback",
);

const posixDirectorySyncAccessDenied = Object.assign(
  new Error("POSIX directory sync permission denied"),
  { code: "EACCES" },
);
setAtomicWriteTestHooksForTest({
  platform: "linux",
  syncDirectory: () => {
    throw posixDirectorySyncAccessDenied;
  },
});
await assert.rejects(
  () => writeFileAtomic(target, "posix-directory-sync-permission-denied"),
  posixDirectorySyncAccessDenied,
  "a genuine POSIX EACCES must propagate",
);
assert.equal(
  await readFile(target, "utf8"),
  "posix-directory-sync-permission-denied",
  "the rename may have happened even though its POSIX durability confirmation failed",
);
setAtomicWriteTestHooksForTest(null);

// 4. Concurrent writers all settle without ENOENT. A shared `.tmp` made the
//    second rename race to ENOENT and crash (#1516); unique temp names let each
//    writer rename its own file. Last writer wins; the file is never torn.
await Promise.all(Array.from({ length: 25 }, (_, i) => writeJsonAtomic(target, { i })));
const final = JSON.parse(await readFile(target, "utf8"));
assert.equal(typeof final.i, "number", "a complete JSON object survives concurrent writes");
assert.deepEqual(await tmps(), [], "no .tmp lingers after concurrent writes");

// 5. On failure (target directory missing) the error propagates and the temp
//    file does not leak.
await assert.rejects(() => writeFileAtomic(path.join(dir, "nope", "data.json"), "x"), "write into a missing dir rejects");
assert.deepEqual(await tmps(), [], "a failed write leaves no .tmp behind");

await rm(dir, { recursive: true, force: true });
console.log("atomic-write.test.ts: ok");
