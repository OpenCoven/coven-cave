import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeHandoff } from "./chat-runtime-handoff.ts";

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
    { harness: "codex", startsFresh: true },
  );
});

test("an ordinary resumed conversation stays on its recorded harness", () => {
  assert.deepEqual(resolveRuntimeHandoff({ harness: "claude" }), {
    harness: "claude",
    startsFresh: false,
  });
});
