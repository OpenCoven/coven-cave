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
// ...but ONLY when the 404 came from this route. A desktop too old to have
// shipped it 404s the same way, and swallowing that hands back the silent
// local-only delete the route exists to end.
assert.match(
  del,
  /statusCode == 404, decoded\?\.ok == nil \{[\s\S]*?throw CaveError\.transport\(/,
  "a 404 that is not this route's own JSON envelope must be reported, not swallowed — " +
    "otherwise an older desktop reads as 'already deleted'",
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
// The other place the server hands a turn id to a message: replay adopts a
// reply that landed while the transport was down. Without the id that reply is
// server-owned but unnamed, and a later delete has to guess at it by position.
const adopt = blockAfter(thread, "private func adoptServerTurnIfPresent(prompt: String, familiarId: String,");
assert.ok(adopt, "adoptServerTurnIfPresent must exist");
assert.match(
  adopt,
  /DisplayMessage\(serverTurnId: reply\.id,/,
  "an adopted reply must carry the server's turn id — the server just named it",
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
  /guard !isGroup, !message\.isQueued,/,
  "a group turn and a queued send have no server turn to remove",
);
// Inline slash output is local-only, but the server persists chain-less
// `system` turns of its own and hands them back on a restore. Refusing every
// system message leaves those deletable only by the local splice being fixed.
assert.match(
  target,
  /message\.role != \.system \|\| message\.serverTurnId != nil,/,
  "a system turn the SERVER named is a real turn and must delete like one; only " +
    "inline slash output (never named) stays local",
);
assert.match(
  target,
  /let sessionId = sessionIds\[familiarId\], !sessionId\.isEmpty else \{ return nil \}/,
  "a thread with no server session must not attempt a server call",
);
assert.match(
  target,
  /let preceding = messages\[\.\.<index\]\.filter \{ Self\.occupiesServerTurn\(\$0\) \}/,
  "the ordinal must skip messages the server never receives, or it names the wrong turn",
);
assert.match(
  target,
  /preceding: preceding\)/,
  "the preceding messages must be carried, not just counted — the count alone cannot be " +
    "checked against the server's transcript",
);

const occupies = blockAfter(
  thread,
  "nonisolated private static func occupiesServerTurn(_ message: DisplayMessage) -> Bool {",
);
assert.ok(occupies, "occupiesServerTurn must exist");
assert.match(
  occupies,
  /if message\.serverTurnId != nil \{ return true \}/,
  "a message the server NAMED holds a position whatever its role — a restored system turn " +
    "sits in conversation.turns, and skipping it shifts every later ordinal one turn early",
);

const persist = blockAfter(thread, "private func persistDelete(of message: DisplayMessage, at index: Int,");
assert.ok(persist, "persistDelete must exist");
// `try?` collapses two different answers into one: the read THROWING is a real
// failure, while it returning no conversation is the server saying it holds no
// transcript — in which case the local removal was already the whole delete
// and rolling back would resurrect a message for no reason.
assert.match(
  persist,
  /do \{\s*\n\s*convo = try await client\.conversation\(sessionId: target\.sessionId\)\s*\n\s*\} catch \{\s*\n\s*rollBack\(/,
  "a FAILED read is a real failure and must roll back",
);
assert.match(
  persist,
  /guard let convo else \{ return \}/,
  "a read that succeeds with no conversation means the server does not have the message — " +
    "that must NOT be reported as a failure",
);
assert.match(
  persist,
  /turnId = Self\.turnId\(matching: message, following: target\.preceding,\s*\n\s*in: convo\.turns\)/,
  "the turn must be named from the server's own transcript, with the preceding messages " +
    "available to check the position against",
);
assert.match(
  persist,
  /try await client\.deleteConversationTurn\(sessionId: target\.sessionId, turnId: turnId\)/,
  "the named turn must actually be deleted on the server — the whole point of the bead",
);
assert.match(
  persist,
  /catch \{\s*\n\s*rollBack\(message, to: index, reason: error\.localizedDescription, onChange: onChange\)/,
  "a refused delete must roll back AND say why",
);

const matcher = blockAfter(thread, "nonisolated private static func turnId(matching message: DisplayMessage,");
assert.ok(matcher, "turnId(matching:following:in:) must exist");
// Position plus role-and-text AT that position is not enough. A reply that
// failed ambiguously leaves a local bubble with no server turn behind it, so
// the ordinal drifts — and a chat is full of repeated short turns, so the
// drifted position agrees on role and text often enough to delete a stranger's
// message. Every earlier position has to line up too.
assert.match(
  matcher,
  /guard ordinal < turns\.count, Self\.turn\(turns\[ordinal\], is: message\) else \{ return nil \}/,
  "the ordinal must land on a turn that IS this message",
);
assert.match(
  matcher,
  /for position in preceding\.indices where !Self\.turn\(turns\[position\], is: preceding\[position\]\) \{\s*\n\s*return nil\s*\n\s*\}/,
  "every position before the ordinal must agree with the server's transcript, or the " +
    "ordinal is arithmetic rather than evidence and deletes the wrong turn",
);

const sameTurn = blockAfter(
  thread,
  "nonisolated private static func turn(_ turn: ChatTurn, is message: DisplayMessage) -> Bool {",
);
assert.ok(sameTurn, "turn(_:is:) must exist");
assert.match(
  sameTurn,
  /if let serverTurnId = message\.serverTurnId \{ return turn\.id == serverTurnId \}/,
  "a message the server named is compared by id — the only comparison that cannot coincide",
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
