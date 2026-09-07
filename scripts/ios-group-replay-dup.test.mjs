// cave-bm3qq: a group's offline replay must never produce a second assistant
// bubble for a server turn a familiar already owns.
//
// In a group, stream's offline path marks the SHARED user bubble queued = true
// when a leg proves provably-unsent — even when other familiars already
// succeeded. replayQueued then walks the queue and can call
// adoptServerTurnIfPresent for a familiar whose reply is already on screen,
// re-adopting the same server turn into a second bubble. After #4857 that
// familiar's per-session projection carries two replies for one server turn,
// the prefix walk that names later deletes disagrees, and every subsequent
// message delete in the thread is refused as ambiguous — permanently, because
// groups never reload. The delete refusal is the correct fail-safe; the
// duplicate bubble is the defect.
//
// The fix keeps the invariant "one server turn => one bubble" even when the
// completion marker lags the thread (a snapshot written between a sibling's
// success and its durable completed list, or a thread hydrated by a version
// that never recorded one). Three guards, all reading ownership from the
// THREAD rather than the marker: the offline path does not re-queue a leg
// whose reply already sits settled; replayQueued skips a target whose settled
// reply already exists (healing the marker in the same pass); and
// adoptServerTurnIfPresent refuses to write a turn the thread already owns.
//
// iOS Swift is NOT compiled by most of CI, so this source-text contract is the
// gate — the same convention as ios-offline-compose / ios-message-delete-
// persistence. Every source assertion below is checked to FAIL against its
// regression, not merely to pass; the behavioural simulation at the bottom
// demonstrates why the duplicate poisons the prefix walk.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");

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

// --- adoptServerTurnIfPresent refuses a turn the thread already owns ---------
// The reply is looked up by the exact run id, and the bubble is the one the
// caller asked to fill. Before writing, the thread itself is asked whether this
// familiar ALREADY has that server turn on screen. The completion marker can be
// stale, so ownership must be read from the messages, not from the marker.
const adopt = blockAfter(thread, "private func adoptServerTurnIfPresent(");
assert.ok(adopt, "adoptServerTurnIfPresent must exist");
assert.match(
  adopt,
  /if messages\.contains\(where: \{\s*\n\s*\$0\.id != messageId\s*\n\s*&& \$0\.role == \.assistant\s*\n\s*&& \$0\.familiarId == familiarId\s*\n\s*&& \$0\.serverTurnId == reply\.id\s*\n\s*\}\) \{\s*\n\s*if let shell = messages\.first\(where: \{ \$0\.id == messageId \}\),\s*\n\s*shell\.serverTurnId == nil, shell\.text\.isEmpty, !shell\.isError \{\s*\n\s*messages\.removeAll \{ \$0\.id == messageId \}\s*\n\s*\}\s*\n\s*return \.completed/,
  "adopt must refuse to write a server turn another bubble already owns, fold " +
    "away the empty shell it would have filled, and treat the leg as settled",
);
// The ordinary write still happens for a turn the thread does NOT own.
assert.match(
  adopt,
  /mutate\(messageId\) \{\s*\n\s*\$0\.serverTurnId = reply\.id/,
  "a genuinely new adoption must still write the reply and its server id",
);
// The ownership check must come before the write — otherwise the duplicate is
// written first and the check sees itself.
assert.ok(
  adopt.indexOf("if messages.contains(where: {") < adopt.indexOf("mutate(messageId) {"),
  "the ownership guard must run before the adoption write",
);

// --- replayQueued skips a target whose settled reply already exists ----------
// The completed marker can lag the thread, so replay also asks the thread: if
// the reply for this turn is already on screen with a server-named id (it was
// adopted from the transcript), do not re-adopt it. The marker is healed in the
// same pass so the next reconnect no longer even looks at the leg. Only a
// server-NAMED reply is skipped — a partial bubble a cancelled stream left
// behind has no server id and must still be reconciled on the next reconnect.
const replayStart = thread.indexOf("func replayQueued(client: CaveClient,");
const replayEnd = thread.indexOf("/// Remove one message", replayStart);
const replayImplementation = replayStart >= 0 && replayEnd > replayStart
  ? thread.slice(replayStart, replayEnd)
  : "";
assert.ok(replayImplementation.length > 0, "replayQueued must exist");
assert.match(
  replayImplementation,
  /if let settled = replayPlaceholder\(\s*\n\s*after: queuedId,\s*\n\s*familiarId: familiarId\s*\n\s*\), !settled\.streaming,\s*\n\s*settled\.serverTurnId != nil \{\s*\n\s*completed\.insert\(familiarId\)\s*\n\s*mutate\(queuedId\) \{\s*\n\s*\$0\.queuedCompletedFamiliarIds = completed\.sorted\(\)\s*\n\s*\}\s*\n\s*continue\s*\n\s*\}/,
  "replay must skip (and heal the completion marker for) a target whose settled " +
    "reply is already on screen — one bubble per server turn",
);
// The skip must come before any placeholder insertion or stream for that target.
const skipIndex = replayImplementation.indexOf("if let settled = replayPlaceholder(");
const placeholderInsert = replayImplementation.indexOf("messages.insert(placeholder, at: insertAt)");
assert.ok(
  skipIndex >= 0 && (placeholderInsert < 0 || skipIndex < placeholderInsert),
  "the settled-reply skip must run before a new placeholder is inserted",
);
// The skip is server-named replies only: a partial bubble a cancelled stream
// left behind has no server id and must still reconcile on the next reconnect,
// so the skip condition must not widen to "any non-empty text".
const skipBlock = replayImplementation.slice(
  skipIndex,
  replayImplementation.indexOf("let existingPlaceholder", skipIndex),
);
assert.doesNotMatch(
  skipBlock,
  /!settled\.text\.trimmingCharacters/,
  "the skip must be keyed on the server-named reply id, not on text presence — " +
    "a cancelled stream's partial bubble has text but still needs reconciliation",
);

// --- stream offline path: a settled leg is never re-queued -------------------
// The provably-unsent conversion removes the failing leg's placeholder and
// re-marks the SHARED user bubble queued so the next reconnect replays it. When
// the failing leg's reply already sits settled in the thread (a re-attempt of a
// leg that already produced its reply), re-queueing would hand the next replay
// a duplicate adoption target. The conversion must therefore be conditional on
// settledReplyExists — the thread, not the completion marker.
const offlineConversionStart = thread.indexOf(
  "if let userMessageId, !recovery.accepted, deliveryProvenUnsent",
);
assert.ok(offlineConversionStart >= 0, "the provably-unsent conversion must exist");
const offlineConversion = thread.slice(
  offlineConversionStart,
  thread.indexOf("} else {", offlineConversionStart),
);
assert.match(
  offlineConversion,
  /let alreadySettled = settledReplyExists\(\s*\n\s*after: userMessageId,\s*\n\s*familiarId: familiarId,\s*\n\s*excluding: messageId\s*\n\s*\)/,
  "the conversion must ask the thread whether this leg already settled",
);
assert.match(
  offlineConversion,
  /messages\.removeAll \{ \$0\.id == messageId \}\s*\n\s*if !alreadySettled \{\s*\n\s*mutate\(userMessageId\) \{\s*\n\s*\$0\.queued = true/,
  "the shared bubble is only re-marked queued for a leg that did NOT already settle",
);
assert.match(
  offlineConversion,
  /if !alreadySettled \{\s*\n\s*mutate\(userMessageId\) \{\s*\n\s*\$0\.queued = true[\s\S]*?\$0\.queuedAttemptedFamiliarIds = attemptedIds\.isEmpty\s*\n\s*\? nil\s*\n\s*: attemptedIds\.sorted\(\)\s*\n\s*\}[\s\S]*?\n\s*\}\s*\n\s*outcome = \.queued/,
  "a settled leg keeps its reply and its queue state; the rollback persistence " +
    "stays inside the not-already-settled branch, and the outcome is queued either way",
);
// One provably-unsent sibling must never infer completion from the completed
// marker — the guard reads the thread, not the marker (unchanged contract from
// ios-offline-compose).
assert.doesNotMatch(
  offlineConversion,
  /completedReplyFamiliarIds|queuedCompletedFamiliarIds/,
  "the offline conversion must not infer completion from the marker — only the thread",
);

// --- the helper: ownership read from the thread, bounded to this turn ---------
const helper = blockAfter(thread, "private func settledReplyExists(after userMessageId: String,");
assert.ok(helper, "settledReplyExists must exist");
assert.match(
  helper,
  /guard let userIndex = messages\.firstIndex\(where: \{ \$0\.id == userMessageId \}\),\s*\n\s*userIndex \+ 1 <= messages\.endIndex else \{ return false \}\s*\n\s*return messages\[\(userIndex \+ 1\)\.\.\.\]\.contains \{ candidate in/,
  "the helper walks only the messages AFTER the user turn, so an older turn's " +
    "reply can never be mistaken for this leg's success",
);
assert.match(
  helper,
  /guard candidate\.id != messageId,\s*\n\s*candidate\.role == \.assistant,\s*\n\s*candidate\.familiarId == familiarId,\s*\n\s*!candidate\.streaming else \{ return false \}/,
  "the helper counts only settled assistant replies of the same familiar, " +
    "never the bubble being filled right now",
);

// --- Behaviour: why the duplicate poisons the prefix walk --------------------
// Model the per-session projection (#4857) and the prefix walk used to name a
// delete. Session F's turn list is the sub-sequence of the thread F was sent:
// every user prompt plus F's own replies. With ONE reply per server turn the
// walk names later deletes; with a duplicate (two bubbles for one server turn)
// the walk disagrees at the duplicate and every later delete is refused.
const roleTextMatch = (serverTurn, message) =>
  serverTurn.role === message.role && serverTurn.text.trim() === message.text.trim();

function turnMatch(message, preceding, turns) {
  for (let position = 0; position < preceding.length; position += 1) {
    if (position >= turns.length) return "absent";
    if (!roleTextMatch(turns[position], preceding[position])) return "ambiguous";
  }
  const ordinal = preceding.length;
  if (ordinal >= turns.length) return "absent";
  return roleTextMatch(turns[ordinal], message) ? "named" : "ambiguous";
}

function project(threadMessages, familiarId) {
  return threadMessages.filter((m) => {
    if (m.role === "user") return true; // every prompt went to every familiar
    return m.role === "assistant" && m.familiarId === familiarId;
  });
}

// The server transcripts as they really are: one reply per familiar per turn.
const serverTurns = {
  A: [
    { role: "user", text: "hello" },
    { role: "assistant", text: "reply from A" },
    { role: "user", text: "second question" },
    { role: "assistant", text: "second reply from A" },
  ],
  B: [
    { role: "user", text: "hello" },
    { role: "assistant", text: "reply from B" },
    { role: "user", text: "second question" },
    { role: "assistant", text: "second reply from B" },
  ],
};

// Correct thread: exactly one bubble per server turn per familiar.
const correctThread = [
  { role: "user", text: "hello", id: "u1" },
  { role: "assistant", familiarId: "A", text: "reply from A", id: "a1" },
  { role: "assistant", familiarId: "B", text: "reply from B", id: "b1" },
  { role: "user", text: "second question", id: "u2" },
  { role: "assistant", familiarId: "A", text: "second reply from A", id: "a2" },
  { role: "assistant", familiarId: "B", text: "second reply from B", id: "b2" },
];

// The duplicate: A's first reply appears twice (the bug). A's projection then
// has two replies where the server has one, so the walk for the SECOND delete
// disagrees at the duplicate and refuses.
const duplicatedThread = [
  { role: "user", text: "hello", id: "u1" },
  { role: "assistant", familiarId: "A", text: "reply from A", id: "a1" },
  { role: "assistant", familiarId: "B", text: "reply from B", id: "b1" },
  { role: "assistant", familiarId: "A", text: "reply from A", id: "a1-dup" },
  { role: "user", text: "second question", id: "u2" },
  { role: "assistant", familiarId: "A", text: "second reply from A", id: "a2" },
  { role: "assistant", familiarId: "B", text: "second reply from B", id: "b2" },
];

// Deleting "second question" in session A: the preceding projection is every
// turn before it. With one reply per server turn the prefix agrees and the
// delete is named; with the duplicate the walk disagrees at the second copy.
for (const [label, threadMessages, expected] of [
  ["one reply per server turn", correctThread, "named"],
  ["duplicate bubble", duplicatedThread, "ambiguous"],
]) {
  const projection = project(threadMessages.slice(0, threadMessages.findIndex((m) => m.id === "u2")), "A");
  const result = turnMatch(
    { role: "user", text: "second question" },
    projection,
    serverTurns.A,
  );
  assert.equal(
    result,
    expected,
    `${label}: the prefix walk must ${expected === "named" ? "name the turn" : "refuse as ambiguous"}`,
  );
}
// The guard's whole point: no second bubble is ever created, so the walk stays
// consistent and later deletes keep working. The simulation above shows what a
// regression would break: the duplicated thread refuses EVERY later delete.
console.log("ios-group-replay-dup.test.mjs: ok");
