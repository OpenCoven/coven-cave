/**
 * Token-usage and cost formatting for chat turns (CHAT-D12-02).
 *
 * Pure module — shared by the chat/send route (parsing the harness
 * stream-json `result` event), the conversation store round-trip, and the
 * chat UI's meta rows. No React, no Node APIs.
 */

export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Validated cost from an untrusted number-ish value. Zero is preserved
 *  (formatCost hides it at render time); negatives/NaN/non-numbers drop. */
export function parseCostUsd(raw: unknown): number | undefined {
  return finiteNonNegative(raw);
}

/** Parse the `usage` object from a Claude Code stream-json `result` event.
 *  Fields are optional and defensively validated — a malformed or empty
 *  usage block yields undefined so callers omit it entirely. */
export function parseStreamJsonUsage(raw: unknown): TurnUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const inputTokens = finiteNonNegative(u.input_tokens);
  const outputTokens = finiteNonNegative(u.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const cacheReadTokens = finiteNonNegative(u.cache_read_input_tokens);
  const cacheCreationTokens = finiteNonNegative(u.cache_creation_input_tokens);
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
  };
}

/** Validate a persisted camelCase usage shape (conversation POST/PUT
 *  round-trip — same defensive posture as the `cancelled` flag). */
export function normalizeTurnUsage(raw: unknown): TurnUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const inputTokens = finiteNonNegative(u.inputTokens);
  const outputTokens = finiteNonNegative(u.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const cacheReadTokens = finiteNonNegative(u.cacheReadTokens);
  const cacheCreationTokens = finiteNonNegative(u.cacheCreationTokens);
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
  };
}

/** Compact token count: 980 → "980", 1234 → "1.2k", 2_500_000 → "2.5M".
 *  Trailing ".0" is trimmed (1000 → "1k"). Invalid input → null. */
export function formatTokens(n: number): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return String(Math.round(n));
  const scaled = n < 1_000_000 ? n / 1000 : n / 1_000_000;
  const suffix = n < 1_000_000 ? "k" : "M";
  // Half-up to one decimal without toFixed's float drift (12350 → "12.4k");
  // integral results render bare ("1k", not "1.0k").
  return `${Math.round(scaled * 10) / 10}${suffix}`;
}

/** "$0.08"; "<$0.01" under a cent; null when zero, undefined, or invalid —
 *  a turn that cost nothing (or reported nothing) shows nothing. */
export function formatCost(usd?: number): string | null {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** One-line summary for meta rows: "12.4k tok · $0.08". Tokens are
 *  input+output summed for the compact form. Null when the harness emitted
 *  nothing (e.g. the OpenClaw bridge has no usage). */
export function usageSummary(
  usage?: TurnUsage,
  costUsd?: number,
): string | null {
  const parts: string[] = [];
  const total = usage ? usage.inputTokens + usage.outputTokens : 0;
  if (usage && total > 0) {
    const tokens = formatTokens(total);
    if (tokens) parts.push(`${tokens} tok`);
  }
  const cost = formatCost(costUsd);
  if (cost) parts.push(cost);
  return parts.length ? parts.join(" · ") : null;
}

/** Full breakdown for tooltips: every captured counter plus a higher-precision
 *  cost. Null when there is nothing to break down. */
export function usageBreakdown(
  usage?: TurnUsage,
  costUsd?: number,
): string | null {
  const parts: string[] = [];
  if (usage) {
    parts.push(`input ${usage.inputTokens}`, `output ${usage.outputTokens}`);
    if (usage.cacheReadTokens !== undefined) {
      parts.push(`cache read ${usage.cacheReadTokens}`);
    }
    if (usage.cacheCreationTokens !== undefined) {
      parts.push(`cache write ${usage.cacheCreationTokens}`);
    }
  }
  if (costUsd != null && Number.isFinite(costUsd) && costUsd > 0) {
    parts.push(`$${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}
