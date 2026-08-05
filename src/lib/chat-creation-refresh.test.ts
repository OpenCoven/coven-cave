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

// Successful first completion while unbound: accept any ID, refresh, clear
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(ELIGIBLE, false, "sess-abc");
  assert.equal(shouldRefresh, true, "successful first completion (unbound) should refresh");
  assert.deepEqual(nextState, FRESH, "eligibility cleared after first successful completion");
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

// No double-refresh: once eligible → done success, next done should not fire again
{
  const first = onDoneCreationRefresh(ELIGIBLE, false, "sess-abc");
  const second = onDoneCreationRefresh(first.nextState, false, "sess-abc");
  assert.equal(first.shouldRefresh, true, "first successful done refreshes");
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

console.log("chat-creation-refresh.test.ts ok");
