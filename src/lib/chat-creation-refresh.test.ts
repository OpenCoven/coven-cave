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

// Binds the pending state to the server-assigned session ID
{
  const next = onCreationSessionIdentified(ELIGIBLE, "sess-new");
  assert.deepEqual(next, { pendingCreationRefresh: true, creationSessionId: "sess-new" },
    "onCreationSessionIdentified binds the creation session ID when pending and unbound");
}

// Idempotent: already bound — must not overwrite with a second ID
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-original" };
  const next = onCreationSessionIdentified(bound, "sess-other");
  assert.deepEqual(next, bound,
    "onCreationSessionIdentified is a no-op when already bound");
}

// No-op when not pending (follow-up send)
{
  const next = onCreationSessionIdentified(FRESH, "sess-any");
  assert.deepEqual(next, FRESH,
    "onCreationSessionIdentified is a no-op when not pending");
}

// onDoneCreationRefresh — unbound (creationSessionId: null) ------------------

// Unbound pending: ChatView must call onCreationSessionIdentified first.
// Without binding, the helper does NOT auto-refresh on any completion.
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(ELIGIBLE, false, "sess-abc");
  assert.equal(shouldRefresh, false, "unbound pending done does not auto-refresh — binding required before done");
  assert.deepEqual(nextState, ELIGIBLE, "unbound pending done leaves state unchanged");
}

// Failed completion while unbound: refresh does NOT fire, eligibility preserved
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(ELIGIBLE, true, "sess-abc");
  assert.equal(shouldRefresh, false, "failed completion does not refresh");
  assert.deepEqual(nextState, ELIGIBLE, "failed completion preserves eligibility for retry");
}

// Follow-up done on ineligible state: no refresh
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(FRESH, false, "sess-abc");
  assert.equal(shouldRefresh, false, "follow-up done does not creation-refresh");
  assert.deepEqual(nextState, FRESH, "follow-up done leaves state unchanged");
}

// Successful done with missing sessionId: no refresh even if eligible
{
  const { shouldRefresh } = onDoneCreationRefresh(ELIGIBLE, false, null);
  assert.equal(shouldRefresh, false, "eligible done with null sessionId does not refresh");
}
{
  const { shouldRefresh } = onDoneCreationRefresh(ELIGIBLE, false, undefined);
  assert.equal(shouldRefresh, false, "eligible done with undefined sessionId does not refresh");
}

// No double-refresh: once bound → done success, the next done must not fire again
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-abc" };
  const first = onDoneCreationRefresh(bound, false, "sess-abc");
  const second = onDoneCreationRefresh(first.nextState, false, "sess-abc");
  assert.equal(first.shouldRefresh, true, "first successful bound done refreshes");
  assert.equal(second.shouldRefresh, false, "second done does not refresh (eligibility consumed)");
}

// onDoneCreationRefresh — bound (creationSessionId: "sess-new") ---------------

// Successful done for the bound creation ID: refresh and clear
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(bound, false, "sess-new");
  assert.equal(shouldRefresh, true, "bound creation session success should refresh");
  assert.deepEqual(nextState, FRESH, "eligibility cleared after bound creation session success");
}

// Failed done for the bound creation ID: preserve state and bound ID
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(bound, true, "sess-new");
  assert.equal(shouldRefresh, false, "failed done on bound creation session does not refresh");
  assert.deepEqual(nextState, bound, "failed done on bound creation session preserves state and ID");
}

// Mismatched existing-session completion while a creation refresh is pending:
// must NOT refresh and must NOT consume or modify the pending state.
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const { shouldRefresh, nextState } = onDoneCreationRefresh(bound, false, "sess-existing");
  assert.equal(shouldRefresh, false,
    "mismatched existing-session done does not consume the pending creation refresh");
  assert.deepEqual(nextState, bound,
    "mismatched existing-session done leaves pending creation state untouched");
}

// Once cleared after success, a subsequent completion for the old creation ID
// must not refresh again.
{
  const bound = { pendingCreationRefresh: true, creationSessionId: "sess-new" };
  const first = onDoneCreationRefresh(bound, false, "sess-new");
  const second = onDoneCreationRefresh(first.nextState, false, "sess-new");
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

  // "session" event identifies the server-assigned ID
  state = onCreationSessionIdentified(state, "sess-abc");
  assert.equal(state.creationSessionId, "sess-abc", "session identified binds the ID");

  // First done arrives as an error
  const failedResult = onDoneCreationRefresh(state, true, "sess-abc");
  state = failedResult.nextState;
  assert.equal(failedResult.shouldRefresh, false, "failed first done does not refresh");
  assert.ok(state.pendingCreationRefresh, "eligibility preserved after failure");
  assert.equal(state.creationSessionId, "sess-abc", "bound ID preserved after failure");

  // An existing session completes while we're waiting — must not consume state
  const existingResult = onDoneCreationRefresh(state, false, "sess-other");
  assert.equal(existingResult.shouldRefresh, false, "existing-session done does not consume creation pending");
  assert.deepEqual(existingResult.nextState, state, "state unchanged after existing-session done");

  // Retry: initialSessionId is now "sess-abc" (promoted by "session" event)
  state = onSendStart(state, "sess-abc");
  assert.ok(state.pendingCreationRefresh, "retry with promoted id preserves eligibility");

  // Successful retry
  const successResult = onDoneCreationRefresh(state, false, "sess-abc");
  state = successResult.nextState;
  assert.equal(successResult.shouldRefresh, true, "successful retry fires the creation refresh");
  assert.deepEqual(state, FRESH, "eligibility cleared after successful retry");

  // Follow-up completion does not refresh
  const followupResult = onDoneCreationRefresh(state, false, "sess-abc");
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
  state = onCreationSessionIdentified(state, "creation-sess");
  assert.equal(state.creationSessionId, "creation-sess", "binding outside ownership guard attaches the session ID");

  // Step 3: the currently-displayed existing session completes — must NOT refresh.
  const unrelated = onDoneCreationRefresh(state, false, "other-existing-sess");
  assert.equal(unrelated.shouldRefresh, false,
    "unrelated session done does not consume the pending creation refresh");
  assert.deepEqual(unrelated.nextState, state,
    "unrelated session done leaves state untouched");

  // Step 4: the original background creation session completes — must refresh once.
  const creation = onDoneCreationRefresh(state, false, "creation-sess");
  assert.equal(creation.shouldRefresh, true,
    "background creation session done refreshes the sidebar");
  assert.deepEqual(creation.nextState, FRESH,
    "eligibility consumed after creation refresh");

  // Step 5: subsequent completion for the same ID must not refresh again.
  const again = onDoneCreationRefresh(creation.nextState, false, "creation-sess");
  assert.equal(again.shouldRefresh, false,
    "second completion does not re-refresh after eligibility is consumed");
}

console.log("chat-creation-refresh.test.ts ok");
