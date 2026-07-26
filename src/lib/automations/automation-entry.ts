// Pure, framework-free schedule formatting shared by reminder surfaces.
import type { Recurrence } from "../inbox-recurrence";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Human-readable trigger line for a reminder-style recurrence. Pure, and
 * clock-format agnostic (renders 24h "HH:MM"); the surface re-formats clock
 * times against the user's 12h/24h pref when it has the prefs hook.
 */
/** Default time formatter — fixed 24h `HH:MM`. Kept here so the pure module
 *  stays framework-free; UIs inject a clock-pref-aware formatter instead. */
const pad2Clock = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/**
 * Human schedule line for a Recurrence — the single source of truth for this
 * formatting. `formatTime` lets callers inject a clock-pref-aware time formatter
 * (the Automations view passes one that honors the 12h/24h preference); it
 * defaults to fixed 24h so this module — and its tests — stay framework-free.
 */
export function humanRecurrence(
  rec: Recurrence | undefined | null,
  formatTime: (hour: number, minute: number) => string = pad2Clock,
): string {
  if (!rec || rec.type === "none") return "One-time";
  if (rec.type === "interval") {
    const m = Math.round(rec.everyMs / 60000);
    if (m < 60) return `Every ${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `Every ${h}h`;
    return `Every ${Math.round(h / 24)}d`;
  }
  if (rec.type === "daily") return `Daily at ${formatTime(rec.hour, rec.minute)}`;
  if (rec.type === "weekly") {
    const days = rec.days.map((d) => WEEKDAY[d] ?? "?").join("/");
    return `${days} at ${formatTime(rec.hour, rec.minute)}`;
  }
  if (rec.type === "cron") return `Cron: ${rec.expr}`;
  return "Scheduled";
}
