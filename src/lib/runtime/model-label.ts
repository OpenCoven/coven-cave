// Shared, glanceable model presentation used by session lists and roll-ups.
// `modelLabel` turns a raw model id ("claude-opus-4-8[1m]", "gpt-5-codex") into
// a short human label ("Opus 4.8", "Codex"); `modelIcon` picks a family glyph.
// Pure and client-safe (no `node:` imports) so every surface can share it.

import type { IconName } from "@/lib/icon";

const FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;

function capitalize(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** A short, human-friendly label for a model id. Returns "" for empty input. */
export function modelLabel(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  // First version-ish token, e.g. "4-8" / "4.8" → "4.8" (ignores a trailing
  // build date like "-20251001" because the first match wins).
  const version = (lower.match(/\d+(?:[.\-]\d+)?/)?.[0] ?? "").replace("-", ".");
  for (const family of FAMILIES) {
    if (lower.includes(family)) return version ? `${capitalize(family)} ${version}` : capitalize(family);
  }
  if (lower.includes("codex")) return "Codex";
  if (lower.includes("gpt")) return version ? `GPT-${version}` : "GPT";
  // Unknown model: drop a provider prefix ("anthropic/…") and a bracket suffix
  // ("…[1m]") so the raw id at least reads cleanly.
  return raw.replace(/^[a-z0-9.]+\//i, "").replace(/\s*\[[^\]]*\]\s*$/, "");
}

/** A family glyph for a model id (sparkle for Claude, robot for GPT/Codex). */
export function modelIcon(model: string | null | undefined): IconName {
  const m = (model ?? "").toLowerCase();
  if (m.includes("gpt") || m.includes("openai") || m.includes("codex")) return "ph:robot";
  if (m.includes("claude") || FAMILIES.some((f) => m.includes(f))) return "ph:sparkle";
  return "ph:cube-bold";
}
