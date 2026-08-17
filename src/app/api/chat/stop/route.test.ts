import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { POST } from "./route.ts";
import {
  MAX_PENDING_CHAT_STOPS,
  markChatRunTransportSettled,
  pendingChatStopCountForTests,
  registerChatRun,
  requestOrQueueChatStop,
  resetChatStopRegistryForTests,
  unregisterChatRun,
} from "@/lib/server/chat-stop-registry";

async function readJson(response: Response) {
  return response.json();
}

beforeEach(() => {
  resetChatStopRegistryForTests();
});

test("returns 400 when neither runId nor sessionId is present", async () => {
  const missing = await POST(new Request("http://127.0.0.1/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
  assert.equal(missing.status, 400);
  assert.deepEqual(await readJson(missing), { ok: false, error: "runId or sessionId required" });
});

test("stops a live run by either key", async () => {
  let kills = 0;
  const handle = registerChatRun(
    ["stop-route-run", "stop-route-session"],
    () => {
      kills += 1;
    },
    { runId: "stop-route-run" },
  );
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "stop-route-run" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: true, queued: false });
    assert.equal(handle.stopRequested, true, "route stop flips the shared handle");
    assert.equal(kills, 1, "route stop kills through the registry");
  } finally {
    unregisterChatRun(handle);
  }
});

test("preserves sessionId-only stop behavior without queueing", async () => {
  let kills = 0;
  const handle = registerChatRun(["session-route-run", "session-route-key"], () => {
    kills += 1;
  }, { runId: "session-route-run" });
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-route-key" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: true, queued: false });
    assert.equal(handle.stopRequested, true);
    assert.equal(kills, 1);
    assert.equal(pendingChatStopCountForTests(), 0);
  } finally {
    unregisterChatRun(handle);
  }
});

test("returns stopped:false once a run has already settled", async () => {
  let kills = 0;
  const handle = registerChatRun(
    ["settled-route-run"],
    () => {
      kills += 1;
    },
    { runId: "settled-route-run" },
  );
  markChatRunTransportSettled(handle);
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "settled-route-run" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: false, queued: false });
    assert.equal(handle.stopRequested, false, "late stop must not rewrite the settled outcome");
    assert.equal(kills, 0, "late stop must not kill after settlement");
  } finally {
    unregisterChatRun(handle);
  }
});

test("returns stopped:false and queued:false after a settled run unregisters", async () => {
  const handle = registerChatRun(
    ["unregistered-settled-route-run"],
    () => {
      throw new Error("settled run must not be killed");
    },
    { runId: "unregistered-settled-route-run" },
  );
  markChatRunTransportSettled(handle);
  unregisterChatRun(handle);

  const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "unregistered-settled-route-run" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, stopped: false, queued: false });
  assert.equal(pendingChatStopCountForTests(), 0);
});

test("a delayed old runId cannot stop a newer run that reused its session", async () => {
  let oldKills = 0;
  let newerKills = 0;
  const old = registerChatRun(
    ["old-route-run", "shared-route-session"],
    () => {},
    { runId: "old-route-run" },
  );
  const newer = registerChatRun(["new-route-run", "shared-route-session"], () => {
    newerKills += 1;
  }, { runId: "new-route-run" });
  unregisterChatRun(old);

  let delayedOld: ReturnType<typeof registerChatRun> | null = null;
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "old-route-run",
        sessionId: "shared-route-session",
      }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: false, queued: true });
    assert.equal(newer.stopRequested, false, "the newer session run remains untouched");
    assert.equal(newerKills, 0, "the delayed old run-scoped Stop cannot kill the newer run");
    delayedOld = registerChatRun(["old-route-run"], () => {
      oldKills += 1;
    }, { runId: "old-route-run" });
    assert.equal(delayedOld.stopRequested, true, "the queued intent remains scoped to the old run");
    assert.equal(oldKills, 1);
  } finally {
    if (delayedOld) unregisterChatRun(delayedOld);
    unregisterChatRun(newer);
  }
});

test("queues a runId Stop that arrives before registration", async () => {
  const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "setup-race-run" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, stopped: false, queued: true });
  assert.equal(pendingChatStopCountForTests(), 1);

  let kills = 0;
  const handle = registerChatRun(["setup-race-run", "setup-race-session"], () => {
    kills += 1;
  }, { runId: "setup-race-run" });
  try {
    assert.equal(handle.stopRequested, true);
    assert.equal(kills, 1, "registration consumes the queued Stop exactly once");
    assert.equal(pendingChatStopCountForTests(), 0);
  } finally {
    unregisterChatRun(handle);
  }
});

test("returns a retryable failure without evicting queued Stops at capacity", async () => {
  for (let index = 0; index < MAX_PENDING_CHAT_STOPS; index += 1) {
    assert.equal(requestOrQueueChatStop(`capacity-route-${index}`), "queued");
  }

  const full = await POST(new Request("http://127.0.0.1/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "capacity-route-overflow" }),
  }));
  assert.equal(full.status, 503);
  assert.deepEqual(await readJson(full), {
    ok: false,
    stopped: false,
    queued: false,
    retryable: true,
    error: "The pending Stop queue is full. Retry shortly.",
  });
  assert.equal(pendingChatStopCountForTests(), MAX_PENDING_CHAT_STOPS);

  const first = registerChatRun(["capacity-route-0"], () => {}, {
    runId: "capacity-route-0",
  });
  assert.equal(first.stopRequested, true, "the first acknowledged intent was not evicted");
  unregisterChatRun(first);

  const retry = await POST(new Request("http://127.0.0.1/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "capacity-route-overflow" }),
  }));
  assert.equal(retry.status, 200);
  assert.deepEqual(await readJson(retry), { ok: true, stopped: false, queued: true });
  assert.equal(pendingChatStopCountForTests(), MAX_PENDING_CHAT_STOPS);
});

test("does not queue a missing sessionId", async () => {
  const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "missing-route-session" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, stopped: false, queued: false });
  assert.equal(pendingChatStopCountForTests(), 0);
});
