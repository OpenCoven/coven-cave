// @ts-nocheck
// The chat session's context row (Chat.dc.html 2a ③) must state facts, never
// invent them: a chip with no value doesn't render, and the cwd never repeats
// what the project chip already said.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chatContextChips,
  chatContextStats,
  formatContextDuration,
  shortContextModel,
} from "./chat-session-context.ts";

test("chips are dropped when the fact is unknown", () => {
  assert.deepEqual(chatContextChips({}), []);
  const ids = chatContextChips({
    projectName: "Coven Cave",
    projectRoot: "/Users/x/dev/coven-cave",
    branch: "main",
    model: "anthropic/claude-opus-5",
    runtime: "local:/Users/x/dev/coven-cave/.worktrees/wip",
  }).map((chip) => chip.id);
  assert.deepEqual(ids, ["project", "branch", "model", "cwd"]);
});

test("the cwd chip stays silent when the project already says it", () => {
  const chips = chatContextChips({
    projectName: "Coven Cave",
    projectRoot: "/Users/x/dev/coven-cave",
    runtime: "local:/Users/x/dev/coven-cave",
  });
  assert.deepEqual(chips.map((chip) => chip.id), ["project"]);
});

test("a worktree cwd under the project still earns its own chip", () => {
  const chips = chatContextChips({
    projectName: "Coven Cave",
    projectRoot: "/Users/x/dev/coven-cave",
    runtime: "local:/Users/x/dev/coven-cave/.worktrees/wip",
  });
  assert.deepEqual(chips.map((chip) => chip.id), ["project", "cwd"]);
});

test("the model chip drops the vendor and claude- prefixes", () => {
  assert.equal(shortContextModel("anthropic/claude-opus-5"), "opus-5");
  assert.equal(shortContextModel("openai/gpt-5.5"), "gpt-5.5");
  assert.equal(shortContextModel("gpt-5.5"), "gpt-5.5");
});

test("stats carry the context meter, tokens, cost and duration — each only when real", () => {
  assert.deepEqual(chatContextStats({}), []);
  const stats = chatContextStats({
    usage: { inputTokens: 12_000, outputTokens: 400 },
    costUsd: 0.08,
    durationMs: 38_000,
    model: "claude-opus-5",
  });
  assert.deepEqual(stats.map((stat) => stat.id), ["context", "tokens", "cost", "duration"]);
  const context = stats[0];
  assert.equal(typeof context.percent, "number");
  assert.match(context.title, /tokens/);
  assert.equal(stats[3].value, "38s");
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
