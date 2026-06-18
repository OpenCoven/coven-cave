// @ts-nocheck
import assert from "node:assert/strict";
import {
  contextWindowForModel,
  computeContextMeter,
} from "./model-context-windows.ts";
import { contextTokens } from "./usage-format.ts";

// ── contextWindowForModel: exact catalog ids ───────────────────────────────
assert.equal(contextWindowForModel("anthropic/claude-opus-4-7")?.tokens, 200_000);
assert.equal(contextWindowForModel("openai/gpt-5.5")?.tokens, 400_000);
assert.equal(contextWindowForModel("nous/hermes-4")?.tokens, 128_000);

// ── pattern fallbacks for custom / free-text ids ───────────────────────────
assert.equal(contextWindowForModel("anthropic/claude-sonnet-9-9")?.tokens, 200_000);
assert.equal(contextWindowForModel("some-claude-thing")?.tokens, 200_000);
assert.equal(contextWindowForModel("openai/gpt-5-mini")?.tokens, 400_000);
assert.equal(contextWindowForModel("vendor/hermes-5")?.tokens, 128_000);

// ── unknown → null (meter must hide, never invent a denominator) ───────────
assert.equal(contextWindowForModel("totally/unknown-model"), null);
assert.equal(contextWindowForModel(""), null);
assert.equal(contextWindowForModel("unknown"), null);
assert.equal(contextWindowForModel(undefined), null);
assert.equal(contextWindowForModel(null), null);
assert.equal(contextWindowForModel(42), null);

// ── computeContextMeter: happy path ────────────────────────────────────────
{
  const m = computeContextMeter(50_000, "anthropic/claude-opus-4-7");
  assert.ok(m);
  assert.equal(m.used, 50_000);
  assert.equal(m.window, 200_000);
  assert.equal(m.percent, 25);
  assert.equal(m.fraction, 0.25);
}

// ── clamps over-window usage to 100% (never > 1) ───────────────────────────
{
  const m = computeContextMeter(500_000, "anthropic/claude-opus-4-7");
  assert.equal(m.fraction, 1);
  assert.equal(m.percent, 100);
}

// ── rounds used + percent ──────────────────────────────────────────────────
{
  const m = computeContextMeter(33_333.7, "anthropic/claude-haiku-4-5");
  assert.equal(m.used, 33_334);
  assert.equal(m.percent, 17);
}

// ── null when window unknown, even with real usage ─────────────────────────
assert.equal(computeContextMeter(10_000, "totally/unknown"), null);

// ── null when usage invalid, even with known window ────────────────────────
assert.equal(computeContextMeter(-1, "openai/gpt-5.5"), null);
assert.equal(computeContextMeter(Number.NaN, "openai/gpt-5.5"), null);
assert.equal(computeContextMeter("100", "openai/gpt-5.5"), null);
assert.equal(computeContextMeter(undefined, "openai/gpt-5.5"), null);

// zero usage is valid → 0%
{
  const m = computeContextMeter(0, "openai/gpt-5.5");
  assert.ok(m);
  assert.equal(m.percent, 0);
}

// ── contextTokens: prompt size = input + cache (NOT output) ─────────────────
assert.equal(contextTokens(undefined), 0);
assert.equal(contextTokens({ inputTokens: 100, outputTokens: 50 }), 100);
assert.equal(
  contextTokens({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheCreationTokens: 30 }),
  1030,
);

// ── end-to-end: usage → contextTokens → meter ──────────────────────────────
{
  const usage = { inputTokens: 20_000, outputTokens: 4_000, cacheReadTokens: 80_000 };
  const m = computeContextMeter(contextTokens(usage), "anthropic/claude-sonnet-4-6");
  assert.ok(m);
  assert.equal(m.used, 100_000); // 20k + 80k cache, output excluded
  assert.equal(m.percent, 50);
}

console.log("model-context-windows.test.ts ✓");
