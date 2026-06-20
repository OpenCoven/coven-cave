"use client";

import { relativeTime } from "@/lib/relative-time";
import { formatClock, formatDate, useDateTimePrefs } from "@/lib/datetime-format";

/**
 * Renders a relative timestamp ("5m ago") as a semantic <time> element, with an
 * exact, preference-aware absolute string in the title (hover) — e.g.
 * "Monday, June 16, 2026 at 1:31 PM". Subscribes to the date/time prefs so the
 * compact/verbose density (plus clock + date order) apply live.
 */
export function RelativeTime({
  iso,
  now,
  className,
}: {
  iso: string | null | undefined;
  now?: number;
  className?: string;
}) {
  const prefs = useDateTimePrefs();
  if (!iso) return null;
  const rel = relativeTime(iso, now, prefs.density);
  if (!rel) return null;
  const exact = `${formatDate(iso, prefs, { year: true, weekday: true })} at ${formatClock(iso, prefs)}`;
  return (
    <time dateTime={iso} title={exact} className={className}>
      {rel}
    </time>
  );
}
