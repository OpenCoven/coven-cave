// A schedule preview in the zone Coven runs the automation in (#5217).
//
// Coven's scheduler is the authority on when a routine fires. This preview is
// Cave's reading of the same rule, computed in the routine's canonical time
// zone rather than the viewer's clock, so a person can check a schedule before
// resuming it. It never decides what Coven does at a clock change: a wall time
// that does not exist, or happens twice, is reported as a warning for the
// person to check, not resolved here.
//
// Pure and client-safe. Only the rules native routines accept are previewed:
// FREQ=DAILY or WEEKLY, BYHOUR, and BYDAY for weekly (see schedule-plan-model).

import { recurrenceFromRrule } from "../schedule-plan-model.ts";

export type ScheduleOccurrence = {
  /** The instant, as an ISO string. */
  at: string;
  /** Minutes the zone is ahead of UTC at that instant. */
  offsetMinutes: number;
  /** The wall time happens twice that day; this is the earlier instant. */
  repeated: boolean;
};

export type ScheduleWarning =
  /** The zone's UTC offset changes between two runs. */
  | { kind: "offset-change"; at: string; fromOffsetMinutes: number; toOffsetMinutes: number }
  /** On this local date the scheduled wall time does not exist (clocks skip ahead). */
  | { kind: "nonexistent"; date: string }
  /** On this local date the scheduled wall time happens twice (clocks fall back). */
  | { kind: "repeated"; date: string; at: string };

export type SchedulePreview =
  | { kind: "parsed"; zone: string; occurrences: ScheduleOccurrence[]; warnings: ScheduleWarning[] }
  | { kind: "unparsed" }
  | { kind: "invalid-zone"; zone: string };

export const SCHEDULE_PREVIEW_COUNT = 5;
/** How far ahead clock changes are looked for, so a warning arrives before the run it affects. */
export const SCHEDULE_PREVIEW_HORIZON_DAYS = 370;
const MAX_WARNINGS = 4;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The zone name a preview uses, or null when the runtime does not know it. */
export function canonicalPreviewZone(zone: string): string | null {
  const name = zone === "utc" || zone === "UTC" ? "UTC" : zone;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function wallTime(ms: number, zone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
}

function offsetMinutes(ms: number, zone: string): number {
  const wall = wallTime(ms, zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

function sameWall(a: WallTime, b: WallTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/** Every instant at which `zone` shows this wall time: none in a gap, two in an overlap. */
function instantsFor(wall: WallTime, zone: string): number[] {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // A zone's offset on either side of any transition near this wall time.
  const offsets = new Set([offsetMinutes(naive - 14 * HOUR_MS, zone), offsetMinutes(naive + 14 * HOUR_MS, zone)]);
  const instants = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive - offset * 60_000;
    if (sameWall(wallTime(candidate, zone), wall)) instants.add(candidate);
  }
  return [...instants].sort((a, b) => a - b);
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The next {@link SCHEDULE_PREVIEW_COUNT} runs of `rrule` after `fromMs`, read
 * in `zone`, plus the clock changes within {@link SCHEDULE_PREVIEW_HORIZON_DAYS}
 * that move or remove a run.
 */
export function previewSchedule(
  rrule: string,
  zone: string,
  fromMs: number,
  { count = SCHEDULE_PREVIEW_COUNT, horizonDays = SCHEDULE_PREVIEW_HORIZON_DAYS } = {},
): SchedulePreview {
  const resolved = canonicalPreviewZone(zone);
  if (!resolved) return { kind: "invalid-zone", zone };
  const rule = rrule.trim();
  const recurrence = recurrenceFromRrule(rule.startsWith("RRULE:") ? rule : `RRULE:${rule}`);
  if (!recurrence || (recurrence.type !== "daily" && recurrence.type !== "weekly")) return { kind: "unparsed" };
  const days = recurrence.type === "weekly" ? new Set(recurrence.days) : null;

  const occurrences: ScheduleOccurrence[] = [];
  const warnings: ScheduleWarning[] = [];
  const today = wallTime(fromMs, resolved);
  const start = Date.UTC(today.year, today.month - 1, today.day);
  let previousOffset: number | null = null;
  for (let index = 0; index <= horizonDays; index++) {
    const calendar = new Date(start + index * DAY_MS);
    // Weekday of the zone-local calendar date, which no offset can change.
    if (!days || days.has(calendar.getUTCDay())) {
      const wall: WallTime = {
        year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate(),
        hour: recurrence.hour, minute: recurrence.minute,
      };
      const date = isoDate(wall.year, wall.month, wall.day);
      const all = instantsFor(wall, resolved);
      const upcoming = all.filter((ms) => ms > fromMs);
      const first = upcoming[0];
      if (all.length === 0) {
        warnings.push({ kind: "nonexistent", date });
      } else if (first !== undefined) {
        const offset = offsetMinutes(first, resolved);
        if (upcoming.length > 1) warnings.push({ kind: "repeated", date, at: new Date(first).toISOString() });
        if (previousOffset !== null && offset !== previousOffset) {
          warnings.push({ kind: "offset-change", at: new Date(first).toISOString(), fromOffsetMinutes: previousOffset, toOffsetMinutes: offset });
        }
        previousOffset = offset;
        if (occurrences.length < count) {
          occurrences.push({ at: new Date(first).toISOString(), offsetMinutes: offset, repeated: upcoming.length > 1 });
        }
      }
    }
    // Past the listed runs, only the next clock change is worth reporting.
    if (warnings.length >= MAX_WARNINGS || (occurrences.length >= count && warnings.length > 0)) break;
  }
  return { kind: "parsed", zone: resolved, occurrences, warnings: warnings.slice(0, MAX_WARNINGS) };
}

/** `UTC−5`, `UTC+5:30`, `UTC`. */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** An instant as a wall time in `zone`, with the zone's own abbreviation. */
export function formatInZone(iso: string, zone: string, { hour12 = true } = {}): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12, timeZoneName: "short",
  }).format(new Date(iso));
}

/** A local calendar date (`YYYY-MM-DD`) as words, independent of any zone. */
export function formatLocalDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}
