// cave-ioswipe.6 (iOS half): deleting ONE message must reach the server, not
// only the in-memory thread and its snapshot file. The server half landed as
// DELETE /api/chat/conversation/{id}/turns/{turnId}; until this, iOS still
// spliced its own array and told nobody, so a deleted message came back on
// reinstall and never disappeared on any other client.
//
// The sibling ios-thread-server-persistence.test.mjs covers whole-thread
// archive/pin/delete. This covers the per-message delete only.
//
// Round two covers GROUP threads, which the first round refused outright. A
// group is N independent server sessions behind one presented transcript, so
// one local user bubble is N server turns with N different ids. The refusal
// (`guard !isGroup`) was the remaining half of the same bug: a group message
// was removed locally and nowhere else. The assertions below are therefore in
// two families — that the merged local list is projected into one honest
// transcript per session before any position is trusted, and that a delete
// which lands in some sessions and not others is neither hidden nor undone.
//
// iOS Swift is NOT compiled by most of CI, so this source-text contract is the
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

// A retry re-streams into the SAME local bubble, but it is an ordinary send —
// `SendBody` has no branch or replace field — so the server appends a new turn
// pair and leaves the old assistant turn alone. Keeping the id would aim a
// later delete at a turn whose text this bubble no longer shows: the superseded
// turn would go and the reply on screen would stay.
const retry = blockAfter(thread, "func retry(_ messageId: String, client: CaveClient, onChange: @escaping () -> Void) {");
assert.ok(retry, "retry must exist");
assert.match(
  retry,
  /mutate\(messageId\) \{\s*\n\s*\$0\.serverTurnId = nil/,
  "a retried bubble must drop the server turn id along with the text it named",
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
  /Task \{ \[weak self\] in\s*\n\s*_ = await previous\?\.value\s*\n\s*await self\?\.persistDelete\(of: removed, at: index, target: target,/,
  "the removal must be followed by a durable delete, and one delete must wait for the " +
    "one before it — a second swipe lands inside the first request, and the conversation " +
    "read that names an unnamed message would still see the turn being removed, refuse, " +
    "and fail the second delete of a two-swipe cleanup for nothing but timing",
);
assert.match(
  body,
  /let previous = pendingServerDelete\s*\n\s*pendingServerDelete = Task \{/,
  "the serialization must be a chain the NEXT delete can await, not a fire-and-forget task",
);
// A group's partial-failure report names the chats the message survived in, and
// it is read by a person. The thread stores familiar ids; only the view knows
// the display names, so they have to be carried across.
assert.match(
  body,
  /await self\?\.persistDelete\(of: removed, at: index, target: target,\s*\n\s*client: client, familiarNames: familiarNames,/,
  "the display names must reach the partial-failure report",
);

const target = blockAfter(thread, "private func serverDeleteTarget(for message: DisplayMessage,");
assert.ok(target, "serverDeleteTarget must exist");
// The `!isGroup` refusal that used to open this guard WAS the remaining half of
// the bug: a group message was spliced out locally and the server never heard.
// It is gone, and it must not come back — a group is addressable one session at
// a time (see `sessionTurn` below), not un-addressable.
assert.doesNotMatch(
  target,
  /guard !isGroup/,
  "a group message must no longer be refused outright — that refusal IS the remaining bug",
);
assert.match(
  target,
  /guard !message\.isQueued,/,
  "a queued send has no server turn to remove",
);
// Inline slash output is local-only, but the server persists chain-less
// `system` turns of its own and hands them back on a restore. Refusing every
// system message leaves those deletable only by the local splice being fixed.
assert.match(
  target,
  /message\.role != \.system \|\| message\.serverTurnId != nil/,
  "a system turn the SERVER named is a real turn and must delete like one; only " +
    "inline slash output (never named) stays local",
);
assert.match(
  target,
  /holders\(of: message\)\.compactMap \{ familiarId in/,
  "every session that can hold the message needs its own entry — a group's user turn is N " +
    "server turns with N different ids, and deleting one of them leaves the rest",
);
assert.match(
  target,
  /let sessionId = sessionIds\[familiarId\], !sessionId\.isEmpty else \{ return nil \}/,
  "a familiar with no server session must not attempt a server call",
);
// The message and the messages before it must be projected into the SAME
// session. Projecting the message into one familiar's session while counting
// the ordinal in another's names a turn in a transcript nobody checked — and
// for a reply, whose holder is a single familiar, it silently drops the only
// session that had it and the delete never reaches the server at all.
assert.match(
  target,
  /guard let projected = Self\.sessionTurn\(message, in: familiarId, isGroup: group\) else \{/,
  "the message must be projected into the session whose ordinal is about to be counted, " +
    "not into some other familiar's",
);
assert.match(
  target,
  /let preceding = messages\[\.\.<index\]\.compactMap \{\s*\n\s*Self\.sessionTurn\(\$0, in: familiarId, isGroup: group\)\s*\n\s*\}/,
  "the ordinal must be counted in THIS session's projection — a flat filter over the merged " +
    "list counts every other familiar's reply and names a turn N-1 positions too far down",
);
assert.match(
  target,
  /preceding: preceding\)/,
  "the preceding messages must be carried, not just counted — the count alone cannot be " +
    "checked against the server's transcript",
);
assert.match(
  target,
  /return sessions\.isEmpty \? nil : ServerDeleteTarget\(sessions: sessions\)/,
  "no addressable session means the server holds nothing to remove, and the local removal " +
    "is already the whole delete",
);

// -- Which sessions hold a message, and how each one sees it ----------------
const holders = blockAfter(thread, "private func holders(of message: DisplayMessage) -> [String] {");
assert.ok(holders, "holders(of:) must exist");
assert.match(
  holders,
  /guard message\.role == \.assistant else \{ return familiarIds \}/,
  "`send` fans one prompt out to every familiar, so a user bubble is one turn in EVERY " +
    "session — deleting it in one of them leaves the copies the other familiars hold",
);
assert.match(
  holders,
  /if let familiarId = message\.familiarId \{ return \[familiarId\] \}/,
  "a reply lives only in the session that produced it; deleting it anywhere else removes a " +
    "different familiar's turn",
);
assert.match(
  holders,
  /return isGroup \? \[\] : familiarIds/,
  "an unattributed reply names no session in a group — picking one is exactly the arbitrary " +
    "`familiarIds.first` this projection replaces",
);

const sessionTurn = blockAfter(
  thread,
  "nonisolated private static func sessionTurn(_ message: DisplayMessage,",
);
assert.ok(sessionTurn, "sessionTurn(_:in:isGroup:) must exist");
assert.match(
  sessionTurn,
  /guard occupiesServerTurn\(message\) else \{ return nil \}/,
  "a message the server never receives holds no position in any session's turn list",
);
assert.match(
  sessionTurn,
  /if let owner = message\.familiarId \{ return owner == familiarId \? message : nil \}/,
  "another familiar's reply is not in this session's transcript — counted, each of the N-1 " +
    "replies one fan-out produces pushes every later position that many turns too far",
);
// The id is narrowed for the same reason the position is. In a direct chat the
// only session there is named the turn, so the id stands and the comparison
// stays the one that cannot coincide.
assert.match(
  sessionTurn,
  /guard isGroup else \{ return message \}\s*\n\s*var projected = message\s*\n\s*projected\.serverTurnId = nil/,
  "in a group, a fanned-out turn's id was handed over by ONE session — comparing it against " +
    "another session's transcript reports a disagreement that is only the wrong session's id, " +
    "while a direct chat must keep comparing by id",
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

// -- Resolve every session, THEN delete -------------------------------------
const persist = blockAfter(thread, "private func persistDelete(of message: DisplayMessage, at index: Int,");
assert.ok(persist, "persistDelete must exist");
assert.match(
  persist,
  /for session in target\.sessions \{\s*\n\s*switch await resolveTurn\(in: session, client: client\)/,
  "every session that can hold the message must be asked, not just the first one",
);
// The two phases are the whole defence against a half-done group delete. A
// group user turn is N deletes, and finding at the third session that the turn
// cannot be named would leave two sessions deleted and two not, over a message
// nothing can put back.
const resolveLoop = blockAfter(persist, "for session in target.sessions {");
assert.ok(resolveLoop, "the resolve loop must exist");
assert.doesNotMatch(
  resolveLoop,
  /deleteConversationTurn/,
  "no turn may be deleted from inside the resolve loop — a refusal at the third session would " +
    "leave the first two deleted with nothing able to put them back",
);
assert.ok(
  persist.indexOf("resolveTurn(in: session") < persist.indexOf("deleteConversationTurn"),
  "every turn must be named before any turn is deleted",
);
assert.match(
  persist,
  /case \.absent:[\s\S]*?continue/,
  "a session whose transcript agrees and ends before this message never received it — that is " +
    "not a reason to refuse the sessions that DO hold it",
);
assert.match(
  persist,
  /case \.unresolved\(let reason\):[\s\S]*?rollBack\(message, to: index, reason: reason, onChange: onChange\)\s*\n\s*return/,
  "a session whose turn cannot be named refuses the WHOLE delete, while nothing has been " +
    "deleted yet and refusing is free",
);
assert.match(
  persist,
  /try await client\.deleteConversationTurn\(sessionId: deletion\.sessionId,\s*\n\s*turnId: deletion\.turnId\)/,
  "the named turns must actually be deleted on the server — the whole point of the bead",
);

const deleteLoop = blockAfter(persist, "for deletion in deletions {");
assert.ok(deleteLoop, "the delete loop must exist");
assert.doesNotMatch(
  deleteLoop,
  /\breturn\b|\bbreak\b/,
  "one session refusing must not abandon the others — every session that still answers is one " +
    "fewer surviving copy, and the report wants the whole list",
);
assert.match(
  deleteLoop,
  /failures\.append\(\(deletion\.familiarId, error\.localizedDescription\)\)/,
  "a refusal must be recorded against the familiar whose chat still holds the message",
);

// Total failure and partial failure are different states and must stay so.
assert.match(
  persist,
  /if failures\.count == deletions\.count \{[\s\S]*?rollBack\(message, to: index, reason: firstFailure\.reason, onChange: onChange\)/,
  "nothing landed anywhere: the server is exactly as it was before the swipe, so the message " +
    "goes back and says why — the direct chat's behaviour, whatever the thread's shape",
);
assert.match(
  persist,
  /reportPartialDelete\(failures, familiarNames: familiarNames, onChange: onChange\)/,
  "a delete that landed in some sessions and not others must be reported, not swallowed",
);
assert.ok(
  persist.indexOf("if failures.count == deletions.count") < persist.indexOf("reportPartialDelete"),
  "the all-failed rollback must be decided first — a PARTIAL failure must not roll back, " +
    "because the turn really is gone from at least one session and nothing can undo that",
);

const resolve = blockAfter(thread, "private func resolveTurn(in session: ServerDeleteTarget.Session,");
assert.ok(resolve, "resolveTurn must exist");
assert.match(
  resolve,
  /if let known = session\.message\.serverTurnId, !known\.isEmpty \{ return \.named\(known\) \}/,
  "a turn this session already named needs no matching at all",
);
// `try?` collapses three different answers into one. The read THROWING is a
// real failure — except for the 404 that `GET /api/chat/conversation/{id}`
// returns when it holds no transcript at all, which is the server saying the
// message is not there. Returning no conversation says the same thing through
// the route's narrow `conversation: null` shape.
assert.match(
  resolve,
  /\} catch CaveError\.badResponse\(404\) \{\s*\n\s*return \.absent\s*\n\s*\} catch \{\s*\n\s*return \.unresolved\(/,
  "a 404 from the conversation read means the server holds no transcript for this chat — " +
    "reporting it as 'the desktop could not be reached' is a lie AND resurrects a message " +
    "no server copy will ever bring back",
);
assert.match(
  resolve,
  /do \{\s*\n\s*convo = try await client\.conversation\(sessionId: session\.sessionId\)/,
  "a FAILED read is a real failure and must refuse",
);
assert.doesNotMatch(
  resolve,
  /try\? await client\.conversation/,
  "`try?` collapses a failed read into 'the server does not have it'",
);
assert.match(
  resolve,
  /guard let convo else \{ return \.absent \}/,
  "a read that succeeds with no conversation means the server does not have the message — " +
    "that must NOT be reported as a failure",
);
assert.match(
  resolve,
  /switch Self\.turnMatch\(for: session\.message, following: session\.preceding,\s*\n\s*in: convo\.turns\)/,
  "the turn must be named from THIS session's own transcript, checked against THIS session's " +
    "projection of the local list",
);
// The three outcomes have to stay three. Collapsing `ambiguous` into `absent`
// is the silent local-only delete this whole bead exists to end: the bubble is
// gone here, the turn is alive there, and nobody is told.
assert.match(
  resolve,
  /case \.absent:\s*\n\s*return \.absent/,
  "a transcript that agrees and simply ends before this message proves that session never " +
    "received it — the local removal was already the whole delete there",
);
assert.match(
  resolve,
  /case \.ambiguous:[\s\S]*?return \.unresolved\(\s*\n?\s*isGroup/,
  "a transcript that DISAGREES says nothing about where this message is — keeping the " +
    "removal there is a silent local-only delete, which is the bug being fixed",
);
// "Refresh and try again" is only advice a DIRECT chat can act on. `reload`
// opens with `guard !isGroup`, so pull-to-refresh is a no-op for a group and
// the transcript can never re-acquire the server turn ids that would let the
// retry skip the matcher. Telling a group's user to refresh is sending them to
// pull at a list that cannot change.
assert.match(
  resolve,
  /\?\s*"the desktop's copy of this chat has changed and a group chat can't be refreshed to catch up"\s*\n\s*:\s*"the desktop's copy of this chat has changed; refresh and try again"\)/,
  "only a direct chat may be told to refresh — `reload` refuses groups, so that advice " +
    "cannot work there and the refusal must say something true instead",
);
assert.match(
  thread,
  /func reload\(client: CaveClient\) async throws \{\s*\n\s*guard !isGroup/,
  "the assertion above is only worth anything while `reload` really does refuse groups — " +
    "if that changes, the refusal copy should change with it",
);

// -- A partial group delete is stated, never undone and never hidden --------
const partial = blockAfter(
  thread,
  "private func reportPartialDelete(_ failures: [(familiarId: String, reason: String)],",
);
assert.ok(partial, "reportPartialDelete must exist");
assert.doesNotMatch(
  partial,
  /messages\.insert/,
  "a partial delete must NOT put the message back. The turn really is gone from at least one " +
    "session and the route has no undelete, so re-inserting asserts copies the server has " +
    "already destroyed — and those sessions' transcripts have moved, so the next swipe is " +
    "refused as `ambiguous` and the copies that DID survive become undeletable for good",
);
assert.match(
  partial,
  /appendSystem\([\s\S]*?isError: true\)/,
  "an unreported partial delete is the silent local-only delete this bead exists to end, " +
    "just with fewer sessions holding the evidence",
);
assert.match(
  partial,
  /familiarNames\[\$0\.familiarId\] \?\? \$0\.familiarId/,
  "the report must name the chats the message survived in, by display name where the view " +
    "knows one and by familiar id when it does not",
);
assert.match(
  partial,
  /onChange\(\)/,
  "the note is the ONLY record a partial delete leaves — unpersisted it is gone at the next " +
    "launch, which is the silent local-only delete again with an extra step",
);

const matcher = blockAfter(thread, "nonisolated private static func turnMatch(for message: DisplayMessage,");
assert.ok(matcher, "turnMatch(for:following:in:) must exist");
// Position plus role-and-text AT that position is not enough. A reply that
// failed ambiguously leaves a local bubble with no server turn behind it, so
// the ordinal drifts — and a chat is full of repeated short turns, so the
// drifted position agrees on role and text often enough to delete a stranger's
// message. Every earlier position has to line up too.
assert.match(
  matcher,
  /guard ordinal < turns\.count else \{ return \.absent \}\s*\n\s*guard Self\.turn\(turns\[ordinal\], is: message\) else \{ return \.ambiguous \}/,
  "the ordinal must land on a turn that IS this message; a turn that is not this message " +
    "is a disagreement, not proof the message is missing",
);
assert.match(
  matcher,
  /for position in preceding\.indices \{\s*\n\s*guard position < turns\.count else \{ return \.absent \}\s*\n\s*guard Self\.turn\(turns\[position\], is: preceding\[position\]\) else \{ return \.ambiguous \}/,
  "every position before the ordinal must agree with the server's transcript, or the " +
    "ordinal is arithmetic rather than evidence and deletes the wrong turn",
);
// The prefix walk has to come FIRST. Running off the end of a transcript that
// has agreed the whole way is the server being behind us; running off the end
// of one that never agreed proves nothing, and calling that `absent` is how a
// refusal turns back into a silent local-only delete.
assert.ok(
  matcher.indexOf("for position in preceding.indices") < matcher.indexOf("let ordinal = preceding.count"),
  "the prefix must be checked before the ordinal, so `absent` is only ever reached through " +
    "a transcript that agreed as far as it goes",
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
// `chat/send` persists the assistant turn as `text.trim()`; the stream that
// filled the local bubble appended every chunk as it arrived. Comparing raw
// makes a reply ending in a newline read as a disagreeing transcript, which
// refuses every later delete in the session.
assert.match(
  sameTurn,
  /turn\.text\.trimmingCharacters\(in: \.whitespacesAndNewlines\)\s*\n?\s*== message\.text\.trimmingCharacters\(in: \.whitespacesAndNewlines\)/,
  "text must be compared with the edges trimmed — the server trims what it persists and " +
    "the stream does not",
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

// -- The view hands the client (and the familiar names) through --------------
assert.match(
  view,
  /thread\.deleteMessage\(message\.id, client: app\.client,\s*\n\s*familiarNames: familiarNames\) \{ app\.touch\(thread\) \}/,
  "the swipe action must go through the server-backed path, not the old local splice",
);
assert.match(
  view,
  /uniquingKeysWith: \{ first, _ in first \}\)/,
  "`uniqueKeysWithValues:` traps on a repeated key — a duplicated familiar id in a thread must " +
    "not turn a swipe into a crash",
);

console.log("ios-message-delete-persistence: ok");
