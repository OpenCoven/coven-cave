// @ts-nocheck
import assert from "node:assert/strict";
import { onSendStart, onCreationSessionIdentified, onDoneCreationRefresh } from "./chat-creation-refresh.ts";

const FRESH = { pendingCreationRefresh: false, creationSessionId: null };
const ELIGIBLE = { pendingCreationRefresh: true, creationSessionId: null };

// onSendStart ----------------------------------------------------------------

// New chat (no prior session) → becomes eligible (unbound)
{
  const next = onSendStart(FRESH, null);
  assert.deepEqual(next, ELIGIBLE, "new-chat send with null sessionId marks creation-refresh eligible");
}

// Follow-up send on an existing session → stays ineligible
{
  const next = onSendStart(FRESH, "sess-existing");
  assert.deepEqual(next, FRESH, "follow-up send with existing sessionId stays ineligible");
}

// Retry after failed first send: state already eligible, initialSessionId
// is now the server-promoted id (non-null) — must preserve eligibility
{
  const next = onSendStart(ELIGIBLE, "sess-promoted");
  assert.deepEqual(next, ELIGIBLE, "retry with promoted sessionId preserves existing eligibility");
}

// Already eligible + null initialSessionId (odd edge; must not double-trigger)
{
  const next = onSendStart(ELIGIBLE, null);
  assert.deepEqual(next, ELIGIBLE, "already-eligible state stays eligible on another null-session send");
}

// onCreationSessionIdentified ------------------------------------------------

// Binds the pending state to the server-assigned session ID (sessionless origin)
{
  const next = onCreationSessionIdentified(ELIGIBLE, "sess-new", null);
  assert.deepEqual(next, { pendingCreationRefresh: true, creationSessionId: "sess-new" },
    "onCreationSessionIdentified binds the creation session ID when pending, unbound, and origin is null");
}

// Idempotent: already bound — must not overwrite with a second ID
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-original" };
  const next = onCreationSessionIdentified(bound, "sess-other", null);
  assert.deepEqual(next, bound,
    "onCreationSessionIdentified is a no-op when already bound");
}

// No-op when not pending (follow-up send)
{
  const next = onCreationSessionIdentified(FRESH, "sess-any", null);
  assert.deepEqual(next, FRESH,
    "onCreationSessionIdentified is a no-op when not pending");
}

// Provenance gate: non-null origin must NOT bind an unbound pending state.
// An existing-session generation calling identify must leave the state untouched.
{
  const next = onCreationSessionIdentified(ELIGIBLE, "existing-1", "existing-1");
  assert.deepEqual(next, ELIGIBLE,
    "onCreationSessionIdentified with non-null origin does not bind an unbound pending state");
}

// Provenance gate: a retry's non-null origin also does not re-bind an already-bound state
// (already covered by the idempotent test above, but explicit for clarity)
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-abc" };
  const next = onCreationSessionIdentified(bound, "sess-abc", "sess-abc");
  assert.deepEqual(next, bound,
    "onCreationSessionIdentified with non-null origin (retry) is a no-op on already-bound state");
}

// onDoneCreationRefresh — unbound (creationSessionId: null) ------------------

// Unbound pending: ChatView must call onCreationSessionIdentified first.
// Without binding, the helper does NOT auto-refresh on any completion.
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(ELIGIBLE, false, "sess-abc", null);
  assert.equal(shouldRefresh, false, "unbound pending done does not auto-refresh — binding required before done");
  assert.deepEqual(nextState, ELIGIBLE, "unbound pending done leaves state unchanged");
}

// Failed completion while unbound: refresh does NOT fire, eligibility preserved
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(ELIGIBLE, true, "sess-abc", null);
  assert.equal(shouldRefresh, false, "failed completion does not refresh");
  assert.deepEqual(nextState, ELIGIBLE, "failed completion preserves eligibility for retry");
}

// Follow-up done on ineligible state: no refresh
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(FRESH, false, "sess-abc", null);
  assert.equal(shouldRefresh, false, "follow-up done does not creation-refresh");
  assert.deepEqual(nextState, FRESH, "follow-up done leaves state unchanged");
}

// Successful done with missing sessionId: no refresh even if eligible
{
  const { shouldRefresh } = onDoneCreationRefresh(ELIGIBLE, false, null, null);
  assert.equal(shouldRefresh, false, "eligible done with null sessionId does not refresh");
}
{
  const { shouldRefresh } = onDoneCreationRefresh(ELIGIBLE, false, undefined, null);
  assert.equal(shouldRefresh, false, "eligible done with undefined sessionId does not refresh");
}

// No double-refresh: once bound → done success, the next done must not fire again
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-abc" };
  const first = onDoneCreationRefresh(bound, false, "sess-abc", null);
  const second = onDoneCreationRefresh(first.nextState, false, "sess-abc", null);
  assert.equal(first.shouldRefresh, true, "first successful bound done refreshes");
  assert.equal(second.shouldRefresh, false, "second done does not refresh (eligibility consumed)");
}

// onDoneCreationRefresh — bound (creationSessionId: "sess-new") ---------------

// Successful done for the bound creation ID: refresh and clear
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(bound, false, "sess-new", null);
  assert.equal(shouldRefresh, true, "bound creation session success should refresh");
  assert.deepEqual(nextState, FRESH, "eligibility cleared after bound creation session success");
}

// Failed done for the bound creation ID: preserve state and bound ID
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(bound, true, "sess-new", null);
  assert.equal(shouldRefresh, false, "failed done on bound creation session does not refresh");
  assert.deepEqual(nextState, bound, "failed done on bound creation session preserves state and ID");
}

// Mismatched existing-session completion while a creation refresh is pending:
// must NOT refresh and must NOT consume or modify the pending state.
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(bound, false, "sess-existing", "sess-existing");
  assert.equal(shouldRefresh, false,
    "mismatched existing-session done does not consume the pending creation refresh");
  assert.deepEqual(nextState, bound,
    "mismatched existing-session done leaves pending creation state untouched");
}

// Once cleared after success, a subsequent completion for the old creation ID
// must not refresh again.
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const first = onDoneCreationRefresh(bound, false, "sess-new", null);
  const second = onDoneCreationRefresh(first.nextState, false, "sess-new", null);
  assert.equal(first.shouldRefresh, true, "first successful bound done refreshes");
  assert.equal(second.shouldRefresh, false, "second done after clear does not refresh");
}

// Full retry scenario: new chat → session identified → failed done → retry → success
{
  // Initial send: no session id
  let state = FRESH;
  state = onSendStart(state, null);
  assert.ok(state.pendingCreationRefresh, "new-chat send makes state eligible");
  assert.equal(state.creationSessionId, null, "creation session ID starts unbound");

  // "session" event identifies the server-assigned ID (sessionless generation)
  state = onCreationSessionIdentified(state, "sess-abc", null);
  assert.equal(state.creationSessionId, "sess-abc", "session identified binds the ID");

  // First done arrives as an error
  const failedResult = onDoneCreationRefresh(state, true, "sess-abc", null);
  state = failedResult.nextState;
  assert.equal(failedResult.shouldRefresh, false, "failed first done does not refresh");
  assert.ok(state.pendingCreationRefresh, "eligibility preserved after failure");
  assert.equal(state.creationSessionId, "sess-abc", "bound ID preserved after failure");

  // An existing session completes while we're waiting — must not consume state
  const existingResult = onDoneCreationRefresh(state, false, "sess-other", "sess-other");
  assert.equal(existingResult.shouldRefresh, false, "existing-session done does not consume creation pending");
  assert.deepEqual(existingResult.nextState, state, "state unchanged after existing-session done");

  // Retry: initialSessionId is now "sess-abc" (promoted by "session" event)
  state = onSendStart(state, "sess-abc");
  assert.ok(state.pendingCreationRefresh, "retry with promoted id preserves eligibility");

  // Retry's session event (idempotent — state already bound, non-null origin)
  state = onCreationSessionIdentified(state, "sess-abc", "sess-abc");
  assert.equal(state.creationSessionId, "sess-abc", "retry session event is a no-op on already-bound state");

  // Successful retry (origin matches bound creationSessionId → participates)
  const successResult = onDoneCreationRefresh(state, false, "sess-abc", "sess-abc");
  state = successResult.nextState;
  assert.equal(successResult.shouldRefresh, true, "successful retry fires the creation refresh");
  assert.deepEqual(state, FRESH, "eligibility cleared after successful retry");

  // Follow-up completion does not refresh
  const followupResult = onDoneCreationRefresh(state, false, "sess-abc", "sess-abc");
  assert.equal(followupResult.shouldRefresh, false, "follow-up completion after clear does not refresh");
}

// Cross-thread binding scenario (Task 1 compliance gap):
// The user starts a new chat, then switches threads before the session ID
// arrives. The "session" SSE event fires for the background generation outside
// the view's ownership guard. ChatView binds via onCreationSessionIdentified
// (now outside the guard). Then:
// - A completion for the currently-displayed (unrelated) session must NOT refresh.
// - A completion for the original creation session must refresh exactly once.
{
  let state = FRESH;

  // Step 1: new-chat send (no initial session id)
  state = onSendStart(state, null);
  assert.ok(state.pendingCreationRefresh, "new-chat send makes state eligible");
  assert.equal(state.creationSessionId, null, "starts unbound");

  // Step 2: user switches away; session id arrives for the background generation.
  // ChatView binds OUTSIDE the ownership guard.
  state = onCreationSessionIdentified(state, "creation-sess", null);
  assert.equal(state.creationSessionId, "creation-sess", "binding outside ownership guard attaches the session ID");

  // Step 3: the currently-displayed existing session completes — must NOT refresh.
  const unrelated = onDoneCreationRefresh(state, false, "other-existing-sess", "other-existing-sess");
  assert.equal(unrelated.shouldRefresh, false,
    "unrelated session done does not consume the pending creation refresh");
  assert.deepEqual(unrelated.nextState, state,
    "unrelated session done leaves state untouched");

  // Step 4: the original background creation session completes — must refresh once.
  const creation = onDoneCreationRefresh(state, false, "creation-sess", null);
  assert.equal(creation.shouldRefresh, true,
    "background creation session done refreshes the sidebar");
  assert.deepEqual(creation.nextState, FRESH,
    "eligibility consumed after creation refresh");

  // Step 5: subsequent completion for the same ID must not refresh again.
  const again = onDoneCreationRefresh(creation.nextState, false, "creation-sess", null);
  assert.equal(again.shouldRefresh, false,
    "second completion does not re-refresh after eligibility is consumed");
}

// Task 1 interleaving: unrelated existing generation fires identify/done
// BEFORE the background sessionless generation gets its ID.
// Exact ordering:
//   1. pending unbound from new send
//   2. unrelated existing generation (origin "existing-1") identifies/completes "existing-1" → no bind, no refresh
//   3. background sessionless generation identifies "created-1" → binds
//   4. created completion → refresh once
{
  let state = FRESH;

  // Step 1: new-chat send makes state eligible and unbound
  state = onSendStart(state, null);
  assert.ok(state.pendingCreationRefresh, "[interleave] new-chat send makes state eligible");
  assert.equal(state.creationSessionId, null, "[interleave] state starts unbound");

  // Step 2a: unrelated existing generation (origin "existing-1") fires its "session" event
  const afterExistingSession = onCreationSessionIdentified(state, "existing-1", "existing-1");
  assert.deepEqual(afterExistingSession, state,
    "[interleave] existing-gen session event does not bind the pending unbound state");

  // Step 2b: that same existing generation completes "existing-1" → no bind, no refresh
  const existingDone = onDoneCreationRefresh(state, false, "existing-1", "existing-1");
  assert.equal(existingDone.shouldRefresh, false,
    "[interleave] existing-gen completion does not fire creation refresh");
  assert.deepEqual(existingDone.nextState, state,
    "[interleave] existing-gen completion leaves creation state unchanged");

  // Step 3: background sessionless generation gets its "session" event → binds
  state = onCreationSessionIdentified(state, "created-1", null);
  assert.equal(state.creationSessionId, "created-1",
    "[interleave] sessionless generation's session event binds to created-1");

  // Step 4: background creation generation completes → refresh fires exactly once
  const createdDone = onDoneCreationRefresh(state, false, "created-1", null);
  assert.equal(createdDone.shouldRefresh, true,
    "[interleave] creation generation completion fires the sidebar refresh");
  assert.deepEqual(createdDone.nextState, FRESH,
    "[interleave] eligibility consumed after creation refresh");

  // No second refresh
  const createdDoneAgain = onDoneCreationRefresh(createdDone.nextState, false, "created-1", null);
  assert.equal(createdDoneAgain.shouldRefresh, false,
    "[interleave] second completion after refresh does not re-fire");
}

console.log("chat-creation-refresh.test.ts ok");
