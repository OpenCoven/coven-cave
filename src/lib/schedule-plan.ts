// Pure helpers that turn a schedule (Recurrence + first fire) into the
// human-verifiable plan the UI echoes back: a cadence sentence and the next
// few concrete occurrences. Client-safe (no node imports) so the reminder
// modal — and any future scheduling surface — can render the plan live while
// the user types. The inverse of parse-when.ts: phrase → plan → phrase-shaped
// confirmation.

import { computeNextOccurrence, type Recurrence } from "./inbox-recurrence.ts";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatClock(hour: number, minute: number, hour12: boolean): string {
  if (!hour12) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const mer = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h} ${mer}` : `${h}:${String(minute).padStart(2, "0")} ${mer}`;
}

function formatInterval(everyMs: number): string {
  const seconds = Math.round(everyMs / 1000);
  if (seconds < 60) return `every ${seconds}s`;
  if (seconds % 60 !== 0) return `every ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `every ${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return hours === 1 ? "every hour" : `every ${hours} hours`;
  return `every ${minutes} min`;
}

/**
 * One human-readable sentence for a recurrence — the cadence half of the plan
 * echo ("every day at 9 AM", "weekly on Mon, Wed, Fri at 8:30 AM").
 * Returns null for one-shots (the fire time alone describes those).
 */
export function describeRecurrence(
  rec: Recurrence,
  opts: { hour12?: boolean } = {},
): string | null {
  const hour12 = opts.hour12 ?? true;
  if (rec.type === "none") return null;
  if (rec.type === "interval") return formatInterval(rec.everyMs);
  if (rec.type === "daily") return `every day at ${formatClock(rec.hour, rec.minute, hour12)}`;
  if (rec.type === "weekly") {
    const days = rec.days.slice().sort((a, b) => a - b);
    const key = days.join(",");
    const label =
      key === "1,2,3,4,5" ? "weekdays" :
      key === "0,6" ? "weekends" :
      key === "0,1,2,3,4,5,6" ? "every day" :
      days.map((d) => DAY_LABELS[d] ?? "?").join(", ");
    return `${label} at ${formatClock(rec.hour, rec.minute, hour12)}`;
  }
  if (rec.type === "cron") return `cron ${rec.expr}`;
  return null;
}

/**
 * The next `count` concrete fires for a recurrence, each step seeded from the
 * previous one (so interval schedules don't drift and weekly schedules walk
 * their day set). Returns fewer than `count` when the schedule can't produce
 * more (invalid cron, empty weekly days).
 */
export function nextOccurrences(
  rec: Recurrence,
  fromMs: number,
  count: number,
): string[] {
  const out: string[] = [];
  let cursor = fromMs;
  for (let i = 0; i < count; i++) {
    const next = computeNextOccurrence(rec, cursor);
    if (!next) break;
    out.push(next);
    const t = new Date(next).getTime();
    if (!Number.isFinite(t) || t <= cursor) break; // safety: never loop
    cursor = t;
  }
  return out;
}
