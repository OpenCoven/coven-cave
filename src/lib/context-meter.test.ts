import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  computeContextMeter,
  contextUsedTokens,
  contextWindowForModel,
  formatContextMeter,
} from "./context-meter.ts";

test("contextWindowForModel resolves catalogued ids as known", () => {
  assert.deepEqual(contextWindowForModel("anthropic/claude-haiku-4-5"), {
    tokens: 200_000,
    known: true,
  });
  assert.deepEqual(contextWindowForModel("anthropic/claude-fable-5"), {
    tokens: 1_000_000,
    known: true,
  });
  assert.deepEqual(contextWindowForModel("anthropic/claude-fable-5-1"), {
    tokens: 1_000_000,
    known: true,
  });
  assert.deepEqual(contextWindowForModel("github/claude-fable-5.1"), {
    tokens: 1_000_000,
    known: true,
  });
  assert.deepEqual(contextWindowForModel("openai/gpt-6-astra"), {
    tokens: 1_000_000,
    known: true,
  });
  assert.deepEqual(contextWindowForModel("github/gpt-6-astra"), {
    tokens: 1_000_000,
    known: true,
  });
});

test("contextWindowForModel tolerates a bare model id (no provider prefix)", () => {
  assert.deepEqual(contextWindowForModel("claude-sonnet-4-6"), {
    tokens: 1_000_000,
    known: true,
  });
  assert.deepEqual(contextWindowForModel("github/claude-opus-5"), {
    tokens: 1_000_000,
    known: true,
  });
  assert.deepEqual(contextWindowForModel("anthropic/opus"), {
    tokens: 1_000_000,
    known: true,
  });
});

test("contextWindowForModel falls back for unknown / non-string ids", () => {
  assert.deepEqual(contextWindowForModel("acme/who-knows"), {
    tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    known: false,
  });
  assert.deepEqual(contextWindowForModel(undefined), {
    tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    known: false,
  });
  assert.deepEqual(contextWindowForModel(""), {
    tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    known: false,
  });
});

test("contextUsedTokens sums input + cache read + cache creation", () => {
  assert.equal(contextUsedTokens(undefined), 0);
  assert.equal(
    contextUsedTokens({ inputTokens: 1000, outputTokens: 500 }),
    1000,
  );
  assert.equal(
    contextUsedTokens({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 8000,
      cacheCreationTokens: 200,
    }),
    9200,
  );
});

test("computeContextMeter returns null when no tokens are in the window", () => {
  assert.equal(computeContextMeter(undefined, "anthropic/claude-haiku-4-5"), null);
  assert.equal(
    computeContextMeter({ inputTokens: 0, outputTokens: 0 }, "anthropic/claude-haiku-4-5"),
    null,
  );
});

test("computeContextMeter computes percent and level against the window", () => {
  // 90k of a 200k window = 45%, ok band.
  const m = computeContextMeter(
    { inputTokens: 90_000, outputTokens: 1_000 },
    "anthropic/claude-haiku-4-5",
  );
  assert.ok(m);
  assert.equal(m.usedTokens, 90_000);
  assert.equal(m.windowTokens, 200_000);
  assert.equal(m.percent, 45);
  assert.equal(m.level, "ok");
  assert.equal(m.known, true);
});

test("computeContextMeter bands warn at >=70% and high at >=90%", () => {
  const warn = computeContextMeter(
    { inputTokens: 150_000, outputTokens: 0 },
    "anthropic/claude-haiku-4-5",
  );
  assert.equal(warn?.level, "warn");
  assert.equal(warn?.percent, 75);

  const high = computeContextMeter(
    { inputTokens: 195_000, outputTokens: 0 },
    "anthropic/claude-haiku-4-5",
  );
  assert.equal(high?.level, "high");

  const full = computeContextMeter(
    { inputTokens: 200_000, outputTokens: 0 },
    "anthropic/claude-haiku-4-5",
  );
  assert.equal(full?.percent, 100);
  assert.equal(full?.level, "high");
});

test("computeContextMeter reads usage past the window as no fill reading at all", () => {
  // A prompt cannot be larger than the window that holds it, so more tokens
  // than the window means the harness reported a run total (every model call
  // summed), not one prompt. Clamping that to a red 100% invented a full window.
  assert.equal(
    computeContextMeter({ inputTokens: 500_000, outputTokens: 0 }, "anthropic/claude-haiku-4-5"),
    null,
  );
  // The Codex case from the ultrawide review: 10.9M against the 200k fallback.
  assert.equal(
    computeContextMeter(
      { inputTokens: 1_200_000, outputTokens: 40_000, cacheReadTokens: 9_700_000 },
      undefined,
    ),
    null,
  );
});

test("computeContextMeter marks unknown-model windows as estimates", () => {
  const m = computeContextMeter(
    { inputTokens: 50_000, outputTokens: 0 },
    "mystery/model",
  );
  assert.equal(m?.known, false);
  assert.equal(m?.windowTokens, DEFAULT_CONTEXT_WINDOW_TOKENS);
});

test("formatContextMeter renders a compact label", () => {
  const m = computeContextMeter(
    { inputTokens: 90_000, outputTokens: 0 },
    "anthropic/claude-haiku-4-5",
  );
  assert.equal(formatContextMeter(m), "45% · 90k/200k");
  assert.equal(formatContextMeter(null), null);
});
