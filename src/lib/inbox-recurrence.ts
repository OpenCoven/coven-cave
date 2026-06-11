// Pure recurrence types + computation, extracted out of cave-inbox.ts so
// client components can reach them without dragging cave-inbox's top-level
// `node:fs/promises` import into the browser bundle. cave-inbox.ts keeps its
// own copies as the canonical server-side surface; this module is the
// client-safe twin. Keep the two definitions in sync.

import { nextCronFireFromLocal, parseCron } from "./cron.ts";

export type Recurrence =
  | { type: "none" }
  | { type: "interval"; everyMs: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; days: number[]; hour: number; minute: number }
  | { type: "cron"; expr: string };

/**
 * Returns the next fireAt (ISO) for a recurring schedule, or null for
 * one-shots / unrepresentable specs. All scheduling uses the local-time
 * semantics the user typed in (so daily 09:00 means 9am in their TZ).
 */
export function computeNextOccurrence(
  rec: Recurrence,
  fromMs: number,
): string | null {
  if (rec.type === "none") return null;
  if (rec.type === "interval") {
    return new Date(fromMs + rec.everyMs).toISOString();
  }
  if (rec.type === "daily") {
    const d = new Date(fromMs);
    d.setSeconds(0, 0);
    d.setHours(rec.hour, rec.minute, 0, 0);
    while (d.getTime() <= fromMs) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (rec.type === "weekly") {
    if (rec.days.length === 0) return null;
    const allowed = new Set(rec.days);
    const d = new Date(fromMs);
    d.setSeconds(0, 0);
    d.setHours(rec.hour, rec.minute, 0, 0);
    for (let i = 0; i < 14; i++) {
      if (d.getTime() > fromMs && allowed.has(d.getDay())) return d.toISOString();
      d.setDate(d.getDate() + 1);
    }
    return null;
  }
  if (rec.type === "cron") {
    const fields = parseCron(rec.expr);
    if (!fields) return null;
    return nextCronFireFromLocal(fields, fromMs);
  }
  return null;
}
