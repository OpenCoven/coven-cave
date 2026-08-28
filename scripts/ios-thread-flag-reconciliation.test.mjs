// cave-ioswipe.6 (iOS half, read side): server archived/pinned flags must come
// BACK onto local thread flags on load, not just leave the device. The write
// sides already fan archive/pin/delete out to every owned session
// (ios-thread-server-persistence.test.mjs); without this, a chat archived or
// pinned on the desktop never appears archived/pinned here after refresh or
// restart — the thread keeps its stale local flag forever.
//
// The trap this guards: `GET /api/sessions/list` EXCLUDES archived sessions,
// so the active-only fetch can never surface archive state at all. The read
// must be archived-inclusive, then `serverSessions` (which drives the active
// lists and project-context selection) must be re-filtered to active-only so
// archived rows don't leak into consumers that predate archived fetches.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the gate.
// Each assertion is checked to FAIL against its regression, not merely to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const models = await read("apps/ios/CovenCave/CovenCave/Models/Models.swift");

/** Extract a brace-balanced block starting at `marker` (which ends at its `{`). */
function blockAfter(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  const markerBrace = marker.lastIndexOf("{");
  const openingBrace = markerBrace >= 0
    ? start + markerBrace
    : src.indexOf("{", start + marker.length);
  if (openingBrace < 0) return null;
  let depth = 0;
  for (let i = openingBrace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// -- The session row carries the server's pin -------------------------------
// The write side PATCHes `pinned`; the read side must be able to decode it
// back, or a pinned-on-desktop thread can never show as pinned here.
assert.match(
  models,
  /var pinned: Bool\? = nil/,
  "SessionRow must decode the server's pinned flag",
);
assert.match(
  models,
  /case pinned\b/,
  "SessionRow's CodingKeys must include pinned",
);

// -- The read is archived-inclusive ------------------------------------------
// The active list excludes archived sessions (server-side), so archive state
// is invisible to it. Without an archived-inclusive read, reconciliation of
// the archived flag is impossible by construction.
const incl = blockAfter(client, "func sessionsIncludingArchived() async throws -> [SessionRow] {");
assert.ok(incl, "CaveClient must expose sessionsIncludingArchived()");
assert.match(
  incl,
  /sessions\(includeArchived: true\)/,
  "the archived-inclusive read must actually pass includeArchived=true",
);
assert.ok(
  client.includes('"?includeArchived=1"'),
  "the includeArchived parameter must reach the query string",
);

// The protocol seam gets a default so stubs implementing only sessions() keep
// compiling; the real client overrides it.
assert.match(
  model,
  /func sessionsIncludingArchived\(\) async throws -> \[SessionRow\]/,
  "ProjectContextLoadingClient must declare the archived-inclusive read",
);
assert.match(
  model,
  /func sessionsIncludingArchived\(\) async throws -> \[SessionRow\] \{ try await sessions\(\) \}/,
  "the protocol default must degrade to sessions() for stubs",
);

// -- The load uses the archived-inclusive read -------------------------------
const coord = blockAfter(model, "private func coordinatedSessionsLoad(");
assert.ok(coord, "coordinatedSessionsLoad must exist");
assert.match(
  coord,
  /try await client\.sessionsIncludingArchived\(\)/,
  "the sessions load must fetch the archived-inclusive list, or archive state is unreachable",
);

// -- serverSessions stays active-only for its existing consumers -------------
const apply = blockAfter(model, "private func applyLoadedSessions(");
assert.ok(apply, "applyLoadedSessions must exist");
assert.match(
  apply,
  /serverSessions = sessions\.filter \{ \$0\.archivedAt == nil \}/,
  "serverSessions must stay active-only even though the fetch is archived-inclusive — " +
    "consumers like projectServerSessions and selection predate archived fetches",
);
// ...and the project-context selection path filters too, so an archived
// unassigned session cannot tip a selection decision.
assert.match(
  model,
  /resolvedSessions = nextSessions\.filter \{ \$0\.archivedAt == nil \}/,
  "selection must not count archived sessions as unassigned artifacts",
);

// -- The reconciliation itself ----------------------------------------------
const reconcile = blockAfter(model, "private func reconcileThreadFlags(from sessions: [SessionRow]) -> Bool {");
assert.ok(reconcile, "reconcileThreadFlags(from:) must exist");
// A thread that owns no server session (never sent) is device-local; there is
// nothing server-side to reconcile against.
assert.match(
  reconcile,
  /let owned = serverSessionIds\(thread\)\s*\n\s*guard !owned\.isEmpty else \{ continue \}/,
  "threads with no owned session must be skipped",
);
// An in-flight optimistic flag write must not be clobbered by a list read that
// predates the write landing — the write's own rollback owns that outcome.
assert.match(
  reconcile,
  /if threadFlagWrites\[thread\.id\] != nil \{ continue \}/,
  "a thread with an in-flight flag write must be left alone",
);
// ...and the same protection must hold AFTER the write settles, for a list
// that was fetched before it landed: within the staleness window the server's
// answer may predate the local change, so a recent local write also wins.
assert.match(
  model,
  /lastThreadFlagWriteAt\[threadId\] = Date\(\)/,
  "a flag write must stamp the thread's last-write time",
);
assert.match(
  reconcile,
  /if let wroteAt = lastThreadFlagWriteAt\[thread\.id\],\s*\n\s*Date\(\)\.timeIntervalSince\(wroteAt\) < Self\.sessionsStaleAfter \{\s*\n\s*continue\s*\n\s*\}/,
  "reconciliation must skip a thread whose flag was written within the staleness window",
);
// A missing row (session sacrificed server-side) is not a signal: the thread
// keeps its local flags instead of guessing from an incomplete list.
assert.match(
  reconcile,
  /let rows = owned\.compactMap \{ rowsByID\[\$0\] \}\s*\n\s*guard rows\.count == owned\.count else \{ continue \}/,
  "reconciliation must require every owned session row to be present",
);
// Archived applies only when all owned sessions agree (the write side fans the
// SAME flag to every session, so a consistent server state has them agreeing).
assert.match(
  reconcile,
  /let archived = rows\.allSatisfy \{ \$0\.archivedAt != nil \}\s*\n\s*let unarchived = rows\.allSatisfy \{ \$0\.archivedAt == nil \}/,
  "archived must be applied only from unanimous server rows",
);
assert.match(
  reconcile,
  /if archived, !thread\.archived \{\s*\n\s*thread\.archived = true/,
  "server-archived must set the thread flag",
);
assert.match(
  reconcile,
  /else if unarchived, thread\.archived \{\s*\n\s*thread\.archived = false/,
  "server-unarchived must clear the thread flag",
);
// Pinned is the same contract with the decoded `pinned` field.
assert.match(
  reconcile,
  /let pinned = rows\.allSatisfy \{ \$0\.pinned == true \}\s*\n\s*let unpinned = rows\.allSatisfy \{ \$0\.pinned != true \}/,
  "pinned must be applied only from unanimous server rows",
);
assert.match(
  reconcile,
  /if pinned, !thread\.pinned \{\s*\n\s*thread\.pinned = true/,
  "server-pinned must set the thread flag",
);
assert.match(
  reconcile,
  /else if unpinned, thread\.pinned \{\s*\n\s*thread\.pinned = false/,
  "server-unpinned must clear the thread flag",
);
// A reconciled flag must be persisted, or it dies at the next launch — the
// exact failure mode this gate exists to end.
assert.match(
  reconcile,
  /if changed \{\s*\n\s*persistThreads\(\)/,
  "reconciliation must persist, or the corrected flags vanish on restart",
);
assert.match(
  reconcile,
  /return changed\s*\n\s*\}/,
  "reconcileThreadFlags must report whether anything changed",
);

console.log("ios-thread-flag-reconciliation: ok");
