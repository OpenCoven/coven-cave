// Source pins for cave-2cpo — thread-snapshot write durability on iOS.
//
// PR #3456 shipped the debounced persistence but merged with both review
// threads unresolved, leaving two defects that are invisible to CI because
// apps/ios is not compiled by any required check:
//
//   1. flushThreads() spawned an UNTRACKED Task.detached, so a newer flush
//      could not supersede a stale in-flight write. ThreadSnapshotStore is an
//      actor — writes never interleave — but actors make no FIFO promise, so
//      the OLDER snapshot could resume last and overwrite newer state.
//   2. flushThreads() was documented and used as a SYNCHRONOUS lifecycle flush
//      from the scenePhase handler, but returned the instant the task was
//      spawned, so suspension could freeze the process before the bytes landed.
//
// These pin the contract rather than the implementation: a tracked write, a
// chained (ordered) write, an awaitable flush, and a lifecycle caller that
// actually waits while holding background time.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appModel = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/State/AppModel.swift"),
  "utf8",
);
const appEntry = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/CovenCaveApp.swift"),
  "utf8",
);
const store = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/State/ThreadSnapshotStore.swift"),
  "utf8",
);

// ── 1. The write is tracked, not fire-and-forget ─────────────────────────────
assert.match(
  appModel,
  /private var threadWriteTask: Task<Void, Never>\?/,
  "the in-flight snapshot write must be held so a newer flush can supersede it",
);
const flushBody = appModel.slice(
  appModel.indexOf("func flushThreads()"),
  appModel.indexOf("func flushThreadsAndWait()"),
);
assert.ok(flushBody.length > 0, "flushThreads and flushThreadsAndWait both exist");
assert.match(
  flushBody,
  /threadWriteTask = Task\.detached/,
  "the detached write must be assigned to threadWriteTask, not discarded",
);

// ── 2. Writes apply in call order ────────────────────────────────────────────
// Cancelling alone is not enough: save() only checks cancellation on entry, so
// a write that already started still lands. Awaiting the superseded task is
// what forces call-order.
assert.match(flushBody, /previous\?\.cancel\(\)/, "a superseded write is cancelled");
assert.match(
  flushBody,
  /_ = await previous\?\.value/,
  "the new write awaits the superseded one so the newest snapshot lands last",
);

// ── 3. Lifecycle durability is actually awaitable ────────────────────────────
assert.match(
  appModel,
  /func flushThreadsAndWait\(\) async \{[\s\S]*?_ = await threadWriteTask\?\.value/,
  "flushThreadsAndWait must await the write, not just spawn it",
);

// ── 4. The scene-phase caller waits, and holds background time ───────────────
// Awaiting without an assertion buys nothing — the process can still be
// suspended mid-write, which is the exact failure this bead describes.
const scenePhaseBlock = appEntry.slice(
  appEntry.indexOf("if phase != .active"),
  appEntry.indexOf("guard phase == .active"),
);
assert.ok(scenePhaseBlock.length > 0, "the leaving-foreground branch is present");
assert.match(
  scenePhaseBlock,
  /await app\.flushThreadsAndWait\(\)/,
  "leaving the foreground must AWAIT the flush",
);
assert.match(
  scenePhaseBlock,
  /beginBackgroundTask/,
  "the flush must hold a background-task assertion so the system grants time",
);
assert.match(
  scenePhaseBlock,
  /endBackgroundTask/,
  "the assertion must be released or the app is killed for over-holding it",
);
assert.ok(
  !/if phase != \.active \{ app\.flushThreads\(\) \}/.test(appEntry),
  "the old fire-and-forget lifecycle flush must not come back",
);

// ── 5. The store's own guarantees, which the above relies on ─────────────────
assert.match(store, /actor ThreadSnapshotStore/, "the store serializes writes as an actor");
assert.match(
  store,
  /func save\([\s\S]*?try Task\.checkCancellation\(\)/,
  "save() checks cancellation on entry so a superseded write can be dropped",
);

// ── 6. Wired into CI ─────────────────────────────────────────────────────────
const runner = fs.readFileSync(path.join(root, "scripts/run-tests.mjs"), "utf8");
assert.match(
  runner,
  /"scripts\/ios-thread-persist-durability\.test\.mjs"/,
  "this pin must run in CI — apps/ios is not compiled, so source pins are the only gate",
);

console.log("ios-thread-persist-durability: all pins hold");
