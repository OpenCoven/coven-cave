// cave-sve2a (read side): server archived/pinned state must fold back onto
// local thread flags, or a change made on another client never appears on iOS.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate. Each assertion is checked to FAIL against its regression, not merely
// to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const models = await read("apps/ios/CovenCave/CovenCave/Models/Models.swift");

/** Extract a brace-balanced block starting at `marker` (which ends at its `{`). */
function blockAfter(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// -- The wire model must carry the server's pinned flag ---------------------
// Without decoding `pinned` the fold can never learn that another client
// pinned a session, and the read side stays one-way.
assert.match(
  models,
  /var pinned: Bool\? = nil/,
  "SessionRow must decode the server's optional pinned flag",
);
assert.match(
  models,
  /case pinned\n\s*case projectRoot/,
  "SessionRow CodingKeys must map pinned (the server omits it when unpinned)",
);

// -- The fetch must include archived rows -----------------------------------
// An active-only list hides exactly the rows an archived thread owns, so the
// fold would see "no server opinion" and leave the thread active forever.
assert.match(
  model,
  /try await client\.sessions\(includeArchived: true\)/,
  "loadSessions must fetch archived rows too",
);
assert.match(
  model,
  /func sessions\(includeArchived: Bool\) async throws -> \[SessionRow\]/,
  "the loading protocol must expose includeArchived",
);
assert.match(
  model,
  /func sessions\(includeArchived: Bool = false\) async throws -> \[SessionRow\] \{ \[\] \}/,
  "the loading protocol must expose includeArchived",
);

// -- The apply path must fold flags onto local threads ----------------------
const apply = blockAfter(model, "private func applyLoadedSessions(");
assert.ok(apply, "applyLoadedSessions must exist");
assert.match(
  apply,
  /serverSessions = sessions\.filter \{ \$0\.archivedAt == nil \}/,
  "serverSessions must stay the active-only view consumers already expect",
);
assert.match(
  apply,
  /reconcileServerFlagsOntoThreads\(from: sessions\)/,
  "every applied session list must fold server flags back onto local threads",
);

// -- Fold semantics ---------------------------------------------------------
const fold = blockAfter(model, "private func reconcileServerFlagsOntoThreads(");
assert.ok(fold, "reconcileServerFlagsOntoThreads must exist");

// ALL for archive: any live session keeps the thread visible.
assert.match(
  fold,
  /let serverArchived = rows\.allSatisfy \{ \$0\.archivedAt != nil \}/,
  "archive must fold with ALL semantics — one live session keeps the thread visible",
);
// ANY for pinned: a single pinned session pins the thread.
assert.match(
  fold,
  /let serverPinned = rows\.contains \{ \$0\.pinned == true \}/,
  "pin must fold with ANY semantics",
);

// Threads that own no session (never sent) have no server opinion.
assert.match(
  fold,
  /guard !ownedIDs\.isEmpty else \{ continue \}/,
  "threads owning no session must be left alone",
);
// Threads whose sessions have no row in THIS fetch have no server opinion.
assert.match(
  fold,
  /let rows = ownedIDs\.compactMap \{ sessionsByID\[\$0\] \}\n\s*guard !rows\.isEmpty else \{ continue \}/,
  "threads whose sessions are absent from this fetch must be left alone",
);

// Local-intent-wins: an optimistic flag change whose PATCH is still in flight
// must not be clobbered by a snapshot that may predate it.
assert.match(
  fold,
  /guard threadFlagWrites\[thread\.id\] == nil else \{ continue \}/,
  "a thread with an in-flight flag write must keep its optimistic local value",
);

// The fold must persist what it reconciles, or the fix dies with the install.
assert.match(
  fold,
  /if changed \{\n\s*persistThreads\(\)/,
  "a changed flag must be persisted",
);

console.log("ios-server-flag-reconcile.test.mjs: ok");
