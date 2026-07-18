/**
 * Prompt → cron form updates. Turns a natural-language instruction (or a
 * classic five-field cron expression) into deterministic edits for the cron
 * detail / create forms: schedule (preset modes only), name, goals and
 * deliverables. Pure and React-free so the Schedules surfaces and unit tests
 * share it — no LLM round-trip, so "make it weekdays at 9am" applies
 * instantly and predictably.
 */

import { RRULE_DAY_ORDER } from "./codex-automation-form.ts";

export type CronPromptSchedule = {
  mode?: "daily" | "weekly";
  time?: string; // "HH:MM"
  days?: string[]; // RRULE codes, ordered SU..SA
};

export type CronPromptUpdate = {
  schedule?: CronPromptSchedule;
  name?: string;
  goals?: string;
  /** How to apply `goals`: replace the field or append as a new line. */
  goalsOp?: "replace" | "append";
  deliverables?: string;
  deliverablesOp?: "replace" | "append";
  /** Which fields the prompt touched, for the "Applied …" feedback line. */
  applied: ("schedule" | "name" | "goals" | "deliverables")[];
};

const DAY_CODES: Record<string, string> = {
  sun: "SU", sunday: "SU", sundays: "SU",
  mon: "MO", monday: "MO", mondays: "MO",
  tue: "TU", tues: "TU", tuesday: "TU", tuesdays: "TU",
  wed: "WE", weds: "WE", wednesday: "WE", wednesdays: "WE",
  thu: "TH", thur: "TH", thurs: "TH", thursday: "TH", thursdays: "TH",
  fri: "FR", friday: "FR", fridays: "FR",
  sat: "SA", saturday: "SA", saturdays: "SA",
};

const CRON_DOW: Record<string, string> = {
  "0": "SU", "1": "MO", "2": "TU", "3": "WE", "4": "TH", "5": "FR", "6": "SA", "7": "SU",
  sun: "SU", mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA",
};

function orderDays(days: Iterable<string>): string[] {
  const set = new Set(days);
  return RRULE_DAY_ORDER.filter((code) => set.has(code));
}

function to24h(rawHour: string, rawMinute: string | undefined, meridiem: string | undefined): string | null {
  let hour = Number(rawHour);
  const minute = rawMinute ? Number(rawMinute) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  const mer = meridiem?.toLowerCase().replace(/\./g, "");
  if (mer === "am" || mer === "pm") {
    if (hour < 1 || hour > 12) return null;
    if (mer === "pm" && hour !== 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// "at 9", "at 9am", "at 9:30 pm", "at 09:15", "@ 7pm"
const TIME_RE = /(?:\bat|@)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i;
const NOON_RE = /(?:\bat|@)\s+(noon|midday|midnight)\b/i;
// Bare "9am" / "9:30pm" (no "at") still reads as a time.
const BARE_TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i;

function parseTime(text: string): { time: string; consumed: string } | null {
  const named = NOON_RE.exec(text);
  if (named) {
    const word = named[1].toLowerCase();
    return { time: word === "midnight" ? "00:00" : "12:00", consumed: named[0] };
  }
  const at = TIME_RE.exec(text);
  if (at) {
    const time = to24h(at[1], at[2], at[3]);
    if (time) return { time, consumed: at[0] };
  }
  const bare = BARE_TIME_RE.exec(text);
  if (bare) {
    const time = to24h(bare[1], bare[2], bare[3]);
    if (time) return { time, consumed: bare[0] };
  }
  return null;
}

/** Expand one cron field ("*", "1-5", "1,3,5", "mon-fri") into RRULE day codes. */
function cronDowToDays(field: string): string[] | null {
  const f = field.toLowerCase();
  if (f === "*" || f === "?") return [];
  const out = new Set<string>();
  for (const part of f.split(",")) {
    const range = part.split("-");
    if (range.length === 2) {
      const a = cronDowIndex(range[0]);
      const b = cronDowIndex(range[1]);
      if (a === null || b === null) return null;
      if (a <= b) {
        for (let i = a; i <= b; i += 1) out.add(CRON_DOW[String(i)]);
      } else {
        // Wrapping range (e.g. fri-mon).
        for (let i = a; i <= 6; i += 1) out.add(CRON_DOW[String(i)]);
        for (let i = 0; i <= b; i += 1) out.add(CRON_DOW[String(i)]);
      }
    } else {
      const idx = cronDowIndex(part);
      if (idx === null) return null;
      out.add(CRON_DOW[String(idx)]);
    }
  }
  return orderDays(out);
}

function cronDowIndex(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n >= 0 && n <= 7) return n === 7 ? 0 : n;
    return null;
  }
  const code = CRON_DOW[t.slice(0, 3)];
  if (!code) return null;
  return RRULE_DAY_ORDER.indexOf(code);
}

// A classic five-field cron line: minute hour day-of-month month day-of-week.
const CRON_EXPR_RE = /(?:^|\s)(\d{1,2})\s+(\d{1,2})\s+(\*|\d{1,2})\s+(\*|\d{1,2})\s+(\S+)(?=\s|$)/;

function parseCronExpression(text: string): { schedule: CronPromptSchedule; consumed: string } | null {
  const m = CRON_EXPR_RE.exec(text);
  if (!m) return null;
  const [, minute, hour, dom, month] = m;
  // Only map expressions the preset scheduler can represent: fixed
  // minute/hour, any day-of-month/month restrictions fall back to prose.
  if (dom !== "*" || month !== "*") return null;
  if (Number(minute) > 59 || Number(hour) > 23) return null;
  const days = cronDowToDays(m[5]);
  if (days === null) return null;
  const time = `${String(Number(hour)).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;
  return {
    schedule: days.length === 0 ? { mode: "daily", time, days: [] } : { mode: "weekly", time, days },
    consumed: m[0],
  };
}

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR"];
const WEEKEND = ["SA", "SU"];

const DAY_WORD_RE = new RegExp(`\\b(${Object.keys(DAY_CODES).join("|")})\\b`, "gi");

function parseCadence(text: string): { days: string[] | null; mode: "daily" | "weekly" | null; consumed: string[] } {
  const consumed: string[] = [];
  const lower = text.toLowerCase();

  const daily = /\b(every\s+day|daily|each\s+day)\b/i.exec(text);
  if (daily) return { days: [], mode: "daily", consumed: [daily[0]] };

  if (/\b(every\s+)?week\s?days?\b/i.test(lower) || /\bmon(day)?\s*(-|–|through|to|thru)\s*fri(day)?\b/i.test(lower)) {
    const m = /\b(every\s+)?week\s?days?\b/i.exec(text) ?? /\bmon(day)?\s*(-|–|through|to|thru)\s*fri(day)?\b/i.exec(text);
    if (m) consumed.push(m[0]);
    return { days: [...WEEKDAYS], mode: "weekly", consumed };
  }
  if (/\b(every\s+)?weekends?\b/i.test(lower)) {
    const m = /\b(every\s+)?weekends?\b/i.exec(text);
    if (m) consumed.push(m[0]);
    return { days: orderDays(WEEKEND), mode: "weekly", consumed };
  }

  const days = new Set<string>();
  for (const m of text.matchAll(DAY_WORD_RE)) {
    days.add(DAY_CODES[m[1].toLowerCase()]);
    consumed.push(m[0]);
  }
  if (days.size > 0) return { days: orderDays(days), mode: "weekly", consumed };

  if (/\b(every\s+week|weekly)\b/i.test(lower)) {
    const m = /\b(every\s+week|weekly)\b/i.exec(text);
    if (m) consumed.push(m[0]);
    return { days: null, mode: "weekly", consumed }; // weekly, keep current days
  }
  return { days: null, mode: null, consumed };
}

// "name it Nightly triage" / "call it X" / "rename (it) to X" / "title: X"
const NAME_RE = /\b(?:name\s+it|call\s+it|rename(?:\s+it)?\s+to|name\s*:|title\s*:)\s*(?:["'“]([^"'”]+)["'”]|([^.,;\n]+))/i;
// Labeled sections override the leftover-text heuristic.
const GOALS_LABEL_RE = /\bgoals?\s*:\s*([^\n;]+(?:\n(?![a-z]+\s*:)[^\n]+)*)/i;
const DELIVERABLES_LABEL_RE = /\bdeliverables?\s*:\s*([^\n;]+(?:\n(?![a-z]+\s*:)[^\n]+)*)/i;

/**
 * Parse a natural-language (or cron-expression) instruction into form updates.
 * Returns null when nothing in the prompt is actionable.
 */
export function parseCronPrompt(input: string | null | undefined): CronPromptUpdate | null {
  const text = (input ?? "").trim();
  if (!text) return null;

  const applied: CronPromptUpdate["applied"] = [];
  const update: CronPromptUpdate = { applied };
  let remainder = text;
  const consume = (chunk: string) => {
    remainder = remainder.replace(chunk, " ");
  };

  // 1. Schedule — a raw cron expression wins, else cadence + time prose.
  const cronExpr = parseCronExpression(text);
  if (cronExpr) {
    update.schedule = cronExpr.schedule;
    consume(cronExpr.consumed);
    applied.push("schedule");
  } else {
    const cadence = parseCadence(text);
    const time = parseTime(text);
    if (cadence.mode || time) {
      // Partial on purpose: "at 5pm" alone must not flip the mode, and
      // "weekly" alone must not clobber the current day picks.
      update.schedule = {
        ...(cadence.mode ? { mode: cadence.mode } : {}),
        ...(time ? { time: time.time } : {}),
        ...(cadence.days !== null && cadence.mode
          ? { days: cadence.mode === "daily" ? [] : cadence.days }
          : {}),
      };
      for (const chunk of cadence.consumed) consume(chunk);
      if (time) consume(time.consumed);
      // Strip cadence connectives left behind ("every", "on", "and", "runs").
      remainder = remainder.replace(/\b(every|each|on|and|at|runs?|run\s+it|schedule(?:\s+it)?(?:\s+for)?)\b/gi, " ");
      applied.push("schedule");
    }
  }

  // 2. Name.
  const name = NAME_RE.exec(text);
  if (name) {
    const value = (name[1] ?? name[2] ?? "").trim();
    if (value) {
      update.name = value;
      consume(name[0]);
      applied.push("name");
    }
  }

  // 3. Labeled goals / deliverables.
  const goalsLabel = GOALS_LABEL_RE.exec(text);
  if (goalsLabel) {
    update.goals = goalsLabel[1].trim();
    update.goalsOp = "replace";
    consume(goalsLabel[0]);
    applied.push("goals");
  }
  const deliverablesLabel = DELIVERABLES_LABEL_RE.exec(text);
  if (deliverablesLabel) {
    update.deliverables = deliverablesLabel[1].trim();
    update.deliverablesOp = "replace";
    consume(deliverablesLabel[0]);
    applied.push("deliverables");
  }

  // 4. Whatever prose remains describes WHAT to do → goals (append so an
  //    update never silently clobbers hand-written instructions).
  if (!update.goals) {
    const leftover = remainder.replace(/\s+/g, " ").replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, "").trim();
    // Only meaningful prose (not a stray connective) becomes a goal line.
    if (leftover.length >= 8 && /[a-z]{3,}/i.test(leftover)) {
      update.goals = leftover;
      update.goalsOp = "append";
      applied.push("goals");
    }
  }

  return applied.length > 0 ? update : null;
}

/** Human-readable list for the "Applied: …" feedback line. */
export function describeCronPromptUpdate(update: CronPromptUpdate): string {
  const parts = update.applied.map((field) => (field === "schedule" ? "schedule" : field));
  return parts.join(", ");
}
