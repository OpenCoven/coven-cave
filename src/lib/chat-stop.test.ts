import assert from "node:assert/strict";
import test from "node:test";
import { stopChatRunWithRetry } from "./chat-stop.ts";

test("stopChatRunWithRetry retries an exact-run registration race until accepted", async () => {
  const controller = new AbortController();
  let attempts = 0;

  const result = await stopChatRunWithRetry({
    runId: "run-retry",
    controller,
    stopRun: async ({ runId }) => {
      attempts += 1;
      assert.equal(runId, "run-retry");
      return attempts === 1
        ? { ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null }
        : { ok: true, stopped: true, status: 200, state: "accepted", terminalOutcome: null };
    },
    sleep: async () => {},
  });

  assert.equal(attempts, 2);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(result, {
    runId: "run-retry",
    ok: true,
    stopped: true,
    status: 200,
    state: "accepted",
    terminalOutcome: null,
  });
});

test("stopChatRunWithRetry leaves local transport alone once the server already completed", async () => {
  const controller = new AbortController();

  const result = await stopChatRunWithRetry({
    runId: "run-complete",
    controller,
    stopRun: async () => ({
      ok: true,
      stopped: false,
      status: 200,
      state: "transport-settled",
      terminalOutcome: "completed",
    }),
  });

  assert.equal(controller.signal.aborted, false);
  assert.equal(result.terminalOutcome, "completed");
});

test("stopChatRunWithRetry aborts locally after a bounded timeout", async () => {
  const controller = new AbortController();
  let clock = 0;

  const result = await stopChatRunWithRetry({
    runId: "run-timeout",
    controller,
    stopRun: async () => ({ ok: true, stopped: false, status: 200, state: "not-found", terminalOutcome: null }),
    now: () => clock,
    sleep: async () => {
      clock += 50;
    },
    retryDelayMs: 50,
    timeoutMs: 100,
  });

  assert.equal(controller.signal.aborted, true);
  assert.equal(result.error, "stop timed out");
});

console.log("chat-stop.test.ts: ok");
