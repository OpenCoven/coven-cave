// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-append-"));
process.env.HOME = TMP;

const { appendVoiceOriginTurn } = await import("./append-voice-turn.ts");

const SESSION_ID = "sess-app";

function seedConv() {
  const dir = join(TMP, ".coven", "cave-conversations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${SESSION_ID}.json`),
    JSON.stringify({
      sessionId: SESSION_ID,
      familiarId: "m",
      harness: "claude",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      turns: [
        { id: "t0", role: "user", text: "hello", createdAt: "2026-06-01T00:00:00Z" },
      ],
    }),
  );
}

function readConv() {
  const dir = join(TMP, ".coven", "cave-conversations");
  return JSON.parse(readFileSync(join(dir, `${SESSION_ID}.json`), "utf8"));
}

test("appends a turn with origin:voice and voiceCallId stamped", async () => {
  seedConv();
  await appendVoiceOriginTurn(SESSION_ID, {
    callId: "call-abc",
    role: "assistant",
    text: "I'm here.",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const conv = readConv();
  assert.equal(conv.turns.length, 2);
  const t = conv.turns[1];
  assert.equal(t.role, "assistant");
  assert.equal(t.text, "I'm here.");
  assert.equal(t.origin, "voice");
  assert.equal(t.voiceCallId, "call-abc");
  assert.equal(typeof t.id, "string");
  assert.ok(t.id.length > 0);
});

test("does not mutate prior turns", async () => {
  seedConv();
  await appendVoiceOriginTurn(SESSION_ID, {
    callId: "call-xyz",
    role: "user",
    text: "...",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const conv = readConv();
  assert.equal(conv.turns[0].id, "t0");
  assert.equal(conv.turns[0].role, "user");
  assert.equal(conv.turns[0].text, "hello");
  assert.equal(conv.turns[0].origin, undefined);
  assert.equal(conv.turns[0].voiceCallId, undefined);
});

test("does nothing when session file is missing (matches appendTurn behavior)", async () => {
  await appendVoiceOriginTurn("no-such-session", {
    callId: "call-1",
    role: "user",
    text: "x",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const dir = join(TMP, ".coven", "cave-conversations");
  assert.equal(existsSync(join(dir, "no-such-session.json")), false);
});
