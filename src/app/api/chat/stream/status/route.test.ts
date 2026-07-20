import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.ts";
import { openRunBuffer, resetRunBuffersForTest } from "../../../../../lib/server/chat-stream-buffer.ts";

async function readJson(res: Response): Promise<unknown> {
  return res.json();
}

test("returns 400 when runId and sessionId are missing or blank", async () => {
  resetRunBuffersForTest();
  const missing = await GET(new Request("http://127.0.0.1/api/chat/stream/status"));
  assert.equal(missing.status, 400);
  assert.deepEqual(await readJson(missing), { ok: false, error: "runId or sessionId required" });

  const blank = await GET(
    new Request("http://127.0.0.1/api/chat/stream/status?runId=%20%20&sessionId=%20%20"),
  );
  assert.equal(blank.status, 400);
  assert.deepEqual(await readJson(blank), { ok: false, error: "runId or sessionId required" });
});

test("looks up a new-chat buffer by runId", async () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-new-chat"]);
  handle.record({ kind: "assistant_chunk", text: "first" });

  const res = await GET(
    new Request("http://127.0.0.1/api/chat/stream/status?runId=%20run-new-chat%20"),
  );
  assert.equal(res.status, 200);
  assert.equal(
    ((await readJson(res)) as { status: { retainedEventCount: number } }).status.retainedEventCount,
    1,
  );
});

test("looks up an existing-session buffer by sessionId", async () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-status-route", "conv-status-route"]);
  handle.record({ kind: "assistant_chunk", text: "first" });
  handle.record({ kind: "assistant_chunk", text: "second" });

  const res = await GET(new Request("http://127.0.0.1/api/chat/stream/status?sessionId=%20conv-status-route%20"));
  assert.equal(res.status, 200);
  assert.equal(
    ((await readJson(res)) as { status: { retainedEventCount: number } }).status.retainedEventCount,
    2,
  );
});

test("prefers runId when both keys point to different buffers", async () => {
  resetRunBuffersForTest();
  const runHandle = openRunBuffer(["preferred-run"]);
  runHandle.record({ kind: "assistant_chunk", text: "run event" });
  const sessionHandle = openRunBuffer(["different-session"]);
  sessionHandle.record({ kind: "assistant_chunk", text: "session event 1" });
  sessionHandle.record({ kind: "assistant_chunk", text: "session event 2" });

  const res = await GET(
    new Request(
      "http://127.0.0.1/api/chat/stream/status?runId=%20preferred-run%20&sessionId=different-session",
    ),
  );
  assert.equal(res.status, 200);
  assert.equal(
    ((await readJson(res)) as { status: { retainedEventCount: number } }).status.retainedEventCount,
    1,
  );
});

test("returns null for an unknown buffer", async () => {
  resetRunBuffersForTest();
  const missing = await GET(new Request("http://127.0.0.1/api/chat/stream/status?runId=ghost"));
  assert.equal(missing.status, 200);
  assert.deepEqual(await readJson(missing), { ok: true, status: null });
});

test("returns payload-free metadata", async () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-payload-free"]);
  handle.record({ kind: "user", text: "secret payload" });

  const res = await GET(
    new Request("http://127.0.0.1/api/chat/stream/status?runId=run-payload-free"),
  );
  assert.equal(res.status, 200);
  const body = (await readJson(res)) as {
    ok: boolean;
    status: {
      done: boolean;
      oldestRetainedSeq: number | null;
      latestSeq: number;
      retainedEventCount: number;
      retainedBytes: number;
      hasEvictedEvents: boolean;
      liveTails: number;
    } | null;
  };
  assert.equal(body.ok, true);
  assert.deepEqual(body.status, {
    done: false,
    oldestRetainedSeq: 1,
    latestSeq: 1,
    retainedEventCount: 1,
    retainedBytes: JSON.stringify({ kind: "user", text: "secret payload" }).length,
    hasEvictedEvents: false,
    liveTails: 0,
  });
  assert.doesNotMatch(JSON.stringify(body), /secret payload|json/i, "the status payload must not leak buffered event text");
});
