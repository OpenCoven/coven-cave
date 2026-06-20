// @ts-nocheck
import assert from "node:assert/strict";
import { modelLabel, modelIcon } from "./model-label.ts";

// ── modelLabel ──
assert.equal(modelLabel("claude-opus-4-8"), "Opus 4.8", "Claude family + version");
assert.equal(modelLabel("claude-opus-4-8[1m]"), "Opus 4.8", "bracket suffix is ignored");
assert.equal(modelLabel("claude-sonnet-4-6"), "Sonnet 4.6", "Sonnet family");
assert.equal(modelLabel("claude-haiku-4-5-20251001"), "Haiku 4.5", "build date is ignored");
assert.equal(modelLabel("claude-fable-5"), "Fable 5", "Fable family");
assert.equal(modelLabel("gpt-5-codex"), "Codex", "codex wins over gpt");
assert.equal(modelLabel("gpt-5"), "GPT-5", "GPT family + version");
assert.equal(modelLabel("anthropic/some-future-model"), "some-future-model", "provider prefix dropped");
assert.equal(modelLabel(""), "", "empty input yields empty label");
assert.equal(modelLabel(null), "", "null input yields empty label");

// ── modelIcon ──
assert.equal(modelIcon("claude-opus-4-8"), "ph:sparkle", "Claude → sparkle");
assert.equal(modelIcon("gpt-5-codex"), "ph:robot", "GPT/Codex → robot");
assert.equal(modelIcon("mystery-model"), "ph:cube-bold", "unknown → cube");

console.log("model-label.test.ts: ok");
