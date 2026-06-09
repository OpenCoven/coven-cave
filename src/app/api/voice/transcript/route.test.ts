// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-transcript-"));
process.env.HOME = TMP;

const SESSION_ID = "sess-tr";

function seedConv() {
  const dir = join(TMP, ".coven", "cave-conversations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify({
    sessionId: SESSION_ID, familiarId: "m", harness: "claude",
    createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
    turns: [],
  }));
}

function readConv() {
  return JSON.parse(readFileSync(join(TMP, ".coven", "cave-conversations", `${SESSION_ID}.json`), "utf8"));
}

const { POST } = await import("./route.ts");

function req(body: unknown) {
  return new Request("http://test/api/voice/transcript", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

test("400 when sessionId missing", async () => {
  const res = await POST(req({ callId: "c", role: "user", text: "x" }));
  assert.equal(res.status, 400);
});

test("400 when callId missing", async () => {
  const res = await POST(req({ sessionId: SESSION_ID, role: "user", text: "x" }));
  assert.equal(res.status, 400);
});

test("400 when role invalid", async () => {
  const res = await POST(req({ sessionId: SESSION_ID, callId: "c", role: "robot", text: "x" }));
  assert.equal(res.status, 400);
});

test("400 when text missing", async () => {
  const res = await POST(req({ sessionId: SESSION_ID, callId: "c", role: "user" }));
  assert.equal(res.status, 400);
});

test("400 invalid_session for unsafe sessionId", async () => {
  const res = await POST(req({ sessionId: "../bad", callId: "c", role: "user", text: "x" }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "invalid_session");
});

test("200 happy path appends a voice-origin turn", async () => {
  seedConv();
  const res = await POST(req({
    sessionId: SESSION_ID,
    callId: "call-xyz",
    role: "assistant",
    text: "How can I help?",
  }));
  assert.equal(res.status, 200);
  const conv = readConv();
  assert.equal(conv.turns.length, 1);
  assert.equal(conv.turns[0].role, "assistant");
  assert.equal(conv.turns[0].text, "How can I help?");
  assert.equal(conv.turns[0].origin, "voice");
  assert.equal(conv.turns[0].voiceCallId, "call-xyz");
});

test("a second call appends a second turn (no overwrite)", async () => {
  seedConv();
  await POST(req({ sessionId: SESSION_ID, callId: "c1", role: "user", text: "hi" }));
  await POST(req({ sessionId: SESSION_ID, callId: "c1", role: "assistant", text: "hi back" }));
  const conv = readConv();
  assert.equal(conv.turns.length, 2);
  assert.equal(conv.turns[0].role, "user");
  assert.equal(conv.turns[1].role, "assistant");
});
