// @ts-nocheck
import assert from "node:assert/strict";
import {
  CREATION_REFRESH_INITIAL,
  onCreationSessionIdentified,
  onDoneCreationRefresh,
} from "./chat-creation-refresh.ts";

const EMPTY = CREATION_REFRESH_INITIAL;

// Helper: make state with a given set of pending IDs
function pending(...ids) {
  return { pendingIds: new Set(ids) };
}

// onCreationSessionIdentified ------------------------------------------------

// Sessionless generation: adds the assigned ID to pendingIds
{
  const next = onCreationSessionIdentified(EMPTY, null, "sess-A");
  assert.deepEqual(next, pending("sess-A"),
    "sessionless generation adds assigned ID to pendingIds");
}

// Idempotent: calling again with the same ID is a no-op (returns same ref)
{
  const state = pending("sess-A");
  const next = onCreationSessionIdentified(state, null, "sess-A");
  assert.strictEqual(next, state,
    "onCreationSessionIdentified is a no-op when ID already pending");
}

// Non-sessionless generation (retry or follow-up): no-op
{
  const next = onCreationSessionIdentified(EMPTY, "sess-existing", "sess-existing");
  assert.strictEqual(next, EMPTY,
    "non-null originSessionId is a no-op for onCreationSessionIdentified");
}

// --- Scenario 1: first success -----------------------------------------------

{
  // Session event fires, then done succeeds.
  let state = EMPTY;
  state = onCreationSessionIdentified(state, null, "sess-A");
  assert.deepEqual(state, pending("sess-A"), "session event adds ID to pending");

  const { shouldRefresh, nextState } = onDoneCreationRefresh(state, "sess-A", false);
  assert.equal(shouldRefresh, true, "successful done for pending ID refreshes");
  assert.deepEqual(nextState, EMPTY, "successful done removes the ID from pending");
}

// --- Scenario 2: failure then retry ------------------------------------------

{
  // First attempt fails; session ID stays pending.
  let state = EMPTY;
  state = onCreationSessionIdentified(state, null, "sess-A");
  const { shouldRefresh: s1, nextState: after1 } = onDoneCreationRefresh(state, "sess-A", true);
  assert.equal(s1, false, "failed done does not refresh");
  assert.deepEqual(after1, pending("sess-A"), "failed done keeps ID pending for retry");

  // Retry: originSessionId is now "sess-A" (non-null) — identify call is no-op.
  let retryState = onCreationSessionIdentified(after1, "sess-A", "sess-A");
  assert.strictEqual(retryState, after1, "retry identify call is a no-op");

  // Retry succeeds.
  const { shouldRefresh: s2, nextState: after2 } = onDoneCreationRefresh(retryState, "sess-A", false);
  assert.equal(s2, true, "retry success refreshes");
  assert.deepEqual(after2, EMPTY, "retry success removes ID from pending");
}

// --- Scenario 3: existing-session generation (not a creation) ---------------

{
  // A generation that started on an existing session never enters pendingIds.
  let state = EMPTY;
  state = onCreationSessionIdentified(state, "sess-existing", "sess-existing");
  assert.deepEqual(state, EMPTY, "existing-session identify is a no-op");

  const { shouldRefresh } = onDoneCreationRefresh(state, "sess-existing", false);
  assert.equal(shouldRefresh, false, "existing-session done does not refresh");
}

// --- Scenario 4: once-only guarantee -----------------------------------------

{
  // A second done call for an already-cleared ID does not refresh.
  let state = EMPTY;
  state = onCreationSessionIdentified(state, null, "sess-A");
  const { nextState: after1 } = onDoneCreationRefresh(state, "sess-A", false);
  assert.deepEqual(after1, EMPTY, "first done clears the ID");

  const { shouldRefresh: second } = onDoneCreationRefresh(after1, "sess-A", false);
  assert.equal(second, false, "second done for cleared ID does not refresh");
}

// --- Scenario 5: two concurrent sessionless creations -----------------------

{
  // Both A and B start as sessionless. Each should refresh exactly once.
  let state = EMPTY;
  state = onCreationSessionIdentified(state, null, "sess-A");
  state = onCreationSessionIdentified(state, null, "sess-B");
  assert.deepEqual(state, pending("sess-A", "sess-B"), "both IDs in pending");

  const { shouldRefresh: rA, nextState: afterA } = onDoneCreationRefresh(state, "sess-A", false);
  assert.equal(rA, true, "A done refreshes");
  assert.deepEqual(afterA, pending("sess-B"), "A done removes only A");

  const { shouldRefresh: rB, nextState: afterB } = onDoneCreationRefresh(afterA, "sess-B", false);
  assert.equal(rB, true, "B done refreshes");
  assert.deepEqual(afterB, EMPTY, "B done removes only B");
}

// --- Scenario 6: failed A does not block fresh B ----------------------------

{
  // A starts, receives session ID, done fails → A stays pending.
  let state = EMPTY;
  state = onCreationSessionIdentified(state, null, "sess-A");
  const { nextState: afterFailA } = onDoneCreationRefresh(state, "sess-A", true);
  assert.deepEqual(afterFailA, pending("sess-A"), "failed A keeps ID pending");

  // B starts fresh (originSessionId === null).
  let stateB = onCreationSessionIdentified(afterFailA, null, "sess-B");
  assert.deepEqual(stateB, pending("sess-A", "sess-B"), "B adds its ID independently");

  // B succeeds — refreshes without touching A.
  const { shouldRefresh: rB, nextState: afterB } = onDoneCreationRefresh(stateB, "sess-B", false);
  assert.equal(rB, true, "B refreshes independently of failed A");
  assert.deepEqual(afterB, pending("sess-A"), "A remains pending after B succeeds");

  // A retries and succeeds.
  const { shouldRefresh: rA } = onDoneCreationRefresh(afterB, "sess-A", false);
  assert.equal(rA, true, "A retries and refreshes after B completed");
}

console.log("chat-creation-refresh.test.ts ok");
