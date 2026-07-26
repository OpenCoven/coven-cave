export const RECENT_SEARCHES_KEY = "cave:search:recent:v1";
const RECENT_SEARCH_LIMIT = 5;

export type SearchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function normalize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const query = item.trim();
    const key = query.toLocaleLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    normalized.push(query);
    if (normalized.length === RECENT_SEARCH_LIMIT) break;
  }
  return normalized;
}

export function readRecentSearches(storage: SearchStorage): string[] {
  try {
    return normalize(JSON.parse(storage.getItem(RECENT_SEARCHES_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function recordRecentSearch(storage: SearchStorage, value: string): string[] {
  const query = value.trim();
  if (!query) return readRecentSearches(storage);
  const next = normalize([
    query,
    ...readRecentSearches(storage).filter((item) => item.toLocaleLowerCase() !== query.toLocaleLowerCase()),
  ]);
  try { storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}

export function clearRecentSearches(storage: SearchStorage): void {
  try { storage.removeItem(RECENT_SEARCHES_KEY); } catch { /* best effort */ }
}

