/**
 * Self-contained 5-field cron parser:  minute hour day month weekday
 *
 * Supported syntax per field:
 *   *           any
 *   N           exact
 *   N-M         range (inclusive)
 *   *\/S        step from start
 *   N-M/S       range with step
 *   N,M,O       list of any of the above
 *
 * Field ranges:
 *   minute   0-59
 *   hour     0-23
 *   day      1-31
 *   month    1-12
 *   weekday  0-6 (0=Sun, 6=Sat)
 *
 * Not supported (yet): macros (@daily, @reboot), L/W/# extensions, named
 * months/days. The parser returns null for any input it can't represent —
 * callers fall back to explicit input.
 */

export type CronFields = {
  minute: number[];
  hour: number[];
  day: number[];
  month: number[];
  weekday: number[];
};

const RANGES: Record<keyof CronFields, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  day: [1, 31],
  month: [1, 12],
  weekday: [0, 6],
};

function parseField(spec: string, name: keyof CronFields): number[] | null {
  const [lo, hi] = RANGES[name];
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) return null;

    // Step suffix /N
    let step = 1;
    let range = trimmed;
    const slash = trimmed.indexOf("/");
    if (slash >= 0) {
      step = Number(trimmed.slice(slash + 1));
      if (!Number.isFinite(step) || step <= 0) return null;
      range = trimmed.slice(0, slash);
    }

    let start: number;
    let end: number;
    if (range === "*") {
      start = lo;
      end = hi;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a < lo || b > hi || a > b) return null;
      start = a;
      end = b;
    } else {
      const v = Number(range);
      if (!Number.isFinite(v) || v < lo || v > hi) return null;
      if (slash >= 0) {
        // N/S → from N stepping by S to field max
        start = v;
        end = hi;
      } else {
        start = v;
        end = v;
      }
    }

    for (let n = start; n <= end; n += step) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, d, mo, w] = parts;
  const minute = parseField(m, "minute");
  const hour = parseField(h, "hour");
  const day = parseField(d, "day");
  const month = parseField(mo, "month");
  const weekday = parseField(w, "weekday");
  if (!minute || !hour || !day || !month || !weekday) return null;
  return { minute, hour, day, month, weekday };
}

/**
 * Find the next cron-allowed timestamp strictly after `fromMs`, using local
 * time semantics (so "0 9 * * 1-5" means 09:00 in the user's timezone).
 * Returns ISO string or null if no slot in the next 366 days (which would
 * indicate a contradictory expression like "0 0 30 2 *").
 */
export function nextCronFireFromLocal(
  fields: CronFields,
  fromMs: number,
): string | null {
  // Cron's day-of-month / day-of-week semantics: if BOTH are restricted
  // (neither is fully "*"), the slot matches when EITHER matches. If only one
  // is restricted, that one must match. Match the standard Vixie cron rule.
  const dowRestricted = fields.weekday.length !== 7;
  const domRestricted = fields.day.length !== 31;

  // Search at most 366 days ahead.
  for (let dayOffset = 0; dayOffset < 367; dayOffset++) {
    const d = new Date(fromMs);
    d.setSeconds(0, 0);
    d.setDate(d.getDate() + dayOffset);
    if (!fields.month.includes(d.getMonth() + 1)) continue;
    const dom = fields.day.includes(d.getDate());
    const dow = fields.weekday.includes(d.getDay());
    const dayOk = domRestricted && dowRestricted
      ? dom || dow
      : domRestricted
        ? dom
        : dowRestricted
          ? dow
          : true;
    if (!dayOk) continue;

    for (const hour of fields.hour) {
      for (const minute of fields.minute) {
        d.setHours(hour, minute, 0, 0);
        if (d.getTime() > fromMs) return d.toISOString();
      }
    }
  }
  return null;
}
