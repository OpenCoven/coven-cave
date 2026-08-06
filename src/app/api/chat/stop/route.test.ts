import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.ts";
import {
  markChatRunSettled,
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

test("returns stopped:false once a run has already settled", async () => {
  let kills = 0;
  const handle = registerChatRun(["settled-route-run"], () => {
    kills += 1;
  });
  markChatRunSettled(handle);
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
