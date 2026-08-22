// cave-ioswipe.6 (iOS half): deleting ONE message must reach the server, not
// only the in-memory thread and its snapshot file. The server half landed as
// DELETE /api/chat/conversation/{id}/turns/{turnId}; until this, iOS still
// spliced its own array and told nobody, so a deleted message came back on
// reinstall and never disappeared on any other client.
//
// The sibling ios-thread-server-persistence.test.mjs covers whole-thread
// archive/pin/delete. This covers the per-message delete only.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate. Each assertion is checked to FAIL against its regression, not merely
// to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const view = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");

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

// -- Client ---------------------------------------------------------------
const del = blockAfter(client, "func deleteConversationTurn(sessionId: String, turnId: String) async throws -> Bool {");
assert.ok(del, "deleteConversationTurn must exist");
assert.match(
  del,
  /request\("api\/chat\/conversation\/\\\(session\)\/turns\/\\\(turn\)", method: "DELETE"\)/,
  "the per-turn route must be addressed, not a PUT of the whole transcript — " +
    "re-PUTing the list erases any reply that streamed in while the user was deciding",
);
assert.match(
  del,
  /retryingIdempotentMutation: true/,
  "the delete is idempotent server-side and must retry, or a dropped response reads as failure",
);
assert.match(
  del,
  /Self\.checkDelete\(resp\)/,
  "a 404 means the message is already not there — that is not a failure to report",
);
for (const [value, subject] of [
  ["sessionId", "chat identifier"],
  ["turnId", "message identifier"],
]) {
  assert.match(
    del,
    new RegExp(`Self\\.encodedPathSegment\\(${value}, describing: "${subject}"\\)`),
    `${value} must be percent-encoded before it becomes a path segment`,
  );
}

// -- The message carries the server's id ----------------------------------
// Without this the client has nothing to name in the route, and every delete
// silently degrades to the local splice this bead exists to remove.
assert.match(
  thread,
  /\/\/\/ Optional so snapshots written before durable message delete decode\.\n\s*var serverTurnId: String\?/,
  "DisplayMessage must carry the server turn id, optional so old snapshots decode",
);
const restored = blockAfter(thread, "static func restored(from turn: ChatTurn, familiarId: String?) -> DisplayMessage {");
assert.ok(restored, "DisplayMessage.restored must exist");
assert.match(
  restored,
  /DisplayMessage\(\s*\n\s*serverTurnId: turn\.id,/,
  "a restored message must adopt the server's turn id",
);
// `id` is minted on compose and persisted; overwriting it on restore would
// rewrite message identity on every open.
assert.doesNotMatch(
  restored,
  /\bid: turn\.id\b/,
  "the local message id must not be replaced by the server's — it is the persisted identity",
);
const duplicate = blockAfter(thread, "static func duplicate(of message: DisplayMessage) -> DisplayMessage {");
assert.ok(duplicate, "DisplayMessage.duplicate must exist");
assert.doesNotMatch(
  duplicate,
  /serverTurnId/,
  "a duplicated message is a NEW turn — carrying the source's server id would delete the original",
);

// -- Delete ---------------------------------------------------------------
const body = blockAfter(thread, "func deleteMessage(_ messageId: String, client: CaveClient?,");
assert.ok(body, "deleteMessage must take a client");
assert.match(
  body,
  /let target = serverDeleteTarget\(for: removed, at: index\)[\s\S]*?messages\.remove\(at: index\)/,
  "the server target must be resolved BEFORE the removal — removing first shifts every " +
    "later message onto the wrong turn",
);
assert.match(
  body,
  /guard client != nil \|\| target == nil else \{[\s\S]*?appendSystem\([\s\S]*?isError: true\)[\s\S]*?return\n\s*\}/,
  "with no client and a message the server owns, the delete must be refused out loud — " +
    "removing it here is the original bug reached by a different door",
);
assert.match(
  body,
  /messages\.remove\(at: index\)\n\s*updatedAt = Date\(\)\n\s*onChange\(\)/,
  "the removal must be optimistic — a delete that waits on the tailnet reads as a broken swipe",
);
assert.match(
  body,
  /Task \{ \[weak self\] in\s*\n\s*await self\?\.persistDelete\(of: removed, at: index, target: target,/,
  "the removal must be followed by a durable delete",
);

const target = blockAfter(thread, "private func serverDeleteTarget(for message: DisplayMessage,");
assert.ok(target, "serverDeleteTarget must exist");
assert.match(
  target,
  /guard !isGroup, !message\.isQueued, message\.role != \.system,/,
  "a group turn, a queued send and inline slash output have no server turn to remove",
);
assert.match(
  target,
  /let sessionId = sessionIds\[familiarId\], !sessionId\.isEmpty else \{ return nil \}/,
  "a thread with no server session must not attempt a server call",
);
assert.match(
  target,
  /messages\[\.\.<index\]\.filter \{ Self\.occupiesServerTurn\(\$0\) \}\.count/,
  "the ordinal must skip messages the server never receives, or it names the wrong turn",
);

const persist = blockAfter(thread, "private func persistDelete(of message: DisplayMessage, at index: Int,");
assert.ok(persist, "persistDelete must exist");
assert.match(
  persist,
  /guard let convo = try\? await client\.conversation\(sessionId: target\.sessionId\) else \{\s*\n\s*rollBack\(/,
  "a message composed this session has no server id yet; a FAILED read is a real failure " +
    "and must roll back rather than pass as 'the server does not have it'",
);
assert.match(
  persist,
  /turnId = Self\.turnId\(matching: message, at: target\.ordinal, in: convo\.turns\)/,
  "the turn must be named from the server's own transcript",
);
assert.match(
  persist,
  /catch \{\s*\n\s*rollBack\(message, to: index, reason: error\.localizedDescription, onChange: onChange\)/,
  "a refused delete must roll back AND say why",
);

const matcher = blockAfter(thread, "nonisolated private static func turnId(matching message: DisplayMessage, at ordinal: Int,");
assert.ok(matcher, "turnId(matching:at:in:) must exist");
assert.match(
  matcher,
  /guard turn\.role == message\.role\.rawValue, turn\.text == message\.text else \{ return nil \}/,
  "position alone would delete a stranger's turn once the transcripts drift — " +
    "role and text must agree too",
);

const rollBack = blockAfter(thread, "private func rollBack(_ message: DisplayMessage, to index: Int, reason: String,");
assert.ok(rollBack, "rollBack must exist");
assert.match(
  rollBack,
  /messages\.insert\(message, at: min\(max\(index, 0\), messages\.count\)\)/,
  "a rolled-back message must return to where it left from, clamped — the transcript can " +
    "have moved while the request was in flight",
);
assert.match(
  rollBack,
  /appendSystem\([\s\S]*?isError: true\)/,
  "a failed delete must be visible; a silent local-only delete is the bug being fixed",
);

// -- The view hands the client through --------------------------------------
assert.match(
  view,
  /thread\.deleteMessage\(message\.id, client: app\.client\) \{ app\.touch\(thread\) \}/,
  "the swipe action must go through the server-backed path, not the old local splice",
);

console.log("ios-message-delete-persistence: ok");
