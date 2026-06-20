// Canonical relative-time formatter shared across surfaces (dashboard, daily
// report, journal, projects, …): compact "just now" / "2m ago" / "3h ago" /
// "1d ago" for the last week, then a short month/day date ("Jun 12"). Returns
// "" for null/undefined/invalid input.
//
// Pure and client-safe (no `node:` imports) so server pages, client components,
// and the browser-bundled tests can all import it. `now` accepts a number
// (epoch ms) or a Date, so callers can pass either without converting.

export function relativeTime(
  iso: string | null | undefined,
  now: number | Date = Date.now(),
): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const nowMs = typeof now === "number" ? now : now.getTime();
  const mins = Math.round((nowMs - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(then);
}

/**
 * True when `relativeTime`'s output is a relative phrase ("just now" / "… ago")
 * rather than its ≥7-day absolute "Mon D" fallback. Lets a caller that already
 * shows an absolute date suppress the relative span when it would just repeat it.
 */
export function isRelativePhrase(value: string): boolean {
  return value === "just now" || value.endsWith(" ago");
}
