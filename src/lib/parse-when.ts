import { computeNextOccurrence, type Recurrence } from "./inbox-recurrence.ts";

export type ParsedWhen = {
  fireAt: string;
  recurrence: Recurrence;
};

// ── Shared vocabulary ────────────────────────────────────────────────────────

const DOW_INDEX: Record<string, number> = {
  sun: 0, sunday: 0, sundays: 0,
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const DAY_WORDS = Object.keys(DOW_INDEX).join("|");
const MONTH_WORDS = Object.keys(MONTH_INDEX).join("|");

// "9", "9am", "9:30pm", "17:30", "noon", "midnight" — with an optional
// leading "at"/"@". Named times carry their own clock position.
const TIME_PART = String.raw`(?:(?:at|@)\s+)?(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|(noon|midday|midnight))`;
// A time the caller REQUIRES to be present (day/date forms with meridiem or
// minutes or a named word — plainly a time, not a bare number).

const SPELLED_COUNT: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15,
  twenty: 20, thirty: 30, "forty-five": 45, sixty: 60,
};
const COUNT_WORDS = Object.keys(SPELLED_COUNT).join("|");

const UNIT_PART = String.raw`(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)`;

// ── Regexes (anchored on both ends so splitWhenAndText can probe prefixes) ──

// in 30m | in 2 hours | in one hour | in half an hour | in 1h30m | in 1 week
const RE_IN = new RegExp(
  String.raw`^in\s+(?:(half)\s+(?:an?\s+)?hour|((?:\d+)|(?:${COUNT_WORDS}))\s*${UNIT_PART}(?:\s*(?:and\s+)?(\d+)\s*(m|mins?|minutes?))?)\s*$`,
  "i",
);
// today 9am | today at 17:30 | tonight | tomorrow noon | tomorrow at 9
const RE_TODAY = new RegExp(String.raw`^today\s+${TIME_PART}\s*$`, "i");
const RE_TONIGHT = /^tonight\s*$/i;
const RE_TOMORROW = new RegExp(String.raw`^tomorrow\s+${TIME_PART}\s*$`, "i");
const RE_AT = new RegExp(String.raw`^(?:at|@)\s+(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|(noon|midday|midnight))\s*$`, "i");
// friday 4pm | next wednesday at 9 | thurs 17:30
const RE_DOW_ONE = new RegExp(String.raw`^(?:next\s+)?(${DAY_WORDS})\s+${TIME_PART}\s*$`, "i");
// jul 20 | july 20th 9am | on jul 20 at 5pm | 7/20 17:00
const RE_DATE_MONTH = new RegExp(
  String.raw`^(?:on\s+)?(${MONTH_WORDS})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+${TIME_PART})?\s*$`,
  "i",
);
const RE_DATE_SLASH = new RegExp(
  String.raw`^(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\s+${TIME_PART})?\s*$`,
  "i",
);

// every 30m | every 2 hours
const RE_EVERY_INTERVAL = new RegExp(
  String.raw`^every\s+((?:\d+)|(?:${COUNT_WORDS}))?\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\s*$`,
  "i",
);
// every day 9am | daily at noon | every day at 17:30
const RE_EVERY_DAY = new RegExp(String.raw`^(?:every\s+day|daily|each\s+day)\s+${TIME_PART}\s*$`, "i");
// every weekday 9am | weekdays at 9
const RE_EVERY_WEEKDAY = new RegExp(String.raw`^(?:every\s+)?week\s?days?\s+${TIME_PART}\s*$`, "i");
// every weekend 10am | weekends at 10
const RE_EVERY_WEEKEND = new RegExp(String.raw`^(?:every\s+)?weekends?\s+${TIME_PART}\s*$`, "i");
// every tuesday 4pm | every mon and wed at 8 | mon,wed,fri 8:30 | every tue, thu 9:15
const DAY_LIST = String.raw`(${DAY_WORDS})((?:\s*(?:,|and|&)\s*(?:${DAY_WORDS}))*)`;
const RE_EVERY_DAYS = new RegExp(String.raw`^(?:every\s+)?${DAY_LIST}\s+${TIME_PART}\s*$`, "i");

// Time-first reorder: "9am every weekday" → "every weekday 9am".
const RE_TIME_FIRST = new RegExp(
  String.raw`^((?:at\s+|@\s*)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midday|midnight))\s+(every\s+.+|daily.*|weekdays?.*|weekends?.*)$`,
  "i",
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function unitMs(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("s")) return 1_000;
  if (u.startsWith("m")) return 60_000;
  if (u.startsWith("h")) return 3_600_000;
  if (u.startsWith("d")) return 86_400_000;
  if (u.startsWith("w")) return 7 * 86_400_000;
  return 0;
}

function countOf(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return SPELLED_COUNT[t] ?? null;
}

/**
 * Resolve the TIME_PART capture groups (hour, minute, meridiem, named) into
 * {hour, minute}, or null when the time is absent/invalid. A bare hour > 23
 * or minute > 59 fails closed. `named` handles noon/midday/midnight.
 */
function timeOf(
  hour: string | undefined,
  minute: string | undefined,
  meridiem: string | undefined,
  named: string | undefined,
): { hour: number; minute: number } | null {
  if (named) {
    const n = named.toLowerCase();
    return { hour: n === "midnight" ? 0 : 12, minute: 0 };
  }
  if (hour === undefined) return null;
  let h = Number(hour);
  const mi = minute === undefined ? 0 : Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || mi > 59) return null;
  const mer = meridiem?.toLowerCase();
  if (mer === "am" || mer === "pm") {
    if (h < 1 || h > 12) return null;
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return { hour: h, minute: mi };
}

function parseDayList(first: string, rest: string): number[] {
  const out: number[] = [];
  const push = (word: string) => {
    const idx = DOW_INDEX[word.trim().toLowerCase()];
    if (idx !== undefined && !out.includes(idx)) out.push(idx);
  };
  push(first);
  for (const m of rest.matchAll(new RegExp(`(${DAY_WORDS})`, "gi"))) push(m[1]);
  return out;
}

function weeklyFrom(days: number[], hour: number, minute: number, now: Date): ParsedWhen | null {
  if (days.length === 0) return null;
  const rec: Recurrence = { type: "weekly", days: days.slice().sort((a, b) => a - b), hour, minute };
  const next = computeNextOccurrence(rec, now.getTime());
  if (!next) return null;
  return { fireAt: next, recurrence: rec };
}

/**
 * Recognized (all local time; fail-closed — unrecognized input returns null):
 *   in 5s | in 30m | in 2 hours | in an hour | in half an hour | in 1h30m | in 1 week
 *   today 9am | today at 17:30 | tonight | tomorrow 9am | tomorrow at noon
 *   at 9am | at 17:30 | at midnight        (today if still future, else tomorrow)
 *   friday 9am | next wednesday at 4pm     (next-future weekday, one-shot)
 *   jul 20 | july 20th 9am | 7/20 17:00    (next-future date; 9:00 default)
 *   every 30m | every 2 hours              (interval; fireAt = first hit)
 *   every day 9am | daily at noon          (daily)
 *   every weekday 9am | weekdays at 9      (weekly, mon-fri)
 *   every weekend 10am | weekends at 10    (weekly, sat+sun)
 *   every tuesday 4pm | every mon and wed at 8 | mon,wed,fri 8:30  (weekly)
 *   9am every weekday                      (time-first reorder of the above)
 */
export function parseWhen(input: string, now: Date = new Date()): ParsedWhen | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;

  // Time-first recurrences reorder into canonical "<cadence> <time>" form.
  const reorder = text.match(RE_TIME_FIRST);
  if (reorder) return parseWhen(`${reorder[2]} ${reorder[1]}`, now);

  let m = text.match(RE_IN);
  if (m) {
    if (m[1]) {
      // "in half an hour"
      return { fireAt: new Date(now.getTime() + 30 * 60_000).toISOString(), recurrence: { type: "none" } };
    }
    const n = countOf(m[2]);
    const ms = unitMs(m[3]);
    if (n === null || !Number.isFinite(n) || n <= 0 || ms === 0) return null;
    let total = n * ms;
    // Compound tail: "in 1h30m" / "in 1 hour and 30 minutes".
    if (m[4]) {
      if (unitMs(m[3]) !== 3_600_000) return null; // tail minutes only follow hours
      total += Number(m[4]) * 60_000;
    }
    return { fireAt: new Date(now.getTime() + total).toISOString(), recurrence: { type: "none" } };
  }

  if (RE_TONIGHT.test(text)) {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= now.getTime()) return null;
    return { fireAt: d.toISOString(), recurrence: { type: "none" } };
  }

  m = text.match(RE_TODAY);
  if (m) {
    const t = timeOf(m[1], m[2], m[3], m[4]);
    if (!t) return null;
    const d = new Date(now);
    d.setHours(t.hour, t.minute, 0, 0);
    if (d.getTime() <= now.getTime()) return null;
    return { fireAt: d.toISOString(), recurrence: { type: "none" } };
  }

  m = text.match(RE_TOMORROW);
  if (m) {
    const t = timeOf(m[1], m[2], m[3], m[4]);
    if (!t) return null;
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(t.hour, t.minute, 0, 0);
    return { fireAt: d.toISOString(), recurrence: { type: "none" } };
  }

  m = text.match(RE_AT);
  if (m) {
    const t = timeOf(m[1], m[2], m[3], m[4]);
    if (!t) return null;
    const d = new Date(now);
    d.setHours(t.hour, t.minute, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return { fireAt: d.toISOString(), recurrence: { type: "none" } };
  }

  // every Nm/Nh — interval recurrence. fireAt = first hit (now + interval).
  m = text.match(RE_EVERY_INTERVAL);
  if (m) {
    const n = m[1] ? countOf(m[1]) : 1; // "every hour" → 1
    const ms = unitMs(m[2]);
    if (n === null || !Number.isFinite(n) || n <= 0 || ms === 0) return null;
    const everyMs = n * ms;
    return {
      fireAt: new Date(now.getTime() + everyMs).toISOString(),
      recurrence: { type: "interval", everyMs },
    };
  }

  m = text.match(RE_EVERY_DAY);
  if (m) {
    const t = timeOf(m[1], m[2], m[3], m[4]);
    if (!t) return null;
    const rec: Recurrence = { type: "daily", hour: t.hour, minute: t.minute };
    const next = computeNextOccurrence(rec, now.getTime());
    if (!next) return null;
    return { fireAt: next, recurrence: rec };
  }

  m = text.match(RE_EVERY_WEEKDAY);
  if (m) {
    const t = timeOf(m[1], m[2], m[3], m[4]);
    if (!t) return null;
    return weeklyFrom([1, 2, 3, 4, 5], t.hour, t.minute, now);
  }

  m = text.match(RE_EVERY_WEEKEND);
  if (m) {
    const t = timeOf(m[1], m[2], m[3], m[4]);
    if (!t) return null;
    return weeklyFrom([0, 6], t.hour, t.minute, now);
  }

  // "friday 9am" / "next wednesday at 4pm" → next-future weekday, ONE-SHOT.
  // Checked BEFORE RE_EVERY_DAYS so a bare day name isn't a 1-day recurrence;
  // an explicit "every …" prefix falls through to the recurrence branch.
  if (!text.startsWith("every ")) {
    m = text.match(RE_DOW_ONE);
    if (m) {
      const idx = DOW_INDEX[m[1]];
      const t = timeOf(m[2], m[3], m[4], m[5]);
      if (idx === undefined || !t) return null;
      const d = new Date(now);
      d.setHours(t.hour, t.minute, 0, 0);
      for (let i = 0; i < 8; i++) {
        if (d.getDay() === idx && d.getTime() > now.getTime()) {
          return { fireAt: d.toISOString(), recurrence: { type: "none" } };
        }
        d.setDate(d.getDate() + 1);
      }
      return null;
    }
  }

  // "every tuesday 4pm" | "mon,wed,fri 8:30" | "every mon and wed at 8".
  m = text.match(RE_EVERY_DAYS);
  if (m) {
    const days = parseDayList(m[1], m[2] ?? "");
    const t = timeOf(m[3], m[4], m[5], m[6]);
    if (days.length === 0 || !t) return null;
    return weeklyFrom(days, t.hour, t.minute, now);
  }

  // "jul 20 9am" | "july 20th" | "on jul 20 at 5pm" — next future occurrence.
  m = text.match(RE_DATE_MONTH);
  if (m) {
    const month = MONTH_INDEX[m[1]];
    const day = Number(m[2]);
    if (month === undefined || day < 1 || day > 31) return null;
    const t = timeOf(m[3], m[4], m[5], m[6]) ?? { hour: 9, minute: 0 };
    return dateOneShot(month, day, t, now);
  }

  // "7/20 17:00" — month/day (US order, matching the app's prose locale).
  m = text.match(RE_DATE_SLASH);
  if (m) {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const t = timeOf(m[3], m[4], m[5], m[6]) ?? { hour: 9, minute: 0 };
    return dateOneShot(month, day, t, now);
  }

  return null;
}

/** Next future <month day, time> (this year, else next). Rejects overflowing
 *  days (e.g. feb 30 → rolls the month) instead of silently rolling. */
function dateOneShot(
  month: number,
  day: number,
  t: { hour: number; minute: number },
  now: Date,
): ParsedWhen | null {
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const d = new Date(year, month, day, t.hour, t.minute, 0, 0);
    if (d.getMonth() !== month || d.getDate() !== day) return null; // overflowed
    if (d.getTime() > now.getTime()) {
      return { fireAt: d.toISOString(), recurrence: { type: "none" } };
    }
  }
  return null;
}

/**
 * Splits a "/remind" body into a when-phrase and the reminder text.
 * Greedy: tries the longest leading token sequence that parses; falls back
 * to no-when (returns null + full text).
 */
export function splitWhenAndText(
  body: string,
  now: Date = new Date(),
): { when: ParsedWhen | null; text: string } {
  const trimmed = body.trim();
  if (!trimmed) return { when: null, text: "" };
  const tokens = trimmed.split(/\s+/);
  // The widest form is 7 leading tokens ("every mon and wed at 8 am check…").
  for (let i = Math.min(tokens.length, 7); i >= 1; i--) {
    const candidate = tokens.slice(0, i).join(" ");
    const when = parseWhen(candidate, now);
    if (when) {
      const text = tokens.slice(i).join(" ").trim();
      return { when, text };
    }
  }
  return { when: null, text: trimmed };
}
