/**
 * Snooze durations shared by every snooze control: the SnoozeMenu popover
 * (toast, calendar) and the bell's inline choices. Kept apart from the menu
 * component so a surface can offer the same choices without its stylesheet.
 */

export type SnoozeOption = {
  label: string;
  /** Whole minutes from "now", resolved at click time so relative options
   *  (tomorrow morning) stay correct however long the menu sits open. */
  minutes: () => number;
};

/** Whole minutes from now until 9am the next calendar day. */
export function minutesUntilTomorrowMorning(now: Date = new Date()): number {
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 60_000));
}

export const DEFAULT_SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  { label: "5 min", minutes: () => 5 },
  { label: "30 min", minutes: () => 30 },
  { label: "1 hour", minutes: () => 60 },
  { label: "Tomorrow 9am", minutes: () => minutesUntilTomorrowMorning() },
];

/**
 * What a snooze announcement says: "Snoozed until 3:40 PM", or "until
 * tomorrow, 9:00 AM" when it crosses midnight.
 */
export function snoozedUntilLabel(untilMs: number, now: Date = new Date()): string {
  const until = new Date(untilMs);
  const time = until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = until.toDateString() === now.toDateString();
  if (sameDay) return `Snoozed until ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (until.toDateString() === tomorrow.toDateString()) return `Snoozed until tomorrow, ${time}`;
  return `Snoozed until ${until.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}
