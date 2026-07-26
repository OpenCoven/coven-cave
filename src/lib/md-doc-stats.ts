/**
 * Markdown document stats — the word · char · ~token footer counts for the
 * MdEditor, mirroring the OpenKnowledge-style status line.
 *
 * Token count is a fast heuristic (~4 chars/token) — a footer hint, not a
 * billing-grade tokenizer.
 */

export type MdDocStats = { words: number; chars: number; tokens: number };

export function computeMdDocStats(text: string): MdDocStats {
  const chars = text.length;
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  const tokens = Math.ceil(chars / 4);
  return { words, chars, tokens };
}

export function formatMdDocStats(stats: MdDocStats): string {
  const plural = (n: number, unit: string) => `${n.toLocaleString()} ${unit}${n === 1 ? "" : "s"}`;
  return `${plural(stats.words, "word")} · ${plural(stats.chars, "char")} · ~${stats.tokens.toLocaleString()} tokens`;
}
