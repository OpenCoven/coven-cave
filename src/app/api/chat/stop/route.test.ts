import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.ts";
import {
  markChatRunTransportSettled,
  registerChatRun,
  unregisterChatRun,
} from "@/lib/server/chat-stop-registry";

async function readJson(response: Response) {
  return response.json();
}

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
  const handle = registerChatRun(["stop-route-run", "stop-route-session"], () => {
    kills += 1;
  });
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "stop-route-run" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: true });
    assert.equal(handle.stopRequested, true, "route stop flips the shared handle");
    assert.equal(kills, 1, "route stop kills through the registry");
  } finally {
    unregisterChatRun(handle);
  }
});

test("valid runId stops only that exact run and never falls through to sessionId", async () => {
  let kills = 0;
  const live = registerChatRun(["live-route-run", "shared-route-session"], () => {
    kills += 1;
  });
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "retired-route-run", sessionId: "shared-route-session" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: false });
    assert.equal(live.stopRequested, false, "an old runId must not cancel a newer run that reused the session");
    assert.equal(kills, 0, "exact-run stop does not fall through to the session key");
  } finally {
    unregisterChatRun(live);
  }
});

test("falls back to sessionId only when runId is absent", async () => {
  let kills = 0;
  const live = registerChatRun(["legacy-route-run", "legacy-route-session"], () => {
    kills += 1;
  });
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "legacy-route-session" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: true });
    assert.equal(live.stopRequested, true, "legacy session-only stops still work when no runId is available");
    assert.equal(kills, 1);
  } finally {
    unregisterChatRun(live);
  }
});

test("returns stopped:false once a run has already settled", async () => {
  let kills = 0;
  const handle = registerChatRun(["settled-route-run"], () => {
    kills += 1;
  });
  markChatRunTransportSettled(handle);
  try {
    const response = await POST(new Request("http://127.0.0.1/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "settled-route-run" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, stopped: false });
    assert.equal(handle.stopRequested, false, "late stop must not rewrite the settled outcome");
    assert.equal(kills, 0, "late stop must not kill after settlement");
  } finally {
    unregisterChatRun(handle);
  }
});
