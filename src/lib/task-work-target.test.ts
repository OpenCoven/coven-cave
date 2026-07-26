import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTaskWorkTarget } from "./task-work-target.ts";

test("unlinked tasks have no work session", () => {
  assert.deepEqual(resolveTaskWorkTarget(null, []), { kind: "unlinked" });
});

test("linked tasks wait while the workspace session list catches up", () => {
  assert.deepEqual(resolveTaskWorkTarget("session-1", []), {
    kind: "preparing",
    sessionId: "session-1",
  });
});

test("linked tasks resolve the matching workspace session", () => {
  const session = { id: "session-1", title: "Task: Ship it" };
  assert.deepEqual(resolveTaskWorkTarget("session-1", [session]), {
    kind: "ready",
    session,
  });
});
