// @ts-nocheck
import assert from "node:assert/strict";
import { onSendStart, onDoneCreationRefresh } from "./chat-creation-refresh.ts";

const FRESH = { pendingCreationRefresh: false };
const ELIGIBLE = { pendingCreationRefresh: true };

// onSendStart ----------------------------------------------------------------

// New chat (no prior session) → becomes eligible
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

// onDoneCreationRefresh ------------------------------------------------------

// Successful first completion: refresh fires, eligibility cleared
{
  const { shouldRefresh, nextState } = onDoneCreationRefresh(ELIGIBLE, false, "sess-abc");
  assert.equal(shouldRefresh, true, "successful first completion should refresh");
  assert.deepEqual(nextState, FRESH, "eligibility cleared after first successful completion");
}

// Failed completion: refresh does NOT fire, eligibility preserved for retry
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

// Full retry scenario: new chat → session promoted → failed done → retry → success
{
  // Initial send: no session id
  let state = FRESH;
  state = onSendStart(state, null);
  assert.ok(state.pendingCreationRefresh, "new-chat send makes state eligible");

  // "session" event promotes id (not tracked by this helper, but session id
  // is now "sess-abc" for subsequent sends). First done arrives as an error.
  const failedResult = onDoneCreationRefresh(state, true, "sess-abc");
  state = failedResult.nextState;
  assert.equal(failedResult.shouldRefresh, false, "failed first done does not refresh");
  assert.ok(state.pendingCreationRefresh, "eligibility preserved after failure");

  // Retry: initialSessionId is now "sess-abc" (promoted by "session" event)
  state = onSendStart(state, "sess-abc");
  assert.ok(state.pendingCreationRefresh, "retry with promoted id preserves eligibility");

  // Successful retry
  const successResult = onDoneCreationRefresh(state, false, "sess-abc");
  state = successResult.nextState;
  assert.equal(successResult.shouldRefresh, true, "successful retry fires the creation refresh");
  assert.deepEqual(state, FRESH, "eligibility cleared after successful retry");
}

console.log("chat-creation-refresh.test.ts ok");
