// @ts-nocheck
import assert from "node:assert/strict";
import { onSendStart, onCreationSessionIdentified, onDoneCreationRefresh, onCreationRunTerminated, shouldReplacementRefreshOnDone } from "./chat-creation-refresh.ts";

const FRESH = { pendingRuns: {} };

// onSendStart ----------------------------------------------------------------

// New chat (no prior session) → creates a pending entry for the run
{
  const next = onSendStart(FRESH, "run-a", null);
  assert.deepEqual(next, { pendingRuns: { "run-a": { sessionId: null } } },
    "new-chat send with null sessionId creates a pending entry for the runId");
}

// Follow-up send on an existing session (no matching pending) → no-op
{
  const next = onSendStart(FRESH, "run-a", "sess-existing");
  assert.deepEqual(next, FRESH, "follow-up send with existing sessionId stays ineligible");
}

// Two overlapping sessionless sends each get their own entry
{
  let state = FRESH;
  state = onSendStart(state, "run-a", null);
  state = onSendStart(state, "run-b", null);
  assert.deepEqual(state, {
    pendingRuns: { "run-a": { sessionId: null }, "run-b": { sessionId: null } },
  }, "two sessionless sends create independent pending entries");
}

// Retry: initialSessionId matches a pending creation session → adds alias
{
  const bound = { pendingRuns: { "run-a": { sessionId: "sess-abc" } } };
  const next = onSendStart(bound, "run-b", "sess-abc");
  assert.deepEqual(next, {
    pendingRuns: { "run-a": { sessionId: "sess-abc" }, "run-b": { sessionId: "sess-abc", isAlias: true } },
  }, "retry with promoted sessionId adds an alias entry for the retry runId");
}

// Follow-up on an existing non-pending session (not in pendingRuns) → no-op
{
  const bound = { pendingRuns: { "run-a": { sessionId: "sess-abc" } } };
  const next = onSendStart(bound, "run-c", "sess-other");
  assert.deepEqual(next, bound, "follow-up on a non-pending session leaves state unchanged");
}

// onCreationSessionIdentified ------------------------------------------------

// Binds the pending entry to the server-assigned session ID (sessionless origin)
{
  const state = { pendingRuns: { "run-a": { sessionId: null } } };
  const next = onCreationSessionIdentified(state, "run-a", null, "sess-new");
  assert.deepEqual(next, { pendingRuns: { "run-a": { sessionId: "sess-new" } } },
    "onCreationSessionIdentified binds the creation session ID when pending, unbound, and origin is null");
}

// Idempotent: already bound — must not overwrite
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-original" } } };
  const next = onCreationSessionIdentified(state, "run-a", null, "sess-other");
  assert.deepEqual(next, state, "onCreationSessionIdentified is a no-op when already bound");
}

// No-op when runId not in pendingRuns (follow-up or unrelated generation)
{
  const next = onCreationSessionIdentified(FRESH, "run-a", null, "sess-any");
  assert.deepEqual(next, FRESH, "onCreationSessionIdentified is a no-op when runId not in pendingRuns");
}

// Provenance gate: non-null origin must NOT bind an unbound pending entry
{
  const state = { pendingRuns: { "run-a": { sessionId: null } } };
  const next = onCreationSessionIdentified(state, "run-a", "existing-1", "existing-1");
  assert.deepEqual(next, state,
    "onCreationSessionIdentified with non-null origin does not bind an unbound pending entry");
}

// Provenance gate: retry's non-null origin is a no-op on already-bound entry
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-abc" }, "run-b": { sessionId: "sess-abc" } } };
  const next = onCreationSessionIdentified(state, "run-b", "sess-abc", "sess-abc");
  assert.deepEqual(next, state,
    "onCreationSessionIdentified with non-null origin (retry) is a no-op on an already-bound entry");
}

// onDoneCreationRefresh — unbound (sessionId: null) --------------------------

// Unbound pending: binding required before done; no auto-refresh
{
  const state = { pendingRuns: { "run-a": { sessionId: null } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-abc", false);
  assert.equal(shouldRefresh, false, "unbound pending done does not auto-refresh — binding required before done");
  assert.deepEqual(nextState, state, "unbound pending done leaves state unchanged");
}

// Failed completion while unbound: no refresh, entry removed (cannot retry without session)
{
  const state = { pendingRuns: { "run-a": { sessionId: null } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-abc", true);
  assert.equal(shouldRefresh, false, "failed completion does not refresh");
  assert.deepEqual(nextState, FRESH, "failed completion while unbound removes entry (no session ID to retry with)");
}

// runId not in pendingRuns (follow-up done): no refresh
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(FRESH, "run-unknown", "sess-abc", false);
  assert.equal(shouldRefresh, false, "done for untracked runId does not creation-refresh");
  assert.deepEqual(nextState, FRESH, "done for untracked runId leaves state unchanged");
}

// Successful done with missing completedSessionId: no refresh even if eligible
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-abc" } } };
  const { shouldRefresh } = onDoneCreationRefresh(state, "run-a", null, false);
  assert.equal(shouldRefresh, false, "eligible done with null completedSessionId does not refresh");
}
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-abc" } } };
  const { shouldRefresh } = onDoneCreationRefresh(state, "run-a", undefined, false);
  assert.equal(shouldRefresh, false, "eligible done with undefined completedSessionId does not refresh");
}

// No double-refresh: once done successfully, the next done must not fire again
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-abc" } } };
  const first = onDoneCreationRefresh(state, "run-a", "sess-abc", false);
  const second = onDoneCreationRefresh(first.nextState, "run-a", "sess-abc", false);
  assert.equal(first.shouldRefresh, true, "first successful bound done refreshes");
  assert.equal(second.shouldRefresh, false, "second done does not refresh (entry removed)");
}

// onDoneCreationRefresh — bound (sessionId: "sess-new") ----------------------

// Successful done for the bound creation ID: refresh and remove entry
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-new" } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-new", false);
  assert.equal(shouldRefresh, true, "bound creation session success should refresh");
  assert.deepEqual(nextState, FRESH, "entry removed after bound creation session success");
}

// Failed done for the bound creation ID: preserve entry for retry
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-new" } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-new", true);
  assert.equal(shouldRefresh, false, "failed done on bound creation session does not refresh");
  assert.deepEqual(nextState, state, "failed done on bound creation session preserves entry");
}

// Mismatched session ID: must not refresh and must not consume the pending entry
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-new" } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-other", false);
  assert.equal(shouldRefresh, false, "mismatched completion does not consume the pending creation entry");
  assert.deepEqual(nextState, state, "mismatched completion leaves pending creation state untouched");
}

// Unrelated existing-session completion (runId not in pendingRuns): no effect
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-new" } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-unrelated", "sess-existing", false);
  assert.equal(shouldRefresh, false, "unrelated existing-session done does not consume the pending creation entry");
  assert.deepEqual(nextState, state, "unrelated existing-session done leaves pending creation state untouched");
}

// Duplicate completion: once entry removed, a second call for same runId is no-op
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-new" } } };
  const first = onDoneCreationRefresh(state, "run-a", "sess-new", false);
  const second = onDoneCreationRefresh(first.nextState, "run-a", "sess-new", false);
  assert.equal(first.shouldRefresh, true, "first successful done refreshes");
  assert.equal(second.shouldRefresh, false, "duplicate completion does not re-refresh after entry removed");
}

// Full retry scenario: new chat → session identified → failed done → retry → success
{
  let state = FRESH;

  // Initial send: no session id
  state = onSendStart(state, "run-a", null);
  assert.ok(state.pendingRuns["run-a"], "new-chat send creates pending entry for run-a");
  assert.equal(state.pendingRuns["run-a"].sessionId, null, "creation session ID starts unbound");

  // "session" event identifies the server-assigned ID (sessionless generation)
  state = onCreationSessionIdentified(state, "run-a", null, "sess-abc");
  assert.equal(state.pendingRuns["run-a"].sessionId, "sess-abc", "session identified binds the ID");

  // First done arrives as an error
  const failedResult = onDoneCreationRefresh(state, "run-a", "sess-abc", true);
  state = failedResult.nextState;
  assert.equal(failedResult.shouldRefresh, false, "failed first done does not refresh");
  assert.ok(state.pendingRuns["run-a"], "entry preserved after failure");
  assert.equal(state.pendingRuns["run-a"].sessionId, "sess-abc", "bound ID preserved after failure");

  // An existing session completes while we're waiting — must not consume state
  const existingResult = onDoneCreationRefresh(state, "run-other", "sess-other", false);
  assert.equal(existingResult.shouldRefresh, false, "existing-session done does not consume creation pending");
  assert.deepEqual(existingResult.nextState, state, "state unchanged after existing-session done");

  // Retry: initialSessionId is now "sess-abc" (promoted by "session" event)
  state = onSendStart(state, "run-b", "sess-abc");
  assert.ok(state.pendingRuns["run-b"], "retry adds alias entry for run-b");
  assert.equal(state.pendingRuns["run-b"].sessionId, "sess-abc", "retry alias has correct sessionId");

  // Retry's session event (non-null origin → no-op, already bound)
  state = onCreationSessionIdentified(state, "run-b", "sess-abc", "sess-abc");
  assert.equal(state.pendingRuns["run-b"].sessionId, "sess-abc", "retry session event is a no-op on already-bound entry");

  // Successful retry (run-b in pendingRuns, sessionId matches)
  const successResult = onDoneCreationRefresh(state, "run-b", "sess-abc", false);
  state = successResult.nextState;
  assert.equal(successResult.shouldRefresh, true, "successful retry fires the creation refresh");
  assert.deepEqual(state, FRESH, "all entries for sess-abc removed after successful retry");

  // Follow-up completion does not refresh
  const followupResult = onDoneCreationRefresh(state, "run-b", "sess-abc", false);
  assert.equal(followupResult.shouldRefresh, false, "follow-up completion after clear does not refresh");
}

// Two overlapping sessionless runs A and B: both bind independently, both refresh
{
  let state = FRESH;

  state = onSendStart(state, "run-a", null);
  state = onSendStart(state, "run-b", null);
  assert.ok(state.pendingRuns["run-a"], "[overlap] run-a pending entry created");
  assert.ok(state.pendingRuns["run-b"], "[overlap] run-b pending entry created");

  // A and B each get their own session ID
  state = onCreationSessionIdentified(state, "run-a", null, "sess-A");
  state = onCreationSessionIdentified(state, "run-b", null, "sess-B");
  assert.equal(state.pendingRuns["run-a"].sessionId, "sess-A", "[overlap] run-a bound to sess-A");
  assert.equal(state.pendingRuns["run-b"].sessionId, "sess-B", "[overlap] run-b bound to sess-B");

  // A completes first: should refresh, B entry intact
  const resultA = onDoneCreationRefresh(state, "run-a", "sess-A", false);
  assert.equal(resultA.shouldRefresh, true, "[overlap] run-a completion returns shouldRefresh true");
  state = resultA.nextState;
  assert.equal(state.pendingRuns["run-a"], undefined, "[overlap] run-a entry removed after A completes");
  assert.ok(state.pendingRuns["run-b"], "[overlap] run-b entry still present after A completes");

  // B completes: should also refresh
  const resultB = onDoneCreationRefresh(state, "run-b", "sess-B", false);
  assert.equal(resultB.shouldRefresh, true, "[overlap] run-b completion returns shouldRefresh true");
  assert.deepEqual(resultB.nextState, FRESH, "[overlap] all entries cleared after both complete");
}

// Cross-thread binding scenario: background generation binds via session event
// while user has switched to another thread; completion refreshes exactly once.
{
  let state = FRESH;

  state = onSendStart(state, "run-a", null);
  assert.ok(state.pendingRuns["run-a"], "new-chat send creates entry");

  // Session id arrives for the background generation
  state = onCreationSessionIdentified(state, "run-a", null, "creation-sess");
  assert.equal(state.pendingRuns["run-a"].sessionId, "creation-sess", "binding attaches the session ID");

  // The currently-displayed existing session completes — must NOT refresh
  const unrelated = onDoneCreationRefresh(state, "run-other", "other-existing-sess", false);
  assert.equal(unrelated.shouldRefresh, false, "unrelated session done does not consume the pending creation entry");
  assert.deepEqual(unrelated.nextState, state, "unrelated session done leaves state untouched");

  // The original background creation session completes — must refresh once
  const creation = onDoneCreationRefresh(state, "run-a", "creation-sess", false);
  assert.equal(creation.shouldRefresh, true, "background creation session done refreshes the sidebar");
  assert.deepEqual(creation.nextState, FRESH, "entry consumed after creation refresh");

  // Subsequent completion for the same run must not refresh again
  const again = onDoneCreationRefresh(creation.nextState, "run-a", "creation-sess", false);
  assert.equal(again.shouldRefresh, false, "second completion does not re-refresh after entry removed");
}

// Task 1 interleaving: unrelated existing generation fires identify/done
// BEFORE the background sessionless generation gets its ID.
// Ordering:
//   1. pending unbound entry for run-a from new send
//   2. unrelated existing generation (run-unrelated, origin "existing-1") fires identify/done → no bind, no refresh
//   3. background sessionless generation (run-a, origin null) identifies "created-1" → binds
//   4. run-a completes → refresh once
{
  let state = FRESH;

  state = onSendStart(state, "run-a", null);
  assert.ok(state.pendingRuns["run-a"], "[interleave] new-chat send creates entry for run-a");
  assert.equal(state.pendingRuns["run-a"].sessionId, null, "[interleave] entry starts unbound");

  // Unrelated existing generation fires its session event — no bind
  const afterExistingSession = onCreationSessionIdentified(state, "run-unrelated", "existing-1", "existing-1");
  assert.deepEqual(afterExistingSession, state,
    "[interleave] unrelated runId not in pendingRuns — session event is a no-op");

  // That same existing generation completes — no refresh
  const existingDone = onDoneCreationRefresh(state, "run-unrelated", "existing-1", false);
  assert.equal(existingDone.shouldRefresh, false,
    "[interleave] unrelated completion does not fire creation refresh");
  assert.deepEqual(existingDone.nextState, state,
    "[interleave] unrelated completion leaves creation state unchanged");

  // Background sessionless generation gets its session event → binds
  state = onCreationSessionIdentified(state, "run-a", null, "created-1");
  assert.equal(state.pendingRuns["run-a"].sessionId, "created-1",
    "[interleave] sessionless generation's session event binds to created-1");

  // Background creation generation completes → refresh fires exactly once
  const createdDone = onDoneCreationRefresh(state, "run-a", "created-1", false);
  assert.equal(createdDone.shouldRefresh, true,
    "[interleave] creation generation completion fires the sidebar refresh");
  assert.deepEqual(createdDone.nextState, FRESH,
    "[interleave] entry consumed after creation refresh");

  // No second refresh
  const createdDoneAgain = onDoneCreationRefresh(createdDone.nextState, "run-a", "created-1", false);
  assert.equal(createdDoneAgain.shouldRefresh, false,
    "[interleave] second completion after refresh does not re-fire");
}

// onCreationRunTerminated -------------------------------------------------------

// Unbound entry: removes the entry
{
  const state = { pendingRuns: { "run-a": { sessionId: null } } };
  const next = onCreationRunTerminated(state, "run-a");
  assert.deepEqual(next, FRESH, "onCreationRunTerminated removes an unbound pending entry");
}

// Bound entry: preserves the entry for same-ID retry
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-abc" } } };
  const next = onCreationRunTerminated(state, "run-a");
  assert.deepEqual(next, state, "onCreationRunTerminated preserves a bound pending entry");
}

// runId not in pendingRuns: no-op
{
  const next = onCreationRunTerminated(FRESH, "run-unknown");
  assert.deepEqual(next, FRESH, "onCreationRunTerminated is a no-op when runId not in pendingRuns");
}

// Overlapping runs: only the targeted unbound run is removed
{
  const state = {
    pendingRuns: {
      "run-a": { sessionId: null },
      "run-b": { sessionId: null },
      "run-c": { sessionId: "sess-xyz" },
    },
  };
  const next = onCreationRunTerminated(state, "run-a");
  assert.deepEqual(next, {
    pendingRuns: {
      "run-b": { sessionId: null },
      "run-c": { sessionId: "sess-xyz" },
    },
  }, "onCreationRunTerminated removes only the targeted unbound run, leaving others intact");
}

// Idempotent: calling twice on the same runId after removal is a no-op
{
  const state = { pendingRuns: { "run-a": { sessionId: null } } };
  const once = onCreationRunTerminated(state, "run-a");
  const twice = onCreationRunTerminated(once, "run-a");
  assert.deepEqual(twice, FRESH, "onCreationRunTerminated is idempotent");
}

// onDoneCreationRefresh — failed done unbound removes entry -----------------------

// Failed done while unbound: entry removed (consistent with onCreationRunTerminated)
{
  const state = { pendingRuns: { "run-a": { sessionId: null } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-new", true);
  assert.equal(shouldRefresh, false, "failed done while unbound does not refresh");
  assert.deepEqual(nextState, FRESH, "failed done while unbound removes the entry");
}

// Failed done while bound: entry preserved for retry
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-new" }, "run-b": { sessionId: "sess-new" } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-new", true);
  assert.equal(shouldRefresh, false, "failed done while bound does not refresh");
  assert.deepEqual(nextState, state, "failed done while bound preserves all entries (including aliases)");
}

// Overlapping runs: terminated unbound run does not affect other runs
{
  const state = {
    pendingRuns: {
      "run-a": { sessionId: null },
      "run-b": { sessionId: "sess-B" },
    },
  };
  const terminated = onCreationRunTerminated(state, "run-a");
  assert.deepEqual(terminated, { pendingRuns: { "run-b": { sessionId: "sess-B" } } },
    "terminating run-a does not affect run-b");
  // run-b still completes normally
  const { shouldRefresh, nextState } = onDoneCreationRefresh(terminated, "run-b", "sess-B", false);
  assert.equal(shouldRefresh, true, "run-b completion still refreshes after run-a was terminated");
  assert.deepEqual(nextState, FRESH, "all entries cleared after run-b completes");
}

// Repeated failed retries leave exactly one alias; other session unaffected
{
  let state = FRESH;

  // Original new chat + bind
  state = onSendStart(state, "run-a", null);
  state = onCreationSessionIdentified(state, "run-a", null, "sess-abc");

  // Independent session running alongside
  state = onSendStart(state, "run-x", null);
  state = onCreationSessionIdentified(state, "run-x", null, "sess-xyz");

  // First retry
  state = onSendStart(state, "run-b", "sess-abc");
  assert.ok(state.pendingRuns["run-b"]?.isAlias, "first retry is marked isAlias");
  assert.ok(state.pendingRuns["run-a"], "original run-a entry is preserved after first retry");

  // run-b (alias) terminates: alias is removed — a new retry will register a fresh alias via onSendStart
  const afterTerminated = onCreationRunTerminated(state, "run-b");
  assert.equal(afterTerminated.pendingRuns["run-b"], undefined, "terminated alias run-b is removed (alias entries do not persist for retry)");
  assert.ok(afterTerminated.pendingRuns["run-a"], "original creation entry run-a preserved after alias terminal");
  assert.ok(afterTerminated.pendingRuns["run-x"], "independent run-x unaffected by alias terminal");

  // Second retry: must prune run-b alias, leaving only run-a + new alias run-c
  state = onSendStart(afterTerminated, "run-c", "sess-abc");
  assert.equal(state.pendingRuns["run-b"], undefined, "prior alias run-b pruned when run-c retries");
  assert.ok(state.pendingRuns["run-a"], "original creation entry run-a preserved after run-c retry");
  assert.ok(state.pendingRuns["run-c"]?.isAlias, "run-c is marked isAlias");
  assert.ok(state.pendingRuns["run-x"], "independent session run-x unaffected by alias pruning");
  assert.equal(state.pendingRuns["run-x"].sessionId, "sess-xyz", "run-x session ID unchanged");

  // Exactly two entries for sess-abc: original + new alias
  const sessAbcEntries = Object.values(state.pendingRuns).filter((r) => r.sessionId === "sess-abc");
  assert.equal(sessAbcEntries.length, 2, "exactly two entries for sess-abc after second retry");

  // Successful completion clears both sess-abc entries but not sess-xyz
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-c", "sess-abc", false);
  assert.equal(shouldRefresh, true, "run-c success fires creation refresh");
  assert.equal(nextState.pendingRuns["run-a"], undefined, "run-a cleared on run-c success");
  assert.equal(nextState.pendingRuns["run-c"], undefined, "run-c cleared on success");
  assert.ok(nextState.pendingRuns["run-x"], "independent run-x unaffected by run-c success");
}

// Alias entry: removed on terminal (does not linger for retry; a new retry
// re-registers via onSendStart).
{
  const state = { pendingRuns: { "run-alias": { sessionId: "sess-abc", isAlias: true as const } } };
  const next = onCreationRunTerminated(state, "run-alias");
  assert.deepEqual(next, FRESH, "onCreationRunTerminated removes a bound alias entry so it does not linger indefinitely");
}

// Alias entry with original creation entry: alias is removed, original preserved
{
  const state = {
    pendingRuns: {
      "run-orig": { sessionId: "sess-abc" },
      "run-alias": { sessionId: "sess-abc", isAlias: true as const },
    },
  };
  const next = onCreationRunTerminated(state, "run-alias");
  assert.equal(next.pendingRuns["run-alias"], undefined, "alias removed on terminal");
  assert.ok(next.pendingRuns["run-orig"], "original non-alias entry preserved for retry");
}

// Retry-to-replacement: alias done with different session ID fires refresh and
// removes all entries bound to the original session.
{
  const state = {
    pendingRuns: {
      "run-orig": { sessionId: "sess-old" },
      "run-retry": { sessionId: "sess-old", isAlias: true as const },
      "run-unrelated": { sessionId: "sess-other" },
    },
  };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-retry", "sess-replacement", false);
  assert.equal(shouldRefresh, true, "alias with replacement session ID fires sidebar refresh");
  assert.equal(nextState.pendingRuns["run-retry"], undefined, "alias entry removed after replacement done");
  assert.equal(nextState.pendingRuns["run-orig"], undefined, "original bound entry also removed (obsolete after replacement)");
  assert.ok(nextState.pendingRuns["run-unrelated"], "unrelated session entry preserved");
}

// Non-alias mismatch remains a no-op (server sending a different session ID
// for a non-retry creation is inconsistent state, not a replacement).
{
  const state = { pendingRuns: { "run-a": { sessionId: "sess-new" } } };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "run-a", "sess-other", false);
  assert.equal(shouldRefresh, false, "non-alias mismatch does not fire refresh");
  assert.deepEqual(nextState, state, "non-alias mismatch leaves state untouched");
}

console.log("chat-creation-refresh.test.ts ok");

// shouldReplacementRefreshOnDone ------------------------------------------------

// success different-ID → true (replacement/fork)
{
  const result = shouldReplacementRefreshOnDone("origin-sess", "new-sess", false);
  assert.equal(result, true, "shouldReplacementRefreshOnDone returns true when originSessionId is non-null and completedSessionId differs from origin");
}

// same-ID followup → false
{
  const result = shouldReplacementRefreshOnDone("sess-abc", "sess-abc", false);
  assert.equal(result, false, "shouldReplacementRefreshOnDone returns false for ordinary same-ID followup");
}

// failed done → false
{
  const result = shouldReplacementRefreshOnDone("origin-sess", "new-sess", true);
  assert.equal(result, false, "shouldReplacementRefreshOnDone returns false when isError is true (failed done)");
}

// sessionless (null origin) → false (handled by creation-refresh path)
{
  const result = shouldReplacementRefreshOnDone(null, "new-sess", false);
  assert.equal(result, false, "shouldReplacementRefreshOnDone returns false when originSessionId is null (sessionless creation)");
}

// completedSessionId null → false
{
  const result = shouldReplacementRefreshOnDone("origin-sess", null, false);
  assert.equal(result, false, "shouldReplacementRefreshOnDone returns false when completedSessionId is null");
}

// completedSessionId undefined → false
{
  const result = shouldReplacementRefreshOnDone("origin-sess", undefined, false);
  assert.equal(result, false, "shouldReplacementRefreshOnDone returns false when completedSessionId is undefined");
}

// failed done same-ID → false (error gate fires before ID check)
{
  const result = shouldReplacementRefreshOnDone("sess-abc", "sess-abc", true);
  assert.equal(result, false, "shouldReplacementRefreshOnDone returns false for failed same-ID done");
}

// failed done different-ID → false (error gate fires before ID check)
{
  const result = shouldReplacementRefreshOnDone("origin-sess", "forked-sess", true);
  assert.equal(result, false, "shouldReplacementRefreshOnDone returns false for failed different-ID done");
}

console.log("shouldReplacementRefreshOnDone: ok");
