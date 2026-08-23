import assert from "node:assert/strict";
import test from "node:test";

import { startDaemonFaultHarness, stressDaemonLifecycle } from "./daemon-fault-harness.ts";
import { classifyDaemonFailureAvailability } from "./daemon-status-classification.ts";
import { waitForDaemonReadiness } from "./daemon-readiness.ts";

// Every request in this file carries a deadline. A fault harness whose failure
// mode is "never responds" will hang the suite otherwise, and a hung suite is
// indistinguishable from a broken runner (cave-whm5).
const DEADLINE_MS = 2_000;

// Hang cases spend their whole duration waiting for a deadline that will never
// be beaten, so they get a short one. 2s each would put ~6s of pure sleeping in
// every CI run to prove something 150ms proves just as well. It stays well
// clear of loopback latency, so it is a tight bound rather than a flaky one.
const HANG_DEADLINE_MS = 150;

async function probeOnce(
  url: string,
  deadlineMs: number = DEADLINE_MS,
): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(deadlineMs),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    // Transport-level failure: no HTTP status exists, which is exactly the
    // `responseStatus: 0` the classifier distinguishes from an HTTP error.
    return { ok: false, status: 0 };
  }
}

test("a healthy daemon answers and leaves nothing open", async () => {
  const harness = await startDaemonFaultHarness({ mode: "healthy" });
  try {
    const result = await probeOnce(harness.url);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(harness.requestCount(), 1);
  } finally {
    await harness.close();
  }
  assert.equal(harness.openSocketCount(), 0, "close must reclaim every socket");
});

test("delayed readiness recovers on a request count, not a wall clock", async () => {
  const harness = await startDaemonFaultHarness({
    mode: "delayed-ready",
    delayedReadyAfter: 3,
  });
  try {
    assert.equal((await probeOnce(harness.url)).status, 503, "1st still starting");
    assert.equal((await probeOnce(harness.url)).status, 503, "2nd still starting");
    assert.equal((await probeOnce(harness.url)).status, 503, "3rd still starting");
    assert.equal((await probeOnce(harness.url)).status, 200, "4th is ready");
    // The point of counting rather than timing: this holds on a loaded runner.
    assert.equal((await probeOnce(harness.url)).status, 200, "and stays ready");
  } finally {
    await harness.close();
  }
});

test("the real readiness loop rides out a slow start and reports its attempts", async () => {
  const harness = await startDaemonFaultHarness({
    mode: "delayed-ready",
    delayedReadyAfter: 2,
  });
  try {
    const result = await waitForDaemonReadiness({
      probe: () => probeOnce(harness.url),
      timeoutMs: DEADLINE_MS,
      pollMs: 1,
      runnerExited: () => false,
    });
    assert.equal(result.ready, true);
    assert.equal(result.attempts, 3, "two refusals then the ready probe");
    assert.ok(result.elapsedMs >= 0);
  } finally {
    await harness.close();
  }
});

test("a hung daemon is bounded by the caller's deadline, and still closes", async () => {
  const harness = await startDaemonFaultHarness({ mode: "hang" });
  const startedAt = Date.now();
  try {
    const result = await probeOnce(harness.url, HANG_DEADLINE_MS);
    assert.equal(result.ok, false);
    assert.equal(result.status, 0, "a hang yields no HTTP status");
    assert.ok(
      Date.now() - startedAt < HANG_DEADLINE_MS * 10,
      "the client deadline, not the server, must end a hang",
    );
    assert.equal(harness.requestCount(), 1, "the request was received, just never answered");
  } finally {
    // The real regression guard: server.close() alone would wait on the hung
    // socket forever. If this ever hangs, the socket registry has regressed.
    await harness.close();
  }
  assert.equal(harness.openSocketCount(), 0);
});

test("readiness gives up on a permanently hung daemon instead of spinning", async () => {
  const harness = await startDaemonFaultHarness({ mode: "hang" });
  try {
    const result = await waitForDaemonReadiness({
      probe: () => probeOnce(harness.url, HANG_DEADLINE_MS),
      timeoutMs: 50,
      pollMs: 1,
      runnerExited: () => false,
    });
    assert.equal(result.ready, false);
    assert.ok(result.attempts >= 1);
  } finally {
    await harness.close();
  }
});

test("a partial body is a transport failure, not a parsed empty result", async () => {
  const harness = await startDaemonFaultHarness({ mode: "partial-response" });
  try {
    let parsed: unknown = "not-attempted";
    let threw = false;
    try {
      const response = await fetch(`${harness.url}/items`, {
        signal: AbortSignal.timeout(DEADLINE_MS),
      });
      parsed = await response.json();
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "a truncated body must surface, never parse as success");
    assert.equal(parsed, "not-attempted");
  } finally {
    await harness.close();
  }
});

test("a reset before any byte classifies as unreachable, not unhealthy", async () => {
  const harness = await startDaemonFaultHarness({ mode: "reset" });
  try {
    const result = await probeOnce(harness.url);
    assert.equal(result.status, 0);
    const availability = classifyDaemonFailureAvailability({
      targetMode: "local",
      responseStatus: result.status,
      reason: null,
    });
    assert.notEqual(availability, "unhealthy", "no HTTP status means no health verdict");
  } finally {
    await harness.close();
  }
});

test("a daemon that dies mid-session stops answering rather than resetting forever", async () => {
  const harness = await startDaemonFaultHarness({ mode: "crash-after", crashAfter: 1 });
  try {
    assert.equal((await probeOnce(harness.url)).status, 200, "first request is served");
    await probeOnce(harness.url); // the crash itself
    const afterCrash = await probeOnce(harness.url);
    assert.equal(afterCrash.status, 0, "a dead daemon refuses; it does not answer");
  } finally {
    await harness.close();
  }
});

test("401 and 403 classify as unauthorized on a hub, unhealthy locally", async () => {
  for (const mode of ["unauthorized", "forbidden"] as const) {
    const harness = await startDaemonFaultHarness({ mode });
    try {
      const { status } = await probeOnce(harness.url);
      assert.ok(status === 401 || status === 403);
      assert.equal(
        classifyDaemonFailureAvailability({ targetMode: "hub", responseStatus: status, reason: null }),
        "unauthorized",
      );
      // Locally there is no credential to be wrong, so the same status is a
      // sick daemon rather than a rejected caller — the distinction diagnostics
      // depend on.
      assert.equal(
        classifyDaemonFailureAvailability({ targetMode: "local", responseStatus: status, reason: null }),
        "unhealthy",
      );
    } finally {
      await harness.close();
    }
  }
});

test("an oversized body is delivered whole so a client cap has something to reject", async () => {
  const harness = await startDaemonFaultHarness({ mode: "oversized", oversizedBytes: 4096 });
  try {
    const response = await fetch(`${harness.url}/big`, {
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    const text = await response.text();
    assert.ok(text.length > 4096, "the harness must actually exceed the requested size");
  } finally {
    await harness.close();
  }
});

test("openSocketCount reflects real sockets, so the leak assertions can fail", async () => {
  // close() used to empty the registry outright, which made the count read 0
  // whether or not a socket survived — a leak detector that could not detect a
  // leak, which is worse than none because it reads as coverage. The fix is
  // that close() now awaits each socket's real "close" event instead.
  //
  // To be precise about what this test does and does not do: it pins that the
  // count is not identically zero, so a regression back to a stub is caught. It
  // would NOT by itself have caught the original bug, since both assertions
  // below also held under it. What makes the zero meaningful is close()'s wait.
  const harness = await startDaemonFaultHarness({ mode: "hang" });
  const inFlight = fetch(`${harness.url}/health`, {
    signal: AbortSignal.timeout(HANG_DEADLINE_MS),
  }).catch(() => undefined);

  // Wait for the server to actually accept the connection before observing.
  const deadline = Date.now() + 1_000;
  while (harness.openSocketCount() === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(
    harness.openSocketCount() > 0,
    "an accepted, unanswered connection must be visible in the count",
  );

  await inFlight;
  await harness.close();
  assert.equal(harness.openSocketCount(), 0, "and must drop to zero once closed");
});

test("repeated lifecycle churn leaks no sockets and rebinds cleanly", async () => {
  const { ports, leakedSockets } = await stressDaemonLifecycle({ cycles: 8 });
  assert.equal(leakedSockets, 0, "an orphaned socket after close is the leak this catches");
  assert.equal(ports.length, 8);
  assert.ok(
    ports.every((port) => Number.isInteger(port) && port > 0),
    "every cycle must bind a real port",
  );
});
