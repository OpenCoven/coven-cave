"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import { Icon, type IconName } from "@/lib/icon";
import { formatClock, formatDate, readDateTimePrefs } from "@/lib/datetime-format";
import { Button } from "@/components/ui/button";

// Per-familiar accent colour, provided once by CalendarView and read by every
// leaf chip (avoids threading a colour prop through all four view components).
// Returns null for unassigned items (no accent).
export const FamiliarColorContext = createContext<(familiarId: string | null | undefined) => string | null>(() => null);
export function useFamiliarAccent(familiarId: string | null | undefined): string | null {
  return useContext(FamiliarColorContext)(familiarId);
}

// Per-familiar display name, same shape as the colour context. The accent
// colour alone is a colour-only encoding (WCAG 1.4.1) — every chip also names
// its owning familiar in the accessible name / tooltip.
export const FamiliarNameContext = createContext<(familiarId: string | null | undefined) => string | null>(() => null);
export function useFamiliarName(familiarId: string | null | undefined): string | null {
  return useContext(FamiliarNameContext)(familiarId);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewMode = "agenda" | "day" | "week" | "month";

/** A read-only board task deadline overlaid on the calendar. Sourced from board
 *  cards that carry an `endDate`, so weekly planning includes task due-dates and
 *  not just inbox reminders. */
export type CalendarDeadline = {
  id: string;
  title: string;
  /** Board endDate — "YYYY-MM-DD" or ISO. Treated as an all-day due marker. */
  date: string;
  familiarId: string | null;
  status?: string;
};

export type Props = {
  items: InboxItem[];
  familiars: Familiar[];
  /** When set, the calendar hard-scopes to items belonging to this familiar.
   *  Defensive null escape: bypass the familiar filter entirely. Mirrors
   *  BoardView's hard-scope. */
  activeFamiliarId?: string | null;
  /** Multiselect scope (empty = All). When supplied, the calendar filters to
   *  the union of these familiars; takes precedence over `activeFamiliarId`. */
  scopeFamiliarIds?: ReadonlySet<string>;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
  /** Reschedule an item to a new time (drag-and-drop). Optimistic; SSE reconciles. */
  onReschedule?: (id: string, fireAtIso: string) => void;
  /** Mark an item done. Optimistic; the SSE stream reconciles. */
  onComplete?: (id: string) => void;
  /** Dismiss (remove) an item. */
  onDismiss?: (id: string) => void;
  /** Snooze an item until the given ISO timestamp. */
  onSnooze?: (id: string, untilIso: string) => void;
  /** Read-only board task deadlines (cards with an endDate) overlaid on the grid. */
  deadlines?: CalendarDeadline[];
  /** Open the board card behind a deadline marker. */
  onOpenDeadline?: (id: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function fmtTime(iso: string): string {
  return formatClock(iso);
}

export function fmtDateHeading(d: Date): string {
  return formatDate(d, undefined, { weekday: true, month: "long" });
}

// Agenda group headers read better with a relative day word for the days right
// around now ("Today" / "Tomorrow" / "Yesterday"), falling back to the full
// weekday + date for anything further out.
// "Today" / "Tomorrow" / "Yesterday" for the days right around now, else null.
export function relDayWord(date: Date, now: Date = new Date()): string | null {
  const days = Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return null;
}

export function agendaDayLabel(date: Date, now: Date = new Date()): string {
  return relDayWord(date, now) ?? fmtDateHeading(date);
}

// Compact "time until / since" for agenda rows — the affordance that answers
// "what's next" at a glance ("now", "in 25m", "in 3h", "40m ago"). Only
// meaningful inside a ~12h window; beyond that the day header already carries
// the date, so we return null and the row shows just its clock time.
export function relTimeShort(target: Date, now: Date): string | null {
  const mins = Math.round((target.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(mins);
  if (abs < 1) return "now";
  if (abs < 60) return mins > 0 ? `in ${abs}m` : `${abs}m ago`;
  if (abs < 60 * 12) {
    const hrs = Math.round(abs / 60);
    return mins > 0 ? `in ${hrs}h` : `${hrs}h ago`;
  }
  return null;
}

// A hydration-safe, live-ticking "now". Null on the server / first client
// render (so today-highlights and the now-line aren't painted into SSR markup,
// which would mismatch the client clock), then resolves on mount and re-ticks
// each minute so the current-time indicator tracks the clock without a reload.
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // Anchor ticks to the wall-clock minute (a mount-anchored interval left
    // the now-line and Today highlight up to ~60s behind at each rollover).
    let interval: ReturnType<typeof setInterval> | null = null;
    const align = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

export function fmtHourLabel(h: number): string {
  // Honor the 24-hour clock preference for the time axis. Wrapped so the
  // helper still works if prefs are unavailable (SSR / isolated unit runs),
  // falling back to the 12-hour AM/PM labels.
  try {
    if (readDateTimePrefs().clock === "24h") return String(h).padStart(2, "0");
  } catch { /* no prefs available — use the 12-hour labels below */ }
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export function defaultEntryFireAt(day: Date): string {
  const target = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
  const now = new Date();
  // Future 9 AM on the clicked day → use it directly.
  if (target.getTime() > now.getTime()) return target.toISOString();
  // 9 AM has already passed. Keep the *clicked day* rather than silently
  // jumping to today: when the day is today, round up to the next 15-min slot
  // so the default isn't in the past; a past day keeps its 9 AM so the modal
  // opens on the day the user actually clicked.
  if (isSameDay(day, now)) {
    const slot = new Date(now);
    // The +5 is a buffer: a slot boundary under 5 minutes away is skipped for
    // the one after it (:56-59 → :15 past). setMinutes(75) carries the hour.
    slot.setMinutes(Math.ceil((slot.getMinutes() + 5) / 15) * 15, 0, 0);
    return slot.toISOString();
  }
  return target.toISOString();
}

// A reminder still pending after its fire time never fired — flag it so it
// stands out on the calendar like it does in the Schedules list.
export function isOverdueReminder(item: InboxItem): boolean {
  return (
    item.kind === "reminder" &&
    item.status === "pending" &&
    !!item.fireAt &&
    new Date(item.fireAt).getTime() < Date.now()
  );
}

export function urgencyColor(item: InboxItem): string {
  if (isOverdueReminder(item)) return "bg-[var(--color-warning)]";
  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  if (!meta) return "bg-[var(--text-muted)]";
  if (meta.urgency === "expiring") return "bg-[var(--accent-presence)]";
  if (meta.urgency === "time-sensitive") return "bg-[var(--color-warning)]";
  return "bg-[var(--text-muted)]";
}

/** Text alternative for the color-only urgency dot, so it isn't conveyed by hue alone. */
export function urgencyLabel(item: InboxItem): string {
  if (isOverdueReminder(item)) return "Overdue";
  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  if (meta?.urgency === "expiring") return "Expiring";
  if (meta?.urgency === "time-sensitive") return "Time-sensitive";
  return "Normal urgency";
}

export function platformIcon(item: InboxItem): IconName {
  if (item.kind === "daily-summary") return "ph:newspaper";
  const meta = (item as unknown as { comms?: { platform?: string } }).comms;
  if (!meta?.platform) return "ph:bell";
  const map: Record<string, IconName> = {
    twitter: "ph:twitter-logo",
    linkedin: "ph:linkedin-logo",
    instagram: "ph:instagram-logo",
    tiktok: "ph:tiktok-logo",
    discord: "ph:discord-logo",
    telegram: "ph:telegram-logo",
    bluesky: "ph:butterfly",
  };
  return (map[meta.platform] ?? "ph:bell") as IconName;
}

// ─── Item chip (shared across views) ──────────────────────────────────────────

// A single agenda row, laid out as a timeline entry: a fixed left clock column,
// a spine dot threaded by the day's vertical rail, the title, and a right-hand
// "in 2h" relative cue. `isNext` marks the soonest upcoming item so the agenda
// answers "what's next" without the user hunting for it.
export function ItemChip({
  item,
  onClick,
  isNext = false,
  now = null,
}: {
  item: InboxItem;
  onClick?: () => void;
  isNext?: boolean;
  now?: Date | null;
}) {
  const done = item.status === "done";
  const overdue = isOverdueReminder(item);
  const accent = useFamiliarAccent(item.familiarId);
  const familiarName = useFamiliarName(item.familiarId);
  const iso = item.fireAt ?? item.firedAt ?? null;
  const rel = iso && now && !done ? relTimeShort(new Date(iso), now) : null;
  return (
    <button
      onClick={onClick}
      title={familiarName ? `${item.title} — ${familiarName}` : item.title}
      className={`cal-agenda-row focus-ring group${done ? " is-done" : ""}${isNext ? " is-next" : ""}${overdue ? " is-overdue" : ""}`}
    >
      <span className={`cal-agenda-time${overdue ? " is-overdue" : ""}${isNext ? " is-next" : ""}`}>
        {iso ? fmtTime(iso) : "—"}
      </span>
      <span className="cal-agenda-spine" aria-hidden>
        {done ? (
          <Icon name="ph:check-circle" className="cal-agenda-dot-check" />
        ) : (
          <span
            role="img"
            aria-label={urgencyLabel(item)}
            title={urgencyLabel(item)}
            className={`cal-agenda-dot ${urgencyColor(item)}`}
            style={accent ? { boxShadow: `0 0 0 2.5px color-mix(in oklch, ${accent} 60%, transparent)` } : undefined}
          />
        )}
      </span>
      <span className="cal-agenda-body">
        <Icon name={platformIcon(item)} className="cal-agenda-platform" aria-hidden />
        <span className={`cal-agenda-title${done ? " line-through" : ""}`}>{item.title}</span>
        {familiarName && <span className="sr-only">, {familiarName}</span>}
      </span>
      {isNext ? <span className="cal-agenda-next">Next</span> : null}
      {rel ? <span className={`cal-agenda-rel${overdue ? " is-overdue" : ""}${isNext ? " is-next" : ""}`}>{rel}</span> : null}
    </button>
  );
}

// A board task's due date, rendered in the same timeline grid as reminders so
// the agenda reads as one thread — but tinted "task" (warning) and tagged, so a
// deadline is never mistaken for a scheduled reminder.
export function AgendaDeadlineRow({
  deadline,
  onOpen,
}: {
  deadline: CalendarDeadline;
  onOpen?: (id: string) => void;
}) {
  const done = deadline.status === "done";
  const accent = useFamiliarAccent(deadline.familiarId);
  const familiarName = useFamiliarName(deadline.familiarId);
  return (
    <button
      type="button"
      data-calendar-deadline="true"
      onClick={(e) => { e.stopPropagation(); onOpen?.(deadline.id); }}
      title={`${deadline.title} — task deadline${familiarName ? ` — ${familiarName}` : ""}`}
      aria-label={`${deadline.title}, task deadline${done ? ", done" : ""}${familiarName ? `, ${familiarName}` : ""}`}
      className={`cal-agenda-row cal-agenda-row--task focus-ring group${done ? " is-done" : ""}`}
    >
      <span className="cal-agenda-time is-due">Due</span>
      <span className="cal-agenda-spine" aria-hidden>
        <span
          className="cal-agenda-dot cal-agenda-dot--task"
          style={accent ? { boxShadow: `0 0 0 2.5px color-mix(in oklch, ${accent} 60%, transparent)` } : undefined}
        >
          <Icon name="ph:clock-countdown" width={9} aria-hidden />
        </span>
      </span>
      <span className="cal-agenda-body">
        <span className={`cal-agenda-title${done ? " line-through opacity-70" : ""}`}>{deadline.title}</span>
        {familiarName && <span className="sr-only">, {familiarName}</span>}
      </span>
      <span className="cal-agenda-tag">Task</span>
    </button>
  );
}

export function EmptyScheduleState({
  icon,
  label,
  onAddEntry,
}: {
  icon: IconName;
  label: string;
  onAddEntry?: () => void;
}) {
  return (
    <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center text-sm text-[var(--text-muted)]">
      <Icon name={icon} className="text-3xl opacity-30" />
      <span>{label}</span>
      {onAddEntry ? (
        <Button
          size="sm"
          leadingIcon="ph:plus"
          onClick={onAddEntry}
          className="calendar-empty-action"
          title="Creates a scheduled reminder (an inbox item) — board tasks get due dates on the Tasks surface"
        >
          Add reminder
        </Button>
      ) : null}
    </div>
  );
}
