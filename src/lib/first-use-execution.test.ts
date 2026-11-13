import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstUseState } from "./first-use.ts";
import { firstUseAllowsExecution, publishFirstUseExecutionState, FIRST_USE_OPEN_EVENT } from "./first-use-execution.ts";

test("browser execution requires verified introduction progress and requests the guide on incomplete or unreadable state", async () => {
  const target = new EventTarget();
  let opens = 0;
  target.addEventListener(FIRST_USE_OPEN_EVENT, () => { opens++; });
  const globals = globalThis as unknown as { window?: EventTarget };
  const originalWindow = globals.window;
  const originalFetch = globalThis.fetch;
  globals.window = target;
  try {
    globalThis.fetch = async () => Response.json({ ok: false, error: "state unavailable" }, { status: 503 });
    assert.equal(await firstUseAllowsExecution(), false);
    assert.equal(opens, 1);
    globalThis.fetch = async () => Response.json({ ok: true, state: createFirstUseState() });
    assert.equal(await firstUseAllowsExecution(), false);
    assert.equal(opens, 2);
    publishFirstUseExecutionState({ version: 1, revision: 8, step: "complete", outcome: "plan", defaults: { projectId: "p", familiarIds: ["sage"], actingFamiliarId: "sage" }, practice: { approvalHeld: true, stopped: true, retried: true, verified: true }, completedAt: "2026-11-11T00:00:00.000Z" });
    globalThis.fetch = async () => { throw new Error("known completion does not need another read"); };
    assert.equal(await firstUseAllowsExecution(), true);
    assert.equal(opens, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globals.window;
    else globals.window = originalWindow;
  }
});
