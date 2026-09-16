/**
 * Which asks the reader has already dismissed.
 *
 * Keys are `needsYouSeenKey` values — session id plus the instant the ask was
 * raised — so dismissing silences one ask rather than muting a session
 * forever. See `needs-you-inbox.ts` for why that distinction is load-bearing.
 *
 * Local, per-device, and deliberately not synced: "I have looked at this" is a
 * fact about one reader at one screen, and replaying it onto another device
 * would hide an ask nobody there has seen.
 *
 * Mirrors src/lib/code-reading-pref.ts: a small value in localStorage,
 * normalized on every read so a hand-edited or stale entry can never widen the
 * type or grow without bound.
 */

export const NEEDS_YOU_SEEN_KEY = "cave:needs-you:seen";

/**
 * Keep the most recent 256 dismissals.
 *
 * The set only ever needs to cover asks currently on screen; anything older has
 * either been answered or has been re-raised with a new key. Without a cap this
 * would be an append-only log in a 5MB origin quota — the failure mode that
 * already bit the avatar store.
 */
export const NEEDS_YOU_SEEN_LIMIT = 256;

function normalize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const key = entry.trim();
    if (!key) continue;
    // Re-dismissing moves a key to the most-recent end rather than duplicating
    // it, so the cap below evicts genuinely stale entries.
    const existing = seen.indexOf(key);
    if (existing >= 0) seen.splice(existing, 1);
    seen.push(key);
  }
  return seen.slice(-NEEDS_YOU_SEEN_LIMIT);
}

export function readNeedsYouSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(NEEDS_YOU_SEEN_KEY);
    if (!raw) return new Set();
    return new Set(normalize(JSON.parse(raw) as unknown));
  } catch {
    // Unparseable, private mode, or blocked site data. An empty set shows every
    // ask, which is the safe direction to fail: a duplicate prompt costs a
    // glance, a silently hidden one costs the whole point of the inbox.
    return new Set();
  }
}

export function writeNeedsYouSeen(keys: Iterable<string>): Set<string> {
  const bounded = normalize([...keys]);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(NEEDS_YOU_SEEN_KEY, JSON.stringify(bounded));
    } catch {
      // Quota or private mode. The set stays in component state for this
      // session; the dismissal simply does not survive a reload.
    }
  }
  return new Set(bounded);
}

/** Add dismissals to whatever is already stored, and persist the result. */
export function markNeedsYouSeen(
  existing: ReadonlySet<string>,
  keys: readonly string[],
): Set<string> {
  return writeNeedsYouSeen([...existing, ...keys]);
}
