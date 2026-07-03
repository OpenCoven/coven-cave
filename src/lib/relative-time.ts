// Canonical relative-time formatter shared across surfaces (dashboard, daily
// report, journal, projects, …): compact "just now" / "2m ago" / "3h ago" /
// "1d ago" for the last week, then a short month/day date ("Jun 12"). Returns
// "" for null/undefined/invalid input.
//
// Pure and client-safe (no `node:` imports) so server pages, client components,
// and the browser-bundled tests can all import it. `now` accepts a number
// (epoch ms) or a Date, so callers can pass either without converting.

// Relative-time "density" preference. Read localStorage directly (not via the
// "use client" datetime-format store) so this module stays pure and server-safe.
// The key MUST match DATETIME_DENSITY_KEY in datetime-format.ts.
// "bare" = compact thresholds without the " ago" suffix — used for dense row
// timestamps (chat sidebar). Not user-selectable: readDensity() never returns it.
type DensityFormat = "compact" | "verbose" | "bare";

function readDensity(): DensityFormat {
  if (typeof window === "undefined") return "compact";
  try {
    return window.localStorage.getItem("cave:datetime-density") === "verbose" ? "verbose" : "compact";
  } catch {
    return "compact";
  }
}

export function relativeTime(
  iso: string | null | undefined,
  now: number | Date = Date.now(),
  density: DensityFormat = readDensity(),
): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const nowMs = typeof now === "number" ? now : now.getTime();
  const mins = Math.round((nowMs - then) / 60000);
  if (mins < 1) return "just now";
  const verbose = density === "verbose";
  const suffix = density === "bare" ? "" : " ago";
  if (mins < 60) return verbose ? `${mins} ${mins === 1 ? "minute" : "minutes"} ago` : `${mins}m${suffix}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return verbose ? `${hours} ${hours === 1 ? "hour" : "hours"} ago` : `${hours}h${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 7) return verbose ? `${days} ${days === 1 ? "day" : "days"} ago` : `${days}d${suffix}`;
  // Past a week, show an absolute date. Long month when verbose; include the year
  // when it is not the current year, so e.g. "Jan 5, 2025" is not ambiguous.
  const sameYear = new Date(then).getFullYear() === new Date(nowMs).getFullYear();
  return new Intl.DateTimeFormat([], {
    month: verbose ? "long" : "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(then);
}

/**
 * True when `relativeTime`'s output is a relative phrase ("just now" / "… ago")
 * rather than its ≥7-day absolute "Mon D" fallback. Lets a caller that already
 * shows an absolute date suppress the relative span when it would just repeat it.
 * Bare-density output ("2m") is never fed here — bare is a row-timestamp
 * format whose callers don't do phrase suppression.
 */
export function isRelativePhrase(value: string): boolean {
  return value === "just now" || value.endsWith(" ago");
}

/**
 * Bidirectional, density-aware relative time: "2m ago" / "in 5m" (compact) or
 * "2 minutes ago" / "in 5 minutes" (verbose); "just now"/"soon" under a minute;
 * an absolute date past ~a week. Unlike `relativeTime` (past-only), this also
 * formats future instants — used for next-fire schedule times.
 */
export function relativeTimeSigned(
  iso: string | null | undefined,
  now: number | Date = Date.now(),
  density: DensityFormat = readDensity(),
): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const nowMs = typeof now === "number" ? now : now.getTime();
  const deltaMs = nowMs - then; // >0 past, <0 future
  const future = deltaMs < 0;
  const deltaMin = Math.round(Math.abs(deltaMs) / 60000);
  const m = deltaMin;
  const verbose = density === "verbose";
  const phrase = (n: number, compactUnit: string, verboseUnit: string): string => {
    const body = verbose ? `${n} ${n === 1 ? verboseUnit : verboseUnit + "s"}` : `${n}${compactUnit}`;
    return future ? `in ${body}` : `${body} ago`;
  };
  if (m < 1) return future ? "soon" : "just now";
  if (m < 60) return phrase(m, "m", "minute");
  const hours = Math.round(m / 60);
  if (hours < 24) return phrase(hours, "h", "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return phrase(days, "d", "day");
  const sameYear = new Date(then).getFullYear() === new Date(nowMs).getFullYear();
  return new Intl.DateTimeFormat([], {
    month: verbose ? "long" : "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(then);
}
