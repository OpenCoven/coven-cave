// Shared persistence for composer prompt-history (the ↑/↓ recall stack).
// Both the chat composer and the home composer keep an in-memory history of
// sent prompts; these helpers persist it to localStorage so ↑ still recalls
// past prompts after a page reload. Pure + SSR-guarded (no `node:` imports).

// Cap the stored history so localStorage can't grow without bound.
const HISTORY_CAP = 50;

export function readComposerHistory(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeComposerHistory(key: string, history: string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (history.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(history.slice(-HISTORY_CAP)));
  } catch {
    /* best effort */
  }
}
