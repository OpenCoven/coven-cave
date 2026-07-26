"use client";

import type { ReactNode } from "react";
import { relativeTime } from "@/lib/relative-time";
import { formatClock, formatDate, useDateTimePrefs } from "@/lib/datetime-format";

/**
 * Renders a relative timestamp ("5m ago") as a semantic <time> element, with an
 * exact, preference-aware absolute string in the title (hover) — e.g.
 * "Monday, June 16, 2026 at 1:31 PM". Subscribes to the date/time prefs so the
 * compact/verbose density (plus clock + date order) apply live.
 *
 * When `iso` is missing/invalid, renders `fallback` (carrying `className` so it
 * stays styled like the timestamp it replaces) — e.g. `fallback="never"` for a
 * familiar that has never run. Without a fallback it renders nothing.
 */
export function RelativeTime({
  iso,
  now,
  className,
  fallback = null,
}: {
  iso: string | null | undefined;
  now?: number;
  className?: string;
  fallback?: ReactNode;
}) {
  const prefs = useDateTimePrefs();
  const rel = iso ? relativeTime(iso, now, prefs.density) : "";
  if (!iso || !rel) return fallback != null ? <span className={className}>{fallback}</span> : null;
  const exact = `${formatDate(iso, prefs, { year: true, weekday: true })} at ${formatClock(iso, prefs)}`;
  return (
    <time dateTime={iso} title={exact} className={className}>
      {rel}
    </time>
  );
}
