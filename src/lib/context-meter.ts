/**
 * Context-window "meter" math for the chat header (pure, dependency-light).
 *
 * The live context fill is read from the most recent assistant turn's usage —
 * the model's input side for that turn already encompasses the entire prior
 * conversation (history is re-sent, not additive), so it is the honest measure
 * of "how full is the window right now". Anthropic reports `input_tokens` as the
 * *uncached* remainder, so the full prompt size is input + cache-read +
 * cache-creation (see the prompt-caching docs). We sum all three.
 *
 * No React, no Node APIs — shared by the chat UI and unit tests.
 */

import { formatTokens, type TurnUsage } from "./usage-format.ts";

/** Fallback window when a model's size isn't catalogued — conservative so the
 *  meter never over-reports headroom for an unknown model. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

/**
 * Per-model context-window sizes (the full input budget), keyed by Cave's
 * namespaced model id. A one-line edit as providers ship new models; unknown
 * ids fall back to DEFAULT_CONTEXT_WINDOW_TOKENS via contextWindowForModel.
 *
 * Anthropic values are authoritative (Claude models catalog). OpenAI/Nous
 * values are best-effort estimates — flagged `known: false`-style via the
 * `known` flag only for ids absent from this map, so update these in place
 * rather than relying on the fallback.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI (codex runtime) — estimate; adjust when authoritative.
  "openai/gpt-5.5": 400_000,
  // Anthropic (claude runtime) — from the Claude models catalog.
  "anthropic/claude-fable-5": 1_000_000,
  "anthropic/claude-opus-4-8": 1_000_000,
  "anthropic/claude-opus-4-7": 1_000_000,
  "anthropic/claude-opus-4-6": 1_000_000,
  "anthropic/claude-sonnet-4-6": 1_000_000,
  "anthropic/claude-haiku-4-5": 200_000,
  // Nous (hermes runtime) — estimate.
  "nous/hermes-4": 128_000,
};

/** Resolve a model id to its context-window size. Tolerates a bare model id
 *  (no `provider/` prefix). `known` is false when we fell back to the default,
 *  so the UI can mark the meter as an estimate. */
export function contextWindowForModel(modelId: unknown): { tokens: number; known: boolean } {
  if (typeof modelId === "string" && modelId.trim()) {
    const id = modelId.trim();
    const exact = MODEL_CONTEXT_WINDOWS[id];
    if (exact) return { tokens: exact, known: true };
    const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
    for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      if (key === bare || key.endsWith(`/${bare}`)) return { tokens: value, known: true };
    }
  }
  return { tokens: DEFAULT_CONTEXT_WINDOW_TOKENS, known: false };
}

/** Tokens currently occupying the context window for a turn: the full prompt
 *  size = uncached input + cache-read + cache-creation. Output tokens are not
 *  counted (they become next turn's input, not this turn's window fill). */
export function contextUsedTokens(usage?: TurnUsage): number {
  if (!usage) return 0;
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  const cacheRead = Number.isFinite(usage.cacheReadTokens) ? (usage.cacheReadTokens ?? 0) : 0;
  const cacheCreation = Number.isFinite(usage.cacheCreationTokens) ? (usage.cacheCreationTokens ?? 0) : 0;
  return Math.max(0, input + cacheRead + cacheCreation);
}

export type ContextMeterLevel = "ok" | "warn" | "high";

export type ContextMeter = {
  usedTokens: number;
  windowTokens: number;
  /** 0..1, clamped. */
  fraction: number;
  /** 0..100, rounded. */
  percent: number;
  /** false when the window size came from the fallback (unknown model). */
  known: boolean;
  level: ContextMeterLevel;
};

/** Build the meter for a turn's usage against a model's window. Returns null
 *  when there's nothing to show (no usage / zero tokens — e.g. the OpenClaw
 *  bridge emits no usage). */
export function computeContextMeter(
  usage: TurnUsage | undefined,
  modelId: unknown,
): ContextMeter | null {
  const usedTokens = contextUsedTokens(usage);
  if (usedTokens <= 0) return null;
  const { tokens: windowTokens, known } = contextWindowForModel(modelId);
  const fraction = windowTokens > 0 ? Math.min(1, usedTokens / windowTokens) : 0;
  const percent = Math.round(fraction * 100);
  const level: ContextMeterLevel = fraction >= 0.9 ? "high" : fraction >= 0.7 ? "warn" : "ok";
  return { usedTokens, windowTokens, fraction, percent, known, level };
}

/** Compact one-line label, e.g. "45% · 90k/200k". Null when no meter. */
export function formatContextMeter(meter: ContextMeter | null): string | null {
  if (!meter) return null;
  const used = formatTokens(meter.usedTokens) ?? String(meter.usedTokens);
  const win = formatTokens(meter.windowTokens) ?? String(meter.windowTokens);
  return `${meter.percent}% · ${used}/${win}`;
}
