import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeHandoff, runtimeHandoffEpoch } from "./chat-runtime-handoff.ts";

test("a pending runtime handoff starts fresh on its target harness", () => {
  assert.deepEqual(
    resolveRuntimeHandoff({
      harness: "claude",
      pendingRuntimeHandoff: {
        fromHarness: "claude",
        toHarness: "codex",
        requestedAt: "2026-09-16T12:00:00.000Z",
      },
    }),
    {
      harness: "codex",
      startsFresh: true,
      handoffEpoch: "claude codex 2026-09-16T12:00:00.000Z",
    },
  );
});

test("an ordinary resumed conversation stays on its recorded harness", () => {
  assert.deepEqual(resolveRuntimeHandoff({ harness: "claude" }), {
    harness: "claude",
    startsFresh: false,
    handoffEpoch: null,
  });
});

test("a conversation with no marker has no epoch to finalize", () => {
  assert.equal(runtimeHandoffEpoch(undefined), null);
});

test("a newer handoff request carries a different epoch", () => {
  const first = runtimeHandoffEpoch({
    fromHarness: "claude",
    toHarness: "codex",
    requestedAt: "2026-09-16T12:00:00.000Z",
  });
  const second = runtimeHandoffEpoch({
    fromHarness: "codex",
    toHarness: "openclaw",
    requestedAt: "2026-09-16T12:00:01.000Z",
  });
  assert.notEqual(first, second);
});

test("re-requesting the same transition at the same instant is one epoch", () => {
  const marker = {
    fromHarness: "claude",
    toHarness: "codex",
    requestedAt: "2026-09-16T12:00:00.000Z",
  };
  assert.equal(runtimeHandoffEpoch(marker), runtimeHandoffEpoch({ ...marker }));
});

test("the epoch canonicalizes harness aliases so a rewrite is not a new marker", () => {
  assert.equal(
    runtimeHandoffEpoch({
      fromHarness: "claude",
      toHarness: "codex",
      requestedAt: "2026-09-16T12:00:00.000Z",
    }),
    runtimeHandoffEpoch({
      fromHarness: "claude-code",
      toHarness: "codex",
      requestedAt: "2026-09-16T12:00:00.000Z",
    }),
  );
});
