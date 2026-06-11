import { computeNextOccurrence, type Recurrence } from "./inbox-recurrence.ts";

export type ParsedWhen = {
  fireAt: string;
  recurrence: Recurrence;
};

// Anchored on both ends so splitWhenAndText can reliably probe prefixes.
const RE_IN = /^in\s+(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)\s*$/i;
const RE_TODAY = /^today\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
const RE_TOMORROW = /^tomorrow\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
const RE_AT = /^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;

// Phase 2 grammar
const RE_EVERY_INTERVAL =
  /^every\s+(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs)\s*$/i;
const RE_EVERY_DAY =
  /^every\s+day\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
const RE_EVERY_WEEKDAY =
  /^every\s+weekday\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
const RE_EVERY_WEEKEND =
  /^every\s+weekend\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
const RE_EVERY_DAYS =
  /^((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:\s*,\s*(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun))*)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
const RE_DOW_ONE =
  /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;

const DOW_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};

function unitMs(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("s")) return 1_000;
  if (u.startsWith("m")) return 60_000;
  if (u.startsWith("h")) return 3_600_000;
  if (u.startsWith("d")) return 86_400_000;
  return 0;
}

function normalizeHour(h: number, ampm: string | undefined): number {
  if (!ampm) return h;
  const lower = ampm.toLowerCase();
  if (lower === "am") return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

function parseDayList(spec: string): number[] {
  const out: number[] = [];
  for (const raw of spec.split(",")) {
    const k = raw.trim().toLowerCase();
    const idx = DOW_INDEX[k];
    if (idx === undefined) return [];
    if (!out.includes(idx)) out.push(idx);
  }
  return out;
}

/**
 * Recognized:
 *   in 5s | in 5m | in 2h | in 1d
 *   today 9am | today 17:30
 *   tomorrow 9am | tomorrow 17:30
 *   at 9am | at 17:30           (today if still future, else tomorrow)
 *   friday 9am | thu 17:30      (next-future weekday)
 *   every 30m | every 2h        (interval recurrence; fireAt = first hit)
 *   every day 9am               (daily recurrence)
 *   every weekday 9am           (weekly, mon-fri)
 *   every weekend 10am          (weekly, sat+sun)
 *   mon,wed,fri 8:30            (weekly, specific days)
 *
 * Returns null on no match — caller should fall back to explicit inputs.
 */
export function parseWhen(input: string, now: Date = new Date()): ParsedWhen | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  let m = text.match(RE_IN);
  if (m) {
    const n = Number(m[1]);
    const ms = unitMs(m[2]);
    if (!Number.isFinite(n) || ms === 0) return null;
    const fireAt = new Date(now.getTime() + n * ms).toISOString();
    return { fireAt, recurrence: { type: "none" } };
  }

  m = text.match(RE_TODAY);
  if (m) {
    const h = normalizeHour(Number(m[1]), m[3]);
    const mi = Number(m[2] ?? 0);
    const d = new Date(now);
    d.setHours(h, mi, 0, 0);
    if (d.getTime() <= now.getTime()) return null;
    return { fireAt: d.toISOString(), recurrence: { type: "none" } };
  }

  m = text.match(RE_TOMORROW);
  if (m) {
    const h = normalizeHour(Number(m[1]), m[3]);
    const mi = Number(m[2] ?? 0);
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(h, mi, 0, 0);
    return { fireAt: d.toISOString(), recurrence: { type: "none" } };
  }

  m = text.match(RE_AT);
  if (m) {
    const h = normalizeHour(Number(m[1]), m[3]);
    const mi = Number(m[2] ?? 0);
    const d = new Date(now);
    d.setHours(h, mi, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return { fireAt: d.toISOString(), recurrence: { type: "none" } };
  }

  // every Nm/Nh — interval recurrence. fireAt = first hit (now + interval).
  m = text.match(RE_EVERY_INTERVAL);
  if (m) {
    const n = Number(m[1]);
    const ms = unitMs(m[2]);
    if (!Number.isFinite(n) || ms === 0) return null;
    const everyMs = n * ms;
    return {
      fireAt: new Date(now.getTime() + everyMs).toISOString(),
      recurrence: { type: "interval", everyMs },
    };
  }

  // every day HH:MM
  m = text.match(RE_EVERY_DAY);
  if (m) {
    const h = normalizeHour(Number(m[1]), m[3]);
    const mi = Number(m[2] ?? 0);
    const rec: Recurrence = { type: "daily", hour: h, minute: mi };
    const next = computeNextOccurrence(rec, now.getTime());
    if (!next) return null;
    return { fireAt: next, recurrence: rec };
  }

  // every weekday HH:MM  (mon-fri)
  m = text.match(RE_EVERY_WEEKDAY);
  if (m) {
    const h = normalizeHour(Number(m[1]), m[3]);
    const mi = Number(m[2] ?? 0);
    const rec: Recurrence = {
      type: "weekly",
      days: [1, 2, 3, 4, 5],
      hour: h,
      minute: mi,
    };
    const next = computeNextOccurrence(rec, now.getTime());
    if (!next) return null;
    return { fireAt: next, recurrence: rec };
  }

  // every weekend HH:MM  (sat+sun)
  m = text.match(RE_EVERY_WEEKEND);
  if (m) {
    const h = normalizeHour(Number(m[1]), m[3]);
    const mi = Number(m[2] ?? 0);
    const rec: Recurrence = {
      type: "weekly",
      days: [0, 6],
      hour: h,
      minute: mi,
    };
    const next = computeNextOccurrence(rec, now.getTime());
    if (!next) return null;
    return { fireAt: next, recurrence: rec };
  }

  // friday 9am  → next-future Friday, one-shot. Checked BEFORE RE_EVERY_DAYS
  // so a single day name doesn't get treated as a 1-day weekly recurrence.
  m = text.match(RE_DOW_ONE);
  if (m) {
    const idx = DOW_INDEX[m[1]];
    if (idx === undefined) return null;
    const h = normalizeHour(Number(m[2]), m[4]);
    const mi = Number(m[3] ?? 0);
    const d = new Date(now);
    d.setHours(h, mi, 0, 0);
    for (let i = 0; i < 8; i++) {
      if (d.getDay() === idx && d.getTime() > now.getTime()) {
        return { fireAt: d.toISOString(), recurrence: { type: "none" } };
      }
      d.setDate(d.getDate() + 1);
    }
    return null;
  }

  // mon,wed,fri 8:30  → weekly recurrence on the listed days.
  m = text.match(RE_EVERY_DAYS);
  if (m) {
    const days = parseDayList(m[1]);
    if (days.length === 0) return null;
    const h = normalizeHour(Number(m[2]), m[4]);
    const mi = Number(m[3] ?? 0);
    const rec: Recurrence = { type: "weekly", days, hour: h, minute: mi };
    const next = computeNextOccurrence(rec, now.getTime());
    if (!next) return null;
    return { fireAt: next, recurrence: rec };
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
  // Phase 2 grammar can use up to 4 leading tokens ("every weekend 9am check…").
  for (let i = Math.min(tokens.length, 5); i >= 1; i--) {
    const candidate = tokens.slice(0, i).join(" ");
    const when = parseWhen(candidate, now);
    if (when) {
      const text = tokens.slice(i).join(" ").trim();
      return { when, text };
    }
  }
  return { when: null, text: trimmed };
}
