// @ts-nocheck
// The chat session's context row (Chat.dc.html 2a ③) must state facts, never
// invent them: a stat with no value doesn't render.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chatContextDetails,
  chatContextStats,
  formatContextDuration,
} from "./chat-session-context.ts";

test("detail cards aggregate successful tools, elapsed time and context composition", () => {
  const details = chatContextDetails({
    turns: [
      {
        role: "assistant",
        durationMs: 23 * 60_000 + 10_000,
        reasoning: "considered options",
        tools: [
          { name: "Bash", input: "pnpm test", status: "ok", durationMs: 10 * 60_000 },
          { name: "Read", status: "ok", durationMs: 5 * 60_000 },
          { name: "Edit", status: "error", durationMs: 2 * 60_000 },
          { name: "Bash", input: "gh pr view 42", status: "ok", durationMs: 30_000 },
        ],
      },
    ],
    usage: {
      inputTokens: 8_700,
      outputTokens: 2_600,
      cacheReadTokens: 4_100,
      cacheCreationTokens: 1_700,
    },
    model: "anthropic/claude-haiku-4-5",
  });

  assert.equal(details.done?.value, "3");
  assert.deepEqual(details.done?.rows.map((row) => [row.label, row.value]), [
    ["shell", "1 call"],
    ["read", "1 call"],
    ["github", "1 call"],
  ]);
  assert.equal(details.elapsed?.value, "23m 10s");
  assert.deepEqual(details.elapsed?.rows.map((row) => row.label), ["thinking", "tools"]);
  assert.equal(details.context?.value, "14.5k / 200k");
  assert.equal(details.context?.rows.at(-1)?.label, "free");
  assert.equal(details.context?.rows.at(-1)?.value, "185.5k");
});

test("stats carry the context meter, tokens, cost and duration — each only when real", () => {
  assert.deepEqual(chatContextStats({}), []);
  const stats = chatContextStats({
    turns: [{
      role: "assistant",
      durationMs: 38_000,
      tools: [{ name: "Read", status: "ok", durationMs: 4_000 }],
    }],
    usage: { inputTokens: 12_000, outputTokens: 400 },
    costUsd: 0.08,
    model: "claude-opus-5",
  });
  assert.deepEqual(stats.map((stat) => stat.id), ["done", "elapsed", "context", "tokens", "cost"]);
  const context = stats[2];
  assert.equal(typeof context.percent, "number");
  assert.match(context.title, /tokens/);
  assert.equal(stats[1].value, "38s");
});

test("a zero-cost, zero-token run reports nothing rather than zeroes", () => {
  const stats = chatContextStats({
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    model: "claude-opus-5",
  });
  assert.deepEqual(stats.map((stat) => stat.id), []);
});

test("duration reads in the row's compact grammar", () => {
  assert.equal(formatContextDuration(undefined), null);
  assert.equal(formatContextDuration(0), null);
  assert.equal(formatContextDuration(38_000), "38s");
  assert.equal(formatContextDuration(252_000), "4m 12s");
  assert.equal(formatContextDuration(3_780_000), "1h 03m");
});
