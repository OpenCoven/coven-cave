// @ts-nocheck
import assert from "node:assert/strict";
import {
  MAX_CONVERSATION_TURNS,
  MAX_TURN_TEXT_CHARS,
  MAX_TURNS_PAYLOAD_BYTES,
  checkTurnBounds,
  sanitizeClientTurn,
  sanitizeClientTurns,
} from "./conversation-write-guards.ts";

function turn(role, text = "hi", extra = {}) {
  return { id: crypto.randomUUID(), role, text, createdAt: new Date().toISOString(), ...extra };
}

// --- checkTurnBounds ---

assert.equal(checkTurnBounds([turn("user")]), null, "small write is within bounds");
assert.equal(
  checkTurnBounds(Array.from({ length: MAX_CONVERSATION_TURNS }, () => turn("user"))),
  null,
  "exactly at the turn cap is allowed",
);
{
  const over = checkTurnBounds(Array.from({ length: MAX_CONVERSATION_TURNS + 1 }, () => turn("user")));
  assert.equal(over?.status, 413, "over the turn cap returns 413");
  assert.match(over.error, /too many turns/);
}
{
  const longText = "z".repeat(MAX_TURN_TEXT_CHARS + 1);
  const res = checkTurnBounds([turn("user", longText)]);
  assert.equal(res?.status, 413, "over-long turn text returns 413");
  assert.match(res.error, /text too long/);
}
{
  // Many medium turns whose serialized size blows the payload cap.
  const chunk = "z".repeat(50_000);
  const many = Array.from({ length: 200 }, () => turn("user", chunk));
  const res = checkTurnBounds(many);
  assert.equal(res?.status, 413, "over-size payload returns 413");
  assert.match(res.error, /payload too large/);
  // sanity: this really exceeds the byte cap
  assert.ok(Buffer.byteLength(JSON.stringify(many)) > MAX_TURNS_PAYLOAD_BYTES);
}

// --- sanitizeClientTurn: harness telemetry cannot be forged ---

{
  const forged = turn("assistant", "totally real", {
    usage: { inputTokens: 999, outputTokens: 999 },
    costUsd: 42,
    tools: [{ id: "t", name: "shell", status: "ok" }],
    reasoning: "fake chain of thought",
    durationMs: 1234,
    responseMetadata: { model: "spoofed" },
    harnessSessionId: "spoofed-session",
    attachments: [{ kind: "image" }],
  });
  const clean = sanitizeClientTurn(forged);
  for (const f of ["usage", "costUsd", "tools", "reasoning", "durationMs", "responseMetadata", "harnessSessionId"]) {
    assert.equal(f in clean, false, `assistant turn must not carry client-forged ${f}`);
  }
  // Non-telemetry content is preserved.
  assert.equal(clean.role, "assistant");
  assert.equal(clean.text, "totally real");
  assert.deepEqual(clean.attachments, [{ kind: "image" }], "attachments are kept");
  // Input is never mutated.
  assert.equal("usage" in forged, true, "sanitize must not mutate its input");
}
{
  const u = turn("user", "hello", { usage: { inputTokens: 1 }, costUsd: 5 });
  const clean = sanitizeClientTurn(u);
  // User turns pass through unchanged (harness never authors user telemetry,
  // and user turns legitimately carry no such fields — but we don't strip).
  assert.equal(clean, u, "user turns are returned unchanged (same reference)");
}
{
  const list = [turn("user"), turn("assistant", "x", { costUsd: 9 })];
  const clean = sanitizeClientTurns(list);
  assert.equal("costUsd" in clean[1], false, "list sanitize strips assistant telemetry");
}

console.log("conversation-write-guards.test.ts: ok");
