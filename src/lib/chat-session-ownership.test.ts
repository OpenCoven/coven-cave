import assert from "node:assert/strict";
import test from "node:test";
import { ownsDisplayedView } from "./chat-session-ownership.ts";

// ─── Non-null origin (existing-session generation) ───────────────────────────

test("non-null origin: owns when currentSessionId matches originSessionId", () => {
  assert.equal(
    ownsDisplayedView({
      currentSessionId: "sess-1",
      originSessionId: "sess-1",
      runId: "run-a",
      displayedCreationRunId: "run-a",
    }),
    true,
  );
});

test("non-null origin: does not own when currentSessionId differs", () => {
  assert.equal(
    ownsDisplayedView({
      currentSessionId: "sess-2",
      originSessionId: "sess-1",
      runId: "run-a",
      displayedCreationRunId: "run-a",
    }),
    false,
  );
  assert.equal(
    ownsDisplayedView({
      currentSessionId: null,
      originSessionId: "sess-1",
      runId: "run-a",
      displayedCreationRunId: "run-a",
    }),
    false,
    "null current vs non-null origin: does not own",
  );
});

test("non-null origin: resumed replacement crossing remount cannot promote into fresh compose", () => {
  // The old ChatView still retains its matching currentSessionId after cleanup,
  // but unmount has cleared its display ownership before a fresh compose mounts.
  assert.equal(
    ownsDisplayedView({
      currentSessionId: "sess-1",
      originSessionId: "sess-1",
      runId: "run-a",
      displayedCreationRunId: null,
    }),
    false,
    "the stale resumed run cannot promote its replacement after unmount clears display ownership",
  );
  assert.equal(
    ownsDisplayedView({
      currentSessionId: "sess-1",
      originSessionId: "sess-1",
      runId: "run-a",
      displayedCreationRunId: "run-b",
    }),
    false,
    "a fresh compose run's ownership also blocks the stale resumed run",
  );
});

// ─── Null origin (sessionless new-chat generation) ────────────────────────────

test("null origin ordinary new chat: B owns compose slot, A does not", () => {
  // Race scenario: A then B are both sessionless sends. B is newer; B's runId is
  // stored as displayedCreationRunId. When A's session event arrives,
  // currentSessionId is still null (B hasn't adopted yet). A must not adopt.

  assert.equal(
    ownsDisplayedView({
      currentSessionId: null,
      originSessionId: null,
      runId: "run-a",
      displayedCreationRunId: "run-b", // B owns the slot
    }),
    false,
    "A cannot adopt when B owns the displayed compose slot",
  );

  assert.equal(
    ownsDisplayedView({
      currentSessionId: null,
      originSessionId: null,
      runId: "run-b",
      displayedCreationRunId: "run-b", // B owns the slot, B is current
    }),
    true,
    "B can adopt when it owns the displayed compose slot",
  );
});

test("null origin: A still does not adopt after B adopts (currentSessionId becomes non-null)", () => {
  // After B's session event runs, currentSessionId = B.sessionId (non-null).
  // A's late done-event stable-ID fallback must not adopt.
  assert.equal(
    ownsDisplayedView({
      currentSessionId: "sess-b",
      originSessionId: null,
      runId: "run-a",
      displayedCreationRunId: "run-b",
    }),
    false,
  );
});

test("null origin: B does not re-adopt after adoption clears the slot (currentSessionId non-null)", () => {
  // After B adopts, displayedCreationRunId is set to null and currentSessionId
  // is B's session ID. The done-event stable-ID fallback for B must not re-adopt.
  assert.equal(
    ownsDisplayedView({
      currentSessionId: "sess-b",
      originSessionId: null,
      runId: "run-b",
      displayedCreationRunId: null,
    }),
    false,
    "after adoption, both currentSessionId being non-null and slot being cleared block re-adoption",
  );
});

test("null origin: does not own when displayedCreationRunId is null (no send registered)", () => {
  assert.equal(
    ownsDisplayedView({
      currentSessionId: null,
      originSessionId: null,
      runId: "run-a",
      displayedCreationRunId: null,
    }),
    false,
    "no sessionless send has registered ownership; nothing adopts",
  );
});

test("null origin: does not own when currentSessionId is non-null (thread switched or already adopted)", () => {
  // User switched to an existing session before A's event arrived.
  assert.equal(
    ownsDisplayedView({
      currentSessionId: "sess-x",
      originSessionId: null,
      runId: "run-a",
      displayedCreationRunId: "run-a", // same runId, but current is non-null
    }),
    false,
  );
});
