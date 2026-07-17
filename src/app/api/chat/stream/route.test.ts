import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GET } from "./route.ts";
import { openRunBuffer, resetRunBuffersForTest } from "@/lib/server/chat-stream-buffer";

// GET /api/chat/stream (cave-h40l): re-attach to a live chat run mid-turn.
// Behavior: 400 without a key, 404 for unknown runs (client falls back to
// post-hoc resync), SSE replay past the cursor with `id:` carrying the seq,
// live tailing, and stream close when the run finishes.

async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

test("400 without a key; 404 for unknown runs", async () => {
  resetRunBuffersForTest();
  const bad = await GET(new Request("http://127.0.0.1/api/chat/stream"));
  assert.equal(bad.status, 400);
  const missing = await GET(new Request("http://127.0.0.1/api/chat/stream?runId=ghost"));
  assert.equal(missing.status, 404);
  const body = (await missing.json()) as { ok: boolean };
  assert.equal(body.ok, false, "404 is a JSON miss the client can branch on");
});

test("replays past the cursor with seq ids, tails live events, closes on finish", async () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-sse", "conv-sse"]);
  handle.record({ kind: "user", text: "hi" });
  handle.record({ kind: "assistant_chunk", text: "partial " });

  const res = await GET(new Request("http://127.0.0.1/api/chat/stream?runId=conv-sse&cursor=1"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const drained = drain(res);
  // Tail two more live events, then finish — the stream must close itself.
  handle.record({ kind: "assistant_chunk", text: "reply" });
  handle.record({ kind: "done" });
  handle.finish();

  const text = await drained;
  assert.doesNotMatch(text, /"text":"hi"/, "events at or before the cursor do not replay");
  assert.match(text, /id: 2\ndata: \{"kind":"assistant_chunk","text":"partial "\}/, "replay carries the seq as the SSE id");
  assert.match(text, /id: 3\ndata: \{"kind":"assistant_chunk","text":"reply"\}/, "live events tail after the replay");
  assert.match(text, /"kind":"done"/, "the terminal event reaches the resumed client");
  resetRunBuffersForTest();
});

test("a finished run drains its replay and closes immediately", async () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-done"]);
  handle.record({ kind: "assistant_chunk", text: "all of it" });
  handle.record({ kind: "done" });
  handle.finish();

  const res = await GET(new Request("http://127.0.0.1/api/chat/stream?runId=run-done"));
  const text = await drain(res);
  assert.match(text, /all of it/);
  assert.match(text, /"kind":"done"/);
  resetRunBuffersForTest();
});

// ── Send-route wiring pins ────────────────────────────────────────────────────
// The buffer only works if the send route tees events BEFORE its
// closed/aborted guard (a dropped transport must keep recording) and pairs
// the detach-cap kill with the buffer's attach/detach hooks.
const send = readFileSync(new URL("../send/route.ts", import.meta.url), "utf8");

test("send route tees both harness stream paths through the run buffer", () => {
  const tees = send.match(/runBuffer\?\.record\(e(?:vent)?\);\s*\n\s*if \(closed \|\| (?:args\.)?req\.signal\.aborted\) return;/g);
  assert.equal(tees?.length, 2, "both push() implementations record before the closed/aborted guard");
  const opens = send.match(/openRunBuffer\(\[/g);
  assert.equal(opens?.length, 2, "both paths open a buffer under runId + conversation keys");
  const finishes = send.match(/runBuffer\?\.finish\(\)/g);
  assert.ok((finishes?.length ?? 0) >= 3, "every stream exit (error + close paths) finishes the buffer");
});

test("re-attach disarms the detach-cap kill; the last tail re-arms only after the original abort", () => {
  assert.match(
    send,
    /attach: \(\) => \{\s*if \(detachKillTimer != null\) \{\s*clearTimeout\(detachKillTimer\);\s*detachKillTimer = null;/,
    "attach hook cancels the pending kill",
  );
  const rearms = send.match(/detach: \(\) => \{\s*if \((?:args\.)?req\.signal\.aborted\) armDetachKill\(\);/g);
  assert.equal(rearms?.length, 2, "detach hooks re-arm only when the original request is gone — a resume tail closing can't kill a still-attached turn");
});
