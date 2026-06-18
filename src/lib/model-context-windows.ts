// Model id → context-window size (in tokens). Pure, dependency-free.
//
// Powers the chat composer's context meter: "how full is the model's context
// window right now". The honest contract is WYSIWYG — when we don't know a
// model's window we return `null` and the meter hides itself rather than
// inventing a denominator and showing a fabricated percentage.
//
// Like `runtime-models.ts`, the table below is a curated seed keyed to the
// model ids Cave ships in its catalog, with pattern fallbacks so custom /
// free-text ids still resolve. Windows are the documented *default* input
// budget for each family; opt-in extended-context betas (e.g. Anthropic's
// 1M-token beta) are intentionally not assumed here because the harness does
// not negotiate them by default. Update in one line as providers move.

export type ModelContextWindow = {
  /** Total context window in tokens (input budget the model accepts). */
  tokens: number;
  /** Short provenance note, surfaced in the meter tooltip. */
  note?: string;
};

/** Exact-id windows for the curated catalog (runtime-models.ts). */
const EXACT_WINDOWS: Record<string, ModelContextWindow> = {
  "anthropic/claude-fable-5": { tokens: 200_000 },
  "anthropic/claude-opus-4-7": { tokens: 200_000 },
  "anthropic/claude-sonnet-4-6": { tokens: 200_000, note: "200K default (1M beta not assumed)" },
  "anthropic/claude-haiku-4-5": { tokens: 200_000 },
  "openai/gpt-5.5": { tokens: 400_000 },
  "nous/hermes-4": { tokens: 128_000 },
};

/** Pattern fallbacks for ids outside the curated list (custom/free-text). The
 *  first match wins, so order from most specific to least. */
const PATTERN_WINDOWS: Array<{ pattern: RegExp; window: ModelContextWindow }> = [
  { pattern: /claude[\w.-]*(opus|sonnet|haiku|fable)/i, window: { tokens: 200_000, note: "Claude family default" } },
  { pattern: /\bclaude\b/i, window: { tokens: 200_000, note: "Claude family default" } },
  { pattern: /gpt-5/i, window: { tokens: 400_000, note: "GPT-5 family default" } },
  { pattern: /gpt-4\.1/i, window: { tokens: 1_000_000, note: "GPT-4.1 family default" } },
  { pattern: /gpt-4o|gpt-4-turbo/i, window: { tokens: 128_000, note: "GPT-4o family default" } },
  { pattern: /hermes/i, window: { tokens: 128_000, note: "Hermes family default" } },
];

/** Strip a leading `provider/` segment for matching, lowercased. Defensive
 *  against undefined / non-string / empty ids. */
function normalizeModelId(modelId: unknown): string | null {
  if (typeof modelId !== "string") return null;
  const trimmed = modelId.trim();
  if (!trimmed || trimmed === "unknown") return null;
  return trimmed;
}

/**
 * Resolve a model id to its context window, or `null` when unknown.
 *
 * Resolution order: exact catalog id → pattern fallback → null. Callers must
 * treat `null` as "hide the meter", never as a default window.
 */
export function contextWindowForModel(modelId: unknown): ModelContextWindow | null {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  const exact = EXACT_WINDOWS[id];
  if (exact) return exact;
  for (const { pattern, window } of PATTERN_WINDOWS) {
    if (pattern.test(id)) return window;
  }
  return null;
}

export type ContextMeter = {
  /** Tokens currently occupying the window (prompt size of the last turn). */
  used: number;
  /** Total window in tokens. */
  window: number;
  /** used / window, clamped to [0, 1]. */
  fraction: number;
  /** Whole-percent for display (0–100). */
  percent: number;
  note?: string;
};

/**
 * Build a context-meter reading from a used-token count and a model id.
 *
 * `usedTokens` should be the *prompt* size of the most recent turn (input +
 * cache-read + cache-creation) — that is the real amount of the window the
 * conversation currently occupies, not a running sum of every turn. Returns
 * `null` when the window is unknown or the used count is not a finite,
 * non-negative number, so the meter is shown only when both halves are real.
 */
export function computeContextMeter(usedTokens: unknown, modelId: unknown): ContextMeter | null {
  const window = contextWindowForModel(modelId);
  if (!window) return null;
  if (typeof usedTokens !== "number" || !Number.isFinite(usedTokens) || usedTokens < 0) {
    return null;
  }
  const fraction = Math.min(1, Math.max(0, usedTokens / window.tokens));
  return {
    used: Math.round(usedTokens),
    window: window.tokens,
    fraction,
    percent: Math.round(fraction * 100),
    ...(window.note ? { note: window.note } : {}),
  };
}
