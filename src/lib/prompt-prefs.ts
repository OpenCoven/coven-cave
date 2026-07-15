import type { PromptOption } from "./slash-prompt.ts";

// Prompt-template preferences (cave-jg6k): favorites and a most-recently-used
// list, both Cave-local UI state (localStorage, chat-session-prefs pattern —
// the scanner and the daemon never learn about them). Pure order/toggle
// helpers so the pickers and the snippets modal share one ranking.

export const PROMPT_FAVORITES_KEY = "cave:prompt-favorites:v1";
export const PROMPT_RECENTS_KEY = "cave:prompt-recents:v1";

/** MRU cap — recents beyond this fall off the end. */
export const PROMPT_RECENTS_MAX = 8;

function readStringArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota/private-mode failures degrade to session-only prefs.
  }
}

/** Read favorite template ids; survives SSR and corrupt values. */
export function readPromptFavorites(): string[] {
  return readStringArray(PROMPT_FAVORITES_KEY);
}

/** Toggle membership; always returns a new array (state-setter friendly)
 *  and persists as a side effect. */
export function togglePromptFavorite(favorites: readonly string[], id: string): string[] {
  const next = favorites.includes(id)
    ? favorites.filter((f) => f !== id)
    : [...favorites, id];
  writeStringArray(PROMPT_FAVORITES_KEY, next);
  return next;
}

/** Read the MRU insert list, most recent first. */
export function readPromptRecents(): string[] {
  return readStringArray(PROMPT_RECENTS_KEY);
}

/** Record an insert: move-to-front, dedup, cap. Persists and returns the
 *  new list. */
export function recordPromptRecent(id: string): string[] {
  const next = [id, ...readPromptRecents().filter((r) => r !== id)].slice(
    0,
    PROMPT_RECENTS_MAX,
  );
  writeStringArray(PROMPT_RECENTS_KEY, next);
  return next;
}

/** Ranking shared by the inline picker and the snippets modal:
 *  favorites first, then recents (MRU order), then scan order. Stable within
 *  each partition; returns the input array untouched when prefs are empty so
 *  memoized consumers can bail. */
export function orderPrompts(
  prompts: PromptOption[],
  favorites: readonly string[],
  recents: readonly string[],
): PromptOption[] {
  if (!favorites.length && !recents.length) return prompts;
  const favSet = new Set(favorites);
  const recentRank = new Map(recents.map((id, i) => [id, i]));
  const fav: PromptOption[] = [];
  const recent: PromptOption[] = [];
  const rest: PromptOption[] = [];
  for (const p of prompts) {
    if (favSet.has(p.id)) fav.push(p);
    else if (recentRank.has(p.id)) recent.push(p);
    else rest.push(p);
  }
  recent.sort((a, b) => (recentRank.get(a.id) ?? 0) - (recentRank.get(b.id) ?? 0));
  return [...fav, ...recent, ...rest];
}

/** Distinct tags across the scanned templates, alphabetical, for filter
 *  chips. */
export function promptTags(prompts: PromptOption[]): string[] {
  const tags = new Set<string>();
  for (const p of prompts) for (const t of p.tags ?? []) tags.add(t);
  return [...tags].sort((a, b) => a.localeCompare(b));
}
