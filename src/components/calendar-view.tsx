"use client";

import { createContext, useCallback, useContext, useId, useMemo, useState, useRef, useEffect } from "react";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { familiarAccent } from "@/lib/familiar-color";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { formatClock, formatDate, readDateTimePrefs } from "@/lib/datetime-format";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAnnouncer } from "@/components/ui/live-region";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SnoozeMenu } from "@/components/snooze-menu";
import { Popover, PopoverBody, PopoverItem } from "@/components/ui/popover";
import { itemDate, packEventColumnsWithOverflow, WEEK_MAX_LANES, DAY_MAX_LANES, type PlacedOverflow } from "@/lib/calendar-layout";
import { familiarInScope } from "@/lib/familiar-multiselect";
import { useIsMobile } from "@/lib/use-viewport";

// Per-familiar accent colour, provided once by CalendarView and read by every
// leaf chip (avoids threading a colour prop through all four view components).
// Returns null for unassigned items (no accent).
const FamiliarColorContext = createContext<(familiarId: string | null | undefined) => string | null>(() => null);
function useFamiliarAccent(familiarId: string | null | undefined): string | null {
  return useContext(FamiliarColorContext)(familiarId);
}

// Per-familiar display name, same shape as the colour context. The accent
// colour alone is a colour-only encoding (WCAG 1.4.1) — every chip also names
// its owning familiar in the accessible name / tooltip.
const FamiliarNameContext = createContext<(familiarId: string | null | undefined) => string | null>(() => null);
function useFamiliarName(familiarId: string | null | undefined): string | null {
  return useContext(FamiliarNameContext)(familiarId);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "agenda" | "day" | "week" | "month";

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

type Props = {
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtTime(iso: string): string {
  return formatClock(iso);
}

function fmtDateHeading(d: Date): string {
  return formatDate(d, undefined, { weekday: true, month: "long" });
}

// Agenda group headers read better with a relative day word for the days right
// around now ("Today" / "Tomorrow" / "Yesterday"), falling back to the full
// weekday + date for anything further out.
// "Today" / "Tomorrow" / "Yesterday" for the days right around now, else null.
function relDayWord(date: Date, now: Date = new Date()): string | null {
  const days = Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return null;
}

function agendaDayLabel(date: Date, now: Date = new Date()): string {
  return relDayWord(date, now) ?? fmtDateHeading(date);
}

// Compact "time until / since" for agenda rows — the affordance that answers
// "what's next" at a glance ("now", "in 25m", "in 3h", "40m ago"). Only
// meaningful inside a ~12h window; beyond that the day header already carries
// the date, so we return null and the row shows just its clock time.
function relTimeShort(target: Date, now: Date): string | null {
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
function useNow(): Date | null {
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

function fmtHourLabel(h: number): string {
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

function defaultEntryFireAt(day: Date): string {
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
function isOverdueReminder(item: InboxItem): boolean {
  return (
    item.kind === "reminder" &&
    item.status === "pending" &&
    !!item.fireAt &&
    new Date(item.fireAt).getTime() < Date.now()
  );
}

function urgencyColor(item: InboxItem): string {
  if (isOverdueReminder(item)) return "bg-[var(--color-warning)]";
  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  if (!meta) return "bg-[var(--text-muted)]";
  if (meta.urgency === "expiring") return "bg-[var(--accent-presence)]";
  if (meta.urgency === "time-sensitive") return "bg-[var(--color-warning)]";
  return "bg-[var(--text-muted)]";
}

/** Text alternative for the color-only urgency dot, so it isn't conveyed by hue alone. */
function urgencyLabel(item: InboxItem): string {
  if (isOverdueReminder(item)) return "Overdue";
  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  if (meta?.urgency === "expiring") return "Expiring";
  if (meta?.urgency === "time-sensitive") return "Time-sensitive";
  return "Normal urgency";
}

function platformIcon(item: InboxItem): IconName {
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
function ItemChip({
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
function AgendaDeadlineRow({
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

function EmptyScheduleState({
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

// ─── Agenda view ──────────────────────────────────────────────────────────────

function AgendaView({
  items,
  deadlines,
  anchor,
  onAddEntry,
  onOpenItem,
  onOpenDeadline,
}: {
  items: InboxItem[];
  deadlines?: CalendarDeadline[];
  anchor: Date;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
  onOpenDeadline?: (id: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const now = useNow();

  const pastCount = useMemo(
    () => items.filter((it) => {
      const d = itemDate(it);
      return d && d < startOfDay(anchor);
    }).length,
    [items, anchor],
  );

  // Group items by date, then filter / sort based on showPast.
  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: InboxItem[]; deadlines: CalendarDeadline[] }>();
    const ensure = (d: Date) => {
      const key = startOfDay(d).toISOString();
      if (!map.has(key)) map.set(key, { date: startOfDay(d), items: [], deadlines: [] });
      return map.get(key)!;
    };
    for (const item of items) {
      const d = itemDate(item);
      if (!d) continue;
      ensure(d).items.push(item);
    }
    for (const dl of deadlines ?? []) {
      const d = deadlineDate(dl);
      if (!d) continue;
      ensure(d).deadlines.push(dl);
    }
    return Array.from(map.values())
      .filter((g) => showPast ? true : g.date >= startOfDay(anchor))
      .sort((a, b) => showPast
        ? b.date.getTime() - a.date.getTime()
        : a.date.getTime() - b.date.getTime());
  }, [items, deadlines, anchor, showPast]);

  // The single soonest still-pending item — highlighted as "Next" so the agenda
  // answers "what's up next" without the user scanning for it.
  const nextId = useMemo(() => {
    if (!now) return null;
    const t = now.getTime();
    let best: { id: string; ms: number } | null = null;
    for (const it of items) {
      if (it.status === "done" || it.status === "dismissed") continue;
      const d = itemDate(it);
      if (!d || d.getTime() < t) continue;
      if (!best || d.getTime() < best.ms) best = { id: it.id, ms: d.getTime() };
    }
    return best?.id ?? null;
  }, [items, now]);

  if (groups.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center text-sm text-[var(--text-muted)]">
        <Icon name="ph:calendar-blank" width={32} className="text-[var(--text-muted)]" />
        <div>Nothing scheduled upcoming.</div>
        {pastCount > 0 && !showPast ? (
          <Button
            size="sm"
            onClick={() => setShowPast(true)}
            className="calendar-empty-action"
          >
            Show {pastCount} past item{pastCount !== 1 ? "s" : ""}
          </Button>
        ) : null}
        {onAddEntry ? (
          <Button
            size="sm"
            leadingIcon="ph:plus"
            onClick={() => onAddEntry({ fireAt: defaultEntryFireAt(anchor) })}
            className="calendar-empty-action"
            title="Creates a scheduled reminder (an inbox item) — board tasks get due dates on the Tasks surface"
          >
            Add reminder
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cal-agenda-scroll flex flex-col overflow-y-auto px-3 py-3 sm:px-5">
      {showPast ? (
        <div className="mb-1 flex justify-end">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowPast(false)}
            className="calendar-empty-action"
          >
            Hide past
          </Button>
        </div>
      ) : null}
      {groups.map(({ date, items: groupItems, deadlines: groupDeadlines }) => {
        const total = groupItems.length + groupDeadlines.length;
        const isToday = !!now && isSameDay(date, now);
        const relWord = now ? relDayWord(date, now) : null;
        return (
        <div key={date.toISOString()} className={`cal-agenda-group${isToday ? " is-today" : ""}`}>
          <div className="cal-agenda-dayhead">
            <span className="cal-agenda-datebadge" aria-hidden>
              <span className="cal-agenda-dow">{WEEKDAYS[date.getDay()]}</span>
              <span className="cal-agenda-dnum">{date.getDate()}</span>
            </span>
            <span className="cal-agenda-daylabel">
              <span className="cal-agenda-daylabel-main">
                {now ? agendaDayLabel(date, now) : fmtDateHeading(date)}
              </span>
              {relWord ? (
                <span className="cal-agenda-daylabel-sub">{MONTHS[date.getMonth()]} {date.getDate()}, {date.getFullYear()}</span>
              ) : null}
            </span>
            <span className="cal-agenda-count" title={`${total} item${total !== 1 ? "s" : ""}`}>{total}</span>
          </div>
          <div className="cal-agenda-list">
            {groupDeadlines.map((d) => (
              <AgendaDeadlineRow key={d.id} deadline={d} onOpen={onOpenDeadline} />
            ))}
            {[...groupItems]
              // Order by the same key the day bucket uses (itemDate: fireAt ??
              // firedAt ?? createdAt) so fired items with no fireAt stay in
              // chronological order instead of falling back to createdAt.
              .sort((a, b) => (itemDate(a)?.getTime() ?? 0) - (itemDate(b)?.getTime() ?? 0))
              .map((item) => (
                <ItemChip
                  key={item.id}
                  item={item}
                  isNext={item.id === nextId}
                  now={now}
                  onClick={() => onOpenItem?.(item)}
                />
              ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ─── All-day strip ───────────────────────────────────────────────────────────

const MAX_ALLDAY_VISIBLE = 3;

function AllDayStrip({
  columns,
  onOpenItem,
  onMore,
  maxVisible = MAX_ALLDAY_VISIBLE,
}: {
  columns: { date: Date; items: InboxItem[] }[];
  onOpenItem?: (item: InboxItem) => void;
  /** Reveal a column's overflow items (jump to that day). Omit when uncapped. */
  onMore?: (day: Date) => void;
  /** Per-column cap before "+N more". Infinity = show every item (Day view). */
  maxVisible?: number;
}) {
  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-[var(--border-hairline)] bg-[var(--bg-panel)]">
      {/* Label */}
      <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-end border-r border-[var(--border-hairline)] bg-[var(--bg-panel)] py-1 pr-1.5">
        <span className="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] leading-tight text-right">
          All
          <br />
          day
        </span>
      </div>
      {/* Per-column chips */}
      <div
        className={`flex flex-1 divide-x divide-[var(--border-hairline)] ${
          columns.length > 1 ? "min-w-[560px]" : "min-w-[180px]"
        }`}
      >
        {columns.map((col, i) => {
          const cap = Number.isFinite(maxVisible) ? maxVisible : col.items.length;
          return (
          <div key={i} className="flex-1 min-w-[80px] flex flex-col gap-0.5 p-1">
            {col.items.slice(0, cap).map((item) => (
              <button
                key={item.id}
                onClick={() => onOpenItem?.(item)}
                title={item.title}
                className="focus-ring-inset flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] bg-[var(--accent-presence)]/15 border border-[var(--accent-presence)]/30 hover:bg-[var(--accent-presence)]/25 transition-colors w-full text-left truncate"
              >
                <span role="img" aria-label={urgencyLabel(item)} title={urgencyLabel(item)} className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(item)}`} />
                <span className="truncate text-[var(--text-primary)]">{item.title}</span>
              </button>
            ))}
            {col.items.length > cap && (
              <button
                onClick={() => onMore?.(col.date)}
                className="focus-ring-inset text-[9px] text-[var(--text-muted)] px-1 hover:text-[var(--accent-presence)] transition-colors text-left w-full"
                title={`${col.items.length - cap} more — click to open the day`}
              >
                +{col.items.length - cap} more
              </button>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/** Parse a board deadline date ("YYYY-MM-DD") as LOCAL midnight so it lands on
 *  the intended calendar day regardless of timezone. */
function deadlineDate(d: CalendarDeadline): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.date);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dt = new Date(d.date);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function DeadlineChip({
  deadline,
  onOpen,
  size = "sm",
}: {
  deadline: CalendarDeadline;
  onOpen?: (id: string) => void;
  size?: "sm" | "xs";
}) {
  const done = deadline.status === "done";
  const accent = useFamiliarAccent(deadline.familiarId);
  const familiarName = useFamiliarName(deadline.familiarId);
  return (
    <button
      type="button"
      data-calendar-deadline="true"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(deadline.id);
      }}
      aria-label={`${deadline.title}, task deadline${done ? ", done" : ""}${familiarName ? `, ${familiarName}` : ""}`}
      title={`${deadline.title} — task deadline${familiarName ? ` — ${familiarName}` : ""}`}
      style={accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined}
      className={`focus-ring-inset flex w-full items-center gap-1 truncate rounded border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/12 px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--color-warning)]/20 ${size === "xs" ? "text-[9px]" : "text-[10px]"}`}
    >
      <Icon name="ph:clock-countdown" width={size === "xs" ? 9 : 11} className="shrink-0 text-[var(--color-warning)]" aria-hidden />
      <span className={`truncate text-[var(--text-primary)] ${done ? "line-through opacity-70" : ""}`}>{deadline.title}</span>
    </button>
  );
}

const MAX_DEADLINES_VISIBLE = 3;

function DeadlineStrip({
  columns,
  onOpen,
  onMore,
}: {
  columns: { date: Date; deadlines: CalendarDeadline[] }[];
  onOpen?: (id: string) => void;
  onMore?: (day: Date) => void;
}) {
  if (columns.every((c) => c.deadlines.length === 0)) return null;
  const multi = columns.length > 1;
  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-[var(--border-hairline)] bg-[var(--bg-panel)]">
      <div className="sticky left-0 z-10 flex w-12 shrink-0 items-center justify-end border-r border-[var(--border-hairline)] bg-[var(--bg-panel)] py-1 pr-1.5">
        <span
          className="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] leading-tight text-right"
          title="Task due dates from the Board — separate from your scheduled reminders below"
        >
          Due
        </span>
      </div>
      <div
        className={`flex flex-1 divide-x divide-[var(--border-hairline)] ${
          multi ? "min-w-[560px]" : "min-w-[180px]"
        }`}
      >
        {columns.map((col, i) => {
          const cap = multi ? MAX_DEADLINES_VISIBLE : col.deadlines.length;
          return (
            <div key={i} className="flex-1 min-w-[80px] flex flex-col gap-0.5 p-1">
              {col.deadlines.slice(0, cap).map((d) => (
                <DeadlineChip key={d.id} deadline={d} onOpen={onOpen} size="xs" />
              ))}
              {col.deadlines.length > cap && (
                <button
                  onClick={() => onMore?.(col.date)}
                  className="focus-ring-inset text-[9px] text-[var(--text-muted)] px-1 hover:text-[var(--color-warning)] transition-colors text-left w-full"
                  title={`${col.deadlines.length - cap} more deadlines`}
                >
                  +{col.deadlines.length - cap} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isAllDay(item: InboxItem): boolean {
  const iso = item.fireAt ?? item.firedAt;
  if (!iso) return true; // no time → all-day
  const d = new Date(iso);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

// ─── TimeGrid ─────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 56;
// Timed-grid interactions snap to 15-min slots. Floor to the first slot (and
// cap at the last) so an event placed / dragged / nudged to the very top of the
// day never lands on exact local midnight — isAllDay() treats 00:00:00 as an
// all-day marker, which would yank the event out of the hourly grid into the
// all-day strip.
const SNAP_MIN = 15;
const MAX_TIMED_MIN = 24 * 60 - SNAP_MIN;
const clampTimedMinutes = (min: number) =>
  Math.min(MAX_TIMED_MIN, Math.max(SNAP_MIN, min));

function TimeGrid({
  columns,
  onOpenItem,
  onAddEntry,
  onReschedule,
  maxLanes = WEEK_MAX_LANES,
}: {
  columns: { label: string; date: Date; items: InboxItem[] }[];
  onOpenItem?: (item: InboxItem) => void;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onReschedule?: (id: string, fireAtIso: string) => void;
  /** Lane cap before concurrent events roll up into a "+N" pill. */
  maxLanes?: number;
}) {
  // Read the per-familiar accent fn once (events render in a loop, so we can't
  // call the hook per item).
  const accentFor = useContext(FamiliarColorContext);
  const nameFor = useContext(FamiliarNameContext);
  // Reschedules (drag drop + Alt+↑/↓) move the event silently for AT users
  // otherwise — confirm the new time through the shared live region.
  const { announce } = useAnnouncer();
  // Tracks the in-flight drag: the item id + where in the block it was grabbed,
  // so the drop snaps the block's start (not the cursor) to the new time.
  const dragRef = useRef<{ id: string; grabY: number } | null>(null);
  const nowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const now = useNow();
  const scrolledRef = useRef(false);

  // Center the grid on the current time once it's known (after mount, since
  // `now` is null on the server / first paint). Latched so it never fights a
  // later manual scroll or the per-minute tick.
  useEffect(() => {
    if (now && !scrolledRef.current && nowRef.current) {
      nowRef.current.scrollIntoView({ block: "center" });
      scrolledRef.current = true;
    }
  }, [now]);

  useRovingTabIndex({
    containerRef: gridRef,
    itemSelector: '[data-calendar-event="true"]',
    orientation: "vertical",
  });

  // Lane-pack each column once per columns change rather than on every render
  // (a drag re-renders the grid continuously).
  const packedColumns = useMemo(
    () => columns.map((c) => packEventColumnsWithOverflow(c.items, maxLanes)),
    [columns, maxLanes],
  );

  // One popover serves every "+N" pill: clicking a pill anchors the popover to
  // that pill and lists its rolled-up events.
  const [overflowOpen, setOverflowOpen] = useState<{ colIdx: number; overflow: PlacedOverflow } | null>(null);
  const overflowAnchorRef = useRef<HTMLElement | null>(null);

  const totalHeight = 24 * HOUR_HEIGHT;
  const nowTop = now ? ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT : 0;

  return (
    <div ref={gridRef} className="flex flex-1 overflow-auto">
      {/* Time axis */}
      <div
        className="sticky left-0 z-20 w-12 shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-base)] relative"
        style={{ height: totalHeight }}
      >
        {HOURS.map((h) => (
          <div
            key={h}
            className="absolute right-2 text-[9px] text-[var(--text-muted)] pt-0.5"
            style={{ top: h * HOUR_HEIGHT }}
          >
            {fmtHourLabel(h)}
          </div>
        ))}
      </div>

      {/* Columns */}
      <div
        className={`flex flex-1 divide-x divide-[var(--border-hairline)] ${
          columns.length > 1 ? "min-w-[560px]" : "min-w-[220px]"
        }`}
      >
        {columns.map((col, ci) => (
          <div
            key={ci}
            className={`flex-1 relative min-w-[80px] ${
              now && isSameDay(col.date, now) ? "bg-[color-mix(in_oklch,var(--accent-presence)_6%,transparent)]" : ""
            } ${onAddEntry ? "cursor-pointer" : ""}`}
            style={{ height: totalHeight }}
            title={onAddEntry ? "Click an empty slot to add an event" : undefined}
            onClick={
              onAddEntry
                ? (e) => {
                    // Clicking an existing event opens it; only empty slots create.
                    if ((e.target as HTMLElement).closest("[data-calendar-event]")) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const hour = Math.max(0, Math.min(23, Math.floor((e.clientY - rect.top) / HOUR_HEIGHT)));
                    const slot = new Date(col.date);
                    slot.setHours(0, clampTimedMinutes(hour * 60), 0, 0);
                    onAddEntry({ fireAt: slot.toISOString() });
                  }
                : undefined
            }
            onDragOver={
              onReschedule
                ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }
                : undefined
            }
            onDrop={
              onReschedule
                ? (e) => {
                    e.preventDefault();
                    const drag = dragRef.current;
                    dragRef.current = null;
                    if (!drag) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    // Snap the block's start to the nearest 15 minutes at the drop.
                    const topPx = e.clientY - rect.top - drag.grabY;
                    const minutes = clampTimedMinutes(Math.round((topPx / HOUR_HEIGHT) * 4) * 15);
                    const slot = new Date(col.date);
                    slot.setHours(0, minutes, 0, 0);
                    onReschedule(drag.id, slot.toISOString());
                    // Cross-day drags land in a different column than the one
                    // that owns the item — search every column for the title.
                    const dragged = columns.flatMap((c) => c.items).find((it) => it.id === drag.id);
                    announce(`Rescheduled "${dragged?.title ?? "event"}" to ${col.label}, ${fmtTime(slot.toISOString())}`);
                  }
                : undefined
            }
          >
            {/* Hour lines */}
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-[var(--border-hairline)]"
                style={{ top: h * HOUR_HEIGHT }}
              />
            ))}

            {/* Current time indicator (today's column only, once `now` resolves) */}
            {now && isSameDay(col.date, now) && (
              <div
                ref={nowRef}
                className="absolute left-0 right-0 flex items-center z-10"
                style={{ top: nowTop }}
              >
                <span className="sr-only">Current time, {fmtTime(now.toISOString())}</span>
                <div className="h-2 w-2 rounded-full bg-[var(--accent-presence)] -ml-1 shrink-0" aria-hidden />
                <div className="flex-1 h-px bg-[var(--accent-presence)]" aria-hidden />
              </div>
            )}

            {/* Items — lane-packed so overlaps sit side by side */}
            {packedColumns[ci].events.map((ev) => {
              const widthPct = 100 / ev.lanes;
              const leftPct = ev.lane * widthPct;
              const height = Math.max(18, ((ev.end - ev.start) / 60) * HOUR_HEIGHT - 2);
              const done = ev.item.status === "done";
              const familiarName = nameFor(ev.item.familiarId);
              return (
                <button
                  key={ev.item.id}
                  type="button"
                  data-calendar-event="true"
                  draggable={Boolean(onReschedule)}
                  onDragStart={
                    onReschedule
                      ? (e) => {
                          dragRef.current = {
                            id: ev.item.id,
                            grabY: e.clientY - e.currentTarget.getBoundingClientRect().top,
                          };
                          e.dataTransfer.effectAllowed = "move";
                        }
                      : undefined
                  }
                  onClick={() => onOpenItem?.(ev.item)}
                  onKeyDown={
                    onReschedule
                      ? (e) => {
                          // Keyboard reschedule (drag is mouse-only): Alt+↑/↓
                          // nudges the start ±15 min, Alt+Shift+↑/↓ by an hour.
                          // Plain ↑/↓ stay with the roving focus nav.
                          if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                          e.preventDefault();
                          const step = (e.shiftKey ? 60 : 15) * (e.key === "ArrowDown" ? 1 : -1);
                          const minutes = clampTimedMinutes(ev.start + step);
                          if (minutes === ev.start) return;
                          const slot = new Date(col.date);
                          slot.setHours(0, minutes, 0, 0);
                          onReschedule(ev.item.id, slot.toISOString());
                          announce(`Rescheduled "${ev.item.title}" to ${fmtTime(slot.toISOString())}`);
                        }
                      : undefined
                  }
                  aria-label={`${fmtTime((ev.item.fireAt ?? ev.item.firedAt)!)}, ${ev.item.title}${done ? ", done" : ""}${familiarName ? `, ${familiarName}` : ""}`}
                  title={`${familiarName ? `${ev.item.title} — ${familiarName}` : ev.item.title}${onReschedule ? " — drag, or Alt+↑/↓, to reschedule" : ""}`}
                  className={`focus-ring-inset absolute flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] border transition-colors overflow-hidden ${
                    done
                      ? "border-[var(--border-hairline)] bg-[var(--bg-raised)] opacity-60"
                      : "border-[var(--accent-presence)]/30 bg-[var(--accent-presence)]/15 hover:bg-[var(--accent-presence)]/25"
                  }`}
                  style={{
                    top: (ev.start / 60) * HOUR_HEIGHT + 1,
                    height,
                    left: `calc(${leftPct}% + 1px)`,
                    width: `calc(${widthPct}% - 2px)`,
                    ...(accentFor(ev.item.familiarId) && !done
                      ? { borderLeftColor: accentFor(ev.item.familiarId) as string, borderLeftWidth: 3 }
                      : null),
                  }}
                >
                  {done
                    ? <Icon name="ph:check" width={9} className="shrink-0 text-[var(--text-muted)]" />
                    : <span role="img" aria-label={urgencyLabel(ev.item)} title={urgencyLabel(ev.item)} className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(ev.item)}`} />}
                  <span className={`truncate ${done ? "line-through" : ""}`}>{ev.item.title}</span>
                </button>
              );
            })}

            {/* "+N" rollup pills — concurrent events beyond the lane cap */}
            {packedColumns[ci].overflows.map((ov, oi) => {
              const widthPct = 100 / ov.lanes;
              const leftPct = ov.lane * widthPct;
              const height = Math.max(18, ((ov.end - ov.start) / 60) * HOUR_HEIGHT - 2);
              const open = overflowOpen?.colIdx === ci && overflowOpen.overflow === ov;
              return (
                <button
                  key={`ov-${oi}`}
                  type="button"
                  data-calendar-event="true"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label={`${ov.items.length} more events from ${fmtTime(minutesToIso(col.date, ov.start))}`}
                  title={`${ov.items.length} more events — click to list`}
                  onClick={(e) => {
                    e.stopPropagation();
                    overflowAnchorRef.current = e.currentTarget;
                    setOverflowOpen(open ? null : { colIdx: ci, overflow: ov });
                  }}
                  className="focus-ring-inset absolute flex items-center justify-center rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1 text-[10px] font-semibold tabular-nums text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  style={{
                    top: (ov.start / 60) * HOUR_HEIGHT + 1,
                    height,
                    left: `calc(${leftPct}% + 1px)`,
                    width: `calc(${widthPct}% - 2px)`,
                  }}
                >
                  +{ov.items.length}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* One shared popover lists whichever "+N" pill is open */}
      <Popover
        open={overflowOpen !== null}
        onOpenChange={(next) => { if (!next) setOverflowOpen(null); }}
        anchorRef={overflowAnchorRef}
        placement="bottom-start"
        minWidth={220}
        ariaLabel="More events"
      >
        <PopoverBody role="menu" ariaLabel="More events">
          {(overflowOpen?.overflow.items ?? []).map((item) => {
            const iso = item.fireAt ?? item.firedAt;
            return (
              <PopoverItem
                key={item.id}
                onSelect={() => {
                  setOverflowOpen(null);
                  onOpenItem?.(item);
                }}
                title={item.title}
              >
                <span className="tabular-nums text-[var(--text-muted)]">{iso ? fmtTime(iso) : ""}</span>
                {" "}
                {item.title}
              </PopoverItem>
            );
          })}
        </PopoverBody>
      </Popover>
    </div>
  );
}

/** ISO timestamp for a minutes-from-midnight offset on a given day. */
function minutesToIso(day: Date, minutes: number): string {
  const d = new Date(day);
  d.setHours(0, minutes, 0, 0);
  return d.toISOString();
}

// ─── Day view ─────────────────────────────────────────────────────────────────

function DayView({
  items,
  deadlines,
  anchor,
  onAddEntry,
  onOpenItem,
  onReschedule,
  onOpenDeadline,
}: {
  items: InboxItem[];
  deadlines?: CalendarDeadline[];
  anchor: Date;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
  onReschedule?: (id: string, fireAtIso: string) => void;
  onOpenDeadline?: (id: string) => void;
}) {
  const now = useNow();

  const allDayItems = useMemo(
    () => items.filter((it) => {
      const d = itemDate(it);
      return d && isSameDay(d, anchor) && isAllDay(it);
    }),
    [items, anchor]
  );

  const timedItems = useMemo(
    () => items.filter((it) => {
      const d = itemDate(it);
      return d && isSameDay(d, anchor) && !isAllDay(it);
    }),
    [items, anchor]
  );

  const dayDeadlines = useMemo(
    () => (deadlines ?? []).filter((d) => {
      const dd = deadlineDate(d);
      return dd && isSameDay(dd, anchor);
    }),
    [deadlines, anchor],
  );

  // `isToday` is derived inside TimeGrid from its own clock, so the 60s
  // now-tick never invalidates this memo (which would otherwise re-pack the
  // column every minute).
  const columns = useMemo(() => [{
    label: fmtDateHeading(anchor),
    date: anchor,
    items: timedItems,
  }], [anchor, timedItems]);

  const rel = now ? relDayWord(anchor, now) : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-3 py-3 sm:px-6">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          {rel ? (
            <span className="text-[var(--accent-presence)]">{rel} · </span>
          ) : null}
          {fmtDateHeading(anchor)}
        </h2>
      </div>
      {/* Task deadlines (read-only, from the board) */}
      {dayDeadlines.length > 0 && (
        <DeadlineStrip
          columns={[{ date: anchor, deadlines: dayDeadlines }]}
          onOpen={onOpenDeadline}
        />
      )}
      {/* All-day strip — single wide column, so show every all-day item. */}
      {allDayItems.length > 0 && (
        <AllDayStrip
          columns={[{ date: anchor, items: allDayItems }]}
          onOpenItem={onOpenItem}
          maxVisible={Infinity}
        />
      )}
      {/* Time grid — always rendered for visual parity with Week */}
      <div className="relative flex flex-1 overflow-hidden">
        <TimeGrid columns={columns} onOpenItem={onOpenItem} onAddEntry={onAddEntry} onReschedule={onReschedule} maxLanes={DAY_MAX_LANES} />
      </div>
    </div>
  );
}

// ─── Week view ────────────────────────────────────────────────────────────────

function WeekView({
  items,
  deadlines,
  anchor,
  onAddEntry,
  onOpenItem,
  onReschedule,
  onOpenDeadline,
  onOpenDay,
}: {
  items: InboxItem[];
  deadlines?: CalendarDeadline[];
  anchor: Date;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
  onReschedule?: (id: string, fireAtIso: string) => void;
  onOpenDeadline?: (id: string) => void;
  /** Jump to the single-day view (used by all-day overflow). */
  onOpenDay?: (day: Date) => void;
}) {
  const now = useNow();
  // Key the week's day list on the week-start timestamp so the memo below is
  // stable across renders (Array.from + startOfWeek would otherwise mint a new
  // `days` identity every render and defeat the column memoisation).
  const weekStartMs = startOfWeek(anchor).getTime();
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStartMs), i)),
    [weekStartMs],
  );

  // `isToday` is derived per-column at render time (here for the header, in
  // TimeGrid for the grid) rather than baked into this memo, so the 60s
  // now-tick doesn't mint a new columns array and force TimeGrid to re-pack
  // every column each minute.
  const columns = useMemo(() => {
    return days.map((day) => ({
      label: `${WEEKDAYS[day.getDay()]} ${day.getDate()}`,
      date: day,
      items: items.filter((it) => {
        const d = itemDate(it);
        return d && isSameDay(d, day) && !isAllDay(it);
      }),
    }));
  }, [items, days]);

  const allDayColumns = useMemo(() => {
    return days.map((day) => ({
      date: day,
      items: items.filter((it) => {
        const d = itemDate(it);
        return d && isSameDay(d, day) && isAllDay(it);
      }),
    }));
  }, [items, days]);

  const deadlineColumns = useMemo(() => {
    return days.map((day) => ({
      date: day,
      deadlines: (deadlines ?? []).filter((d) => {
        const dd = deadlineDate(d);
        return dd && isSameDay(dd, day);
      }),
    }));
  }, [deadlines, days]);


  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Sticky column headers */}
      <div className="flex shrink-0 overflow-x-auto border-b border-[var(--border-hairline)]">
        {/* Spacer for the time axis */}
        <div className="sticky left-0 z-10 w-12 shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-base)]" />
        <div className="flex min-w-[560px] flex-1 divide-x divide-[var(--border-hairline)]">
          {columns.map((col, i) => (
            <div
              key={i}
              aria-current={now && isSameDay(col.date, now) ? "date" : undefined}
              className={`group relative flex-1 min-w-[80px] px-2 py-2 text-center ${
                now && isSameDay(col.date, now) ? "bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)]" : ""
              }`}
            >
              {onAddEntry && (
                <button
                  type="button"
                  onClick={() => onAddEntry({ fireAt: defaultEntryFireAt(col.date) })}
                  aria-label={`Add a reminder on ${fmtDateHeading(col.date)}`}
                  title="Add reminder"
                  className="focus-ring absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-presence)] group-hover:flex group-focus-within:flex"
                >
                  <Icon name="ph:plus" width={10} aria-hidden />
                </button>
              )}
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                {WEEKDAYS[col.date.getDay()]}
              </div>
              <div
                className={`text-sm font-semibold ${
                  now && isSameDay(col.date, now) ? "text-[var(--accent-presence)]" : "text-[var(--text-primary)]"
                }`}
              >
                {col.date.getDate()}
                {now && isSameDay(col.date, now) && <span className="sr-only">, today</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Task deadlines (read-only, from the board) */}
      {deadlineColumns.some((c) => c.deadlines.length > 0) && (
        <DeadlineStrip columns={deadlineColumns} onOpen={onOpenDeadline} />
      )}
      {/* All-day strip — overflow "+N more" opens that day's single-day view. */}
      {allDayColumns.some((c) => c.items.length > 0) && (
        <AllDayStrip columns={allDayColumns} onOpenItem={onOpenItem} onMore={onOpenDay} />
      )}
      <div className="relative flex flex-1 overflow-hidden">
        <TimeGrid columns={columns} onOpenItem={onOpenItem} onAddEntry={onAddEntry} onReschedule={onReschedule} />
      </div>
    </div>
  );
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({
  items,
  deadlines,
  anchor,
  onOpenItem,
  onDayClick,
  onAddEntry,
  onOpenDeadline,
}: {
  items: InboxItem[];
  deadlines?: CalendarDeadline[];
  anchor: Date;
  onOpenItem?: (item: InboxItem) => void;
  onDayClick?: (day: Date) => void;
  onAddEntry?: (opts: { fireAt: string }) => void;
  onOpenDeadline?: (id: string) => void;
}) {
  const accentFor = useContext(FamiliarColorContext);
  const nameFor = useContext(FamiliarNameContext);
  const now = useNow();
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);

  // 6 weeks × 7 days grid
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  // 2-D roving focus over the day cells (←/→ = day, ↑/↓ = week), per the
  // WAI-ARIA grid pattern. The tab stop follows the anchor day — the roving
  // default of "first cell" would land on the previous month's tail.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { setActiveIndex } = useRovingTabIndex({
    containerRef: gridRef,
    itemSelector: '[data-month-cell="true"]',
    columns: 7,
  });
  const anchorIndex = cells.findIndex((d) => isSameDay(d, anchor));
  useEffect(() => {
    if (anchorIndex >= 0) setActiveIndex(anchorIndex);
  }, [anchorIndex, setActiveIndex]);

  const byDay = useMemo(() => {
    const map = new Map<string, InboxItem[]>();
    for (const item of items) {
      const d = itemDate(item);
      if (!d) continue;
      const key = startOfDay(d).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    // Show each day's items in chronological order, like the other views (the
    // map preserves feed order, which is otherwise arbitrary).
    for (const list of map.values()) {
      list.sort((a, b) => (itemDate(a)?.getTime() ?? 0) - (itemDate(b)?.getTime() ?? 0));
    }
    return map;
  }, [items]);

  const deadlinesByDay = useMemo(() => {
    const map = new Map<string, CalendarDeadline[]>();
    for (const d of deadlines ?? []) {
      const dd = deadlineDate(d);
      if (!dd) continue;
      const key = startOfDay(dd).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [deadlines]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden px-2 pb-3 sm:px-4 sm:pb-4">
      {/* Weekday headers */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div
          ref={gridRef}
          role="grid"
          aria-label={`${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`}
          className="flex h-full min-w-[560px] flex-col"
        >
          <div role="row" className="mb-1 grid grid-cols-7">
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                role="columnheader"
                className="py-1 text-center text-[10px] uppercase tracking-wider text-[var(--text-secondary)]"
              >
                {wd}
              </div>
            ))}
          </div>
          {/* Day cells — one row per week (flex-col + gap-px reproduces the
              old grid-rows-6 hairline lattice while giving SRs real rows). */}
          <div role="rowgroup" className="flex flex-1 flex-col gap-px overflow-hidden rounded-lg bg-[var(--border-hairline)]">
            {weeks.map((week, wi) => (
            <div key={wi} role="row" className="grid flex-1 grid-cols-7 gap-px">
            {week.map((day) => {
              const key = startOfDay(day).toISOString();
              const dayItems = byDay.get(key) ?? [];
              const dayDeadlines = deadlinesByDay.get(key) ?? [];
              const isCurrentMonth = day.getMonth() === anchor.getMonth();
              const isToday = now ? isSameDay(day, now) : false;
              const isAnchor = isSameDay(day, anchor);

              // Clicking an empty part of a current-month day pre-fills the add
              // form for that day; the date number still navigates into the day.
              const canAdd = isCurrentMonth && !!onAddEntry;
              const itemsSuffix = dayItems.length ? `, ${dayItems.length} item${dayItems.length !== 1 ? "s" : ""}` : "";
              const onCell = () => {
                if (canAdd) onAddEntry!({ fireAt: defaultEntryFireAt(day) });
                else onDayClick?.(day);
              };
              return (
                <div
                  key={key}
                  role="gridcell"
                  data-month-cell="true"
                  tabIndex={-1}
                  aria-selected={isAnchor || undefined}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${canAdd ? `Add a reminder on ${fmtDateHeading(day)}` : fmtDateHeading(day)}${itemsSuffix}${isAnchor ? ", selected" : ""}`}
                  onClick={onCell}
                  onKeyDown={(e) => {
                    // Shift+Enter opens the day — the keyboard path for what
                    // the (tab-skipped) date-number button does on click.
                    if (e.key === "Enter" && e.shiftKey) {
                      e.preventDefault();
                      onDayClick?.(day);
                      return;
                    }
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onCell();
                    }
                  }}
                  title={canAdd ? "Click to add a reminder — click the date (or Shift+Enter) to open the day" : undefined}
                  className={`group relative focus-ring-inset flex cursor-pointer flex-col overflow-hidden p-1.5 transition-colors ${
                    isCurrentMonth
                      ? "bg-[var(--bg-panel)] hover:bg-[var(--bg-raised)]"
                      : "bg-[var(--bg-base)] hover:bg-[var(--bg-panel)]"
                  } ${isToday ? "ring-1 ring-inset ring-[var(--accent-presence)]" : ""}`}
                >
                  {/* Out of the tab order (cave-sth7): 42 of these defeated
                      the grid's single roving tab stop. Mouse click still
                      works; keyboard uses Shift+Enter on the cell. */}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); onDayClick?.(day); }}
                    aria-label={`Open ${fmtDateHeading(day)}`}
                    className={`focus-ring mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ${
                      isToday
                        ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                        : isCurrentMonth
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {day.getDate()}
                  </button>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {dayDeadlines.slice(0, 2).map((d) => (
                      <DeadlineChip key={d.id} deadline={d} onOpen={onOpenDeadline} size="xs" />
                    ))}
                    {dayDeadlines.length > 2 && (
                      <button
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDayClick?.(day);
                        }}
                        className="focus-ring w-full rounded px-1 text-left text-[9px] text-[var(--text-muted)] transition-colors hover:text-[var(--color-warning)]"
                        title={`${dayDeadlines.length - 2} more deadlines — click to see all`}
                      >
                        +{dayDeadlines.length - 2} due
                      </button>
                    )}
                    {dayItems.slice(0, 3).map((item) => {
                      const done = item.status === "done";
                      const accent = accentFor(item.familiarId);
                      const familiarName = nameFor(item.familiarId);
                      return (
                      <button
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenItem?.(item);
                        }}
                        title={familiarName ? `${item.title} — ${familiarName}` : item.title}
                        style={accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined}
                        className={`focus-ring flex w-full items-center gap-1 rounded border border-[var(--border-hairline)] px-1 py-0.5 text-left text-[9px] ${done ? "bg-[var(--bg-base)] opacity-60 hover:bg-[var(--bg-raised)]" : "bg-[var(--bg-raised)] hover:bg-[var(--bg-elevated)]"}`}
                      >
                        {done
                          ? <Icon name="ph:check" width={8} className="shrink-0 text-[var(--text-muted)]" />
                          : <span role="img" aria-label={urgencyLabel(item)} title={urgencyLabel(item)} className={`h-1 w-1 shrink-0 rounded-full ${urgencyColor(item)}`} />}
                        <span className={`truncate text-[var(--text-primary)] ${done ? "line-through" : ""}`}>{item.title}</span>
                        {familiarName && <span className="sr-only">, {familiarName}</span>}
                      </button>
                      );
                    })}
                    {dayItems.length > 3 && (
                      <button
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDayClick?.(day);
                        }}
                        className="focus-ring w-full rounded px-1 text-left text-[9px] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-presence)]"
                        title={`${dayItems.length - 3} more items — click to see all`}
                      >
                        +{dayItems.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Item Detail Panel ───────────────────────────────────────────────────────

function MiniMonthPopover({
  anchor,
  onPick,
  onClose,
}: {
  anchor: Date;
  onPick: (d: Date) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<Date>(startOfMonth(anchor));
  const ref = useRef<HTMLDivElement>(null);
  const today = new Date();

  // Trap focus + Escape + restore focus to the trigger on close. Previously
  // Tab fell straight through to the calendar behind this dialog.
  useFocusTrap(true, ref, { onEscape: onClose });
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [onClose]);

  const monthStart = view;
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Jump to date"
      tabIndex={-1}
      className="absolute top-full left-0 z-20 mt-2 w-[260px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <IconButton
          icon="ph:arrow-left-bold"
          aria-label="Previous month"
          size="sm"
          onClick={() => setView((d) => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}
        />
        <span className="text-[12px] font-medium text-[var(--text-primary)]">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </span>
        <IconButton
          icon="ph:arrow-right-bold"
          aria-label="Next month"
          size="sm"
          onClick={() => setView((d) => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}
        />
      </div>
      <div className="mb-1 grid grid-cols-7 gap-px text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        {WEEKDAYS.map((wd) => <div key={wd} className="text-center">{wd.slice(0, 1)}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          const isCurrentMonth = day.getMonth() === view.getMonth();
          const isToday = isSameDay(day, today);
          const isAnchor = isSameDay(day, anchor);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(day)}
              aria-label={`${fmtDateHeading(day)}${isAnchor ? ", selected" : ""}`}
              aria-current={isToday ? "date" : undefined}
              className={`focus-ring h-7 w-full rounded text-[11px] transition-colors ${
                isAnchor
                  ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                  : isToday
                    ? "ring-1 ring-inset ring-[var(--accent-presence)] text-[var(--accent-presence)]"
                    : isCurrentMonth
                      ? "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)]/40"
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        onClick={() => onPick(today)}
        className="mt-2"
      >
        Today
      </Button>
    </div>
  );
}

/** Human label for the "Open" action based on what the item links to. */
function openTargetLabel(item: InboxItem): string | null {
  if (item.link) {
    switch (item.link.kind) {
      case "session": return "Open session";
      case "card": return "Open card";
      case "memory": return "Open memory";
      case "url": return "Open link";
    }
  }
  if (item.sessionId) return "Open session";
  return null;
}

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  reminder: "Reminder",
  agent: "Familiar",
  "response-needed": "Response needed",
  "daily-summary": "Daily summary",
  milestone: "Milestone",
};

function ItemDetailPanel({
  item,
  onClose,
  onOpen,
  onComplete,
  onDismiss,
  onSnooze,
}: {
  item: InboxItem;
  onClose: () => void;
  onOpen?: (item: InboxItem) => void;
  onComplete?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string, untilIso: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { announce } = useAnnouncer();
  useFocusTrap(true, panelRef, { onEscape: onClose });

  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  const body = (item as unknown as { body?: string }).body;
  const openLabel = openTargetLabel(item);
  const isDone = item.status === "done";

  return (
    <>
      {/* Backdrop makes aria-modal honest (the calendar behind is inert) and
          adds the outside-click dismiss the drawer was missing. */}
      <div className="cave-cal-detail-backdrop" role="presentation" onClick={onClose} />
      <div
        ref={panelRef}
        className="cave-cal-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="cave-cal-detail-header">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name={platformIcon(item)} className="shrink-0 text-[var(--text-muted)] text-[14px]" />
            <span id={titleId} className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
              {item.title}
            </span>
          </div>
          <IconButton
            icon="ph:x"
            aria-label="Close"
            size="sm"
            onClick={onClose}
            className="shrink-0"
          />
        </div>

        <div className="flex flex-col gap-3 px-4 py-3 text-[12px] text-[var(--text-secondary)] overflow-y-auto flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{KIND_LABEL[item.kind]}</span>
            {isDone ? <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--color-success,#34d399)]"><Icon name="ph:check" width={9} />Done</span> : null}
          </div>
          {meta?.urgency && meta.urgency !== "normal" && (
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${urgencyColor(item)}`} />
              <span className="capitalize">{meta.urgency.replace("-", " ")}</span>
            </div>
          )}
          {(item.fireAt ?? item.firedAt) && (
            <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
              <Icon name="ph:clock" width={12} />
              <span>
                {(() => {
                  const at = (item.fireAt ?? item.firedAt)!;
                  // Short weekday isn't a preference; the date order + clock are.
                  const weekday = new Date(at).toLocaleDateString([], { weekday: "short" });
                  return `${weekday}, ${formatDate(at, undefined, { month: "short" })} ${formatClock(at)}`;
                })()}
              </span>
            </div>
          )}
          {body && (
            <p className="text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
              {body}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--border-hairline)] px-4 py-3">
          {openLabel && onOpen ? (
            <Button
              variant="primary"
              size="sm"
              fullWidth
              leadingIcon="ph:arrow-square-out"
              onClick={() => { onOpen(item); onClose(); }}
            >
              {openLabel}
            </Button>
          ) : null}
          <div className="flex items-center gap-2">
            {!isDone && onComplete ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon="ph:check"
                onClick={() => { onComplete(item.id); announce(`Marked "${item.title}" done`); onClose(); }}
                className="flex-1"
              >
                Done
              </Button>
            ) : null}
            {onSnooze ? (
              <SnoozeMenu
                className="shrink-0"
                onSnooze={(untilIso) => { onSnooze(item.id, untilIso); announce(`Snoozed "${item.title}"`); onClose(); }}
              />
            ) : null}
            {onDismiss ? (
              <IconButton
                icon="ph:trash"
                aria-label="Dismiss"
                onClick={() => { onDismiss(item.id); announce(`Dismissed "${item.title}"`); onClose(); }}
                className="shrink-0"
                title="Dismiss"
              />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main CalendarView ────────────────────────────────────────────────────────

export function CalendarView({ items, familiars, activeFamiliarId, scopeFamiliarIds, deadlines, onAddEntry, onOpenItem, onReschedule, onComplete, onDismiss, onSnooze, onOpenDeadline }: Props) {
  const isMobile = useIsMobile();
  // SSR returns false from useIsMobile, so initial render is always "week"
  // on the server; the effect below snaps to agenda on mount when the
  // viewport actually matches mobile. Keeps server/client markup in sync.
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Week view needs ~7 usable columns; inside a narrow split tile (~360px)
  // they floor at ~40px each. Below 560px of CONTAINER width, week renders
  // with the day presentation instead — the user's stored week choice is
  // untouched and returns the moment the pane widens (cave-87zv).
  const [narrowPane, setNarrowPane] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setNarrowPane(w > 0 && w < 560);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const effectiveView: ViewMode = viewMode === "week" && narrowPane ? "day" : viewMode;

  // Keep the open event detail panel in sync with live updates. `selectedItem`
  // is a snapshot captured at click; without this, an SSE update/delete (or a
  // mutation from elsewhere) leaves the panel showing stale status/fireAt/body,
  // and a deleted item's panel lingers over a dead id — acting on it (Done /
  // Snooze / Dismiss) fires a mutation against nothing. Mirrors the reconciler
  // in automations-view.tsx: adopt the fresh item when it differs, else close.
  useEffect(() => {
    if (!selectedItem) return;
    const fresh = items.find((it) => it.id === selectedItem.id);
    if (fresh) {
      if (JSON.stringify(fresh) !== JSON.stringify(selectedItem)) setSelectedItem(fresh);
    } else {
      setSelectedItem(null);
    }
  }, [items, selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Force agenda on phone-class viewports: the day/week/month grids all
  // have a `min-w-[560px]` floor, which would overflow a 360px screen.
  // Lets the user swap back to a grid once they're on a tablet+.
  useEffect(() => {
    if (isMobile && viewMode !== "agenda") setViewMode("agenda");
  }, [isMobile, viewMode]);

  // Hard-scope: filter every downstream view (agenda/day/week/month) to the
  // active familiar. Defensive null escape: bypass the filter entirely.
  const inScope = useMemo(
    () =>
      (familiarId: string | null | undefined): boolean =>
        scopeFamiliarIds
          ? familiarInScope(scopeFamiliarIds, familiarId)
          : activeFamiliarId == null || familiarId === activeFamiliarId,
    [scopeFamiliarIds, activeFamiliarId],
  );

  const scopedItems = useMemo(
    () =>
      items
        .filter((it) => inScope(it.familiarId))
        // Dismissed items are removed from the calendar so a Dismiss reads as
        // "gone"; done items stay (rendered with a completed treatment).
        .filter((it) => it.status !== "dismissed"),
    [items, inScope],
  );

  // Pending count for the header pill (computed once, not twice inline).
  const pendingCount = useMemo(
    () => scopedItems.filter((i) => i.status === "pending").length,
    [scopedItems],
  );

  // Open a specific day in the single-day view (from a month cell or an
  // all-day "+N more" overflow).
  const goToDay = (day: Date) => {
    setAnchor(day);
    setViewMode("day");
  };

  // Mirror the items hard-scope for deadlines, so a scoped familiar's calendar
  // only shows that familiar's task due-dates.
  const scopedDeadlines = useMemo(
    () => (deadlines ?? []).filter((d) => inScope(d.familiarId)),
    [deadlines, inScope],
  );

  // Per-familiar accent colour (explicit colour, else a stable derived hue).
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const familiarColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of resolvedFamiliars) m.set(f.id, familiarAccent(f.color, f.id));
    return m;
  }, [resolvedFamiliars]);
  const familiarNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of resolvedFamiliars) m.set(f.id, f.display_name);
    return m;
  }, [resolvedFamiliars]);
  const accentFor = useCallback(
    (familiarId: string | null | undefined) => (familiarId ? familiarColorById.get(familiarId) ?? null : null),
    [familiarColorById],
  );
  const nameFor = useCallback(
    (familiarId: string | null | undefined) => (familiarId ? familiarNameById.get(familiarId) ?? null : null),
    [familiarNameById],
  );

  // Legend: the distinct familiars that own something currently in view. Only
  // worth showing when ≥2 — with one (or none) there's nothing to disambiguate.
  const legendFamiliars = useMemo(() => {
    const ids = new Set<string>();
    for (const it of scopedItems) if (it.familiarId) ids.add(it.familiarId);
    for (const d of scopedDeadlines) if (d.familiarId) ids.add(d.familiarId);
    return [...ids]
      .map((id) => ({ id, name: familiarNameById.get(id) ?? id, color: familiarColorById.get(id) ?? "var(--accent-presence)" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedItems, scopedDeadlines, familiarNameById, familiarColorById]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedItem(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when focus is inside an editable field (incl. contenteditable).
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || target.isContentEditable) return;
      switch (e.key) {
        // A focused grid event or month day-cell owns its own Arrow handling
        // (roving nav + Alt+↑/↓ reschedule); don't also page the whole period
        // out from under it.
        case "ArrowLeft":  if (target.closest('[data-calendar-event="true"], [data-month-cell="true"]')) break; e.preventDefault(); navigate(-1); break;
        case "ArrowRight": if (target.closest('[data-calendar-event="true"], [data-month-cell="true"]')) break; e.preventDefault(); navigate(1);  break;
        case "t": case "T": setAnchor(new Date()); break;
        case "d": case "D": setViewMode("day");    break;
        case "w": case "W": setViewMode("week");   break;
        case "m": case "M": setViewMode("month");  break;
        case "a": case "A": setViewMode("agenda"); break;
        case "n": case "N":
          if (onAddEntry) { e.preventDefault(); onAddEntry({ fireAt: defaultEntryFireAt(anchor) }); }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // re-bind when viewMode/anchor changes so navigate() and the new-entry
    // shortcut close over the current values.
    // effectiveView folds in narrowPane, so the handlers re-bind when the
    // week→day fallback engages and navigate() steps by the visible unit.
  }, [effectiveView, anchor, onAddEntry]);

  function navigate(dir: -1 | 1) {
    setAnchor((prev) => {
      if (effectiveView === "day") return addDays(prev, dir);
      if (effectiveView === "week") return addDays(prev, dir * 7);
      if (effectiveView === "month") {
        const d = new Date(prev);
        d.setMonth(d.getMonth() + dir);
        return d;
      }
      // agenda: jump by 2 weeks
      return addDays(prev, dir * 14);
    });
  }

  function headingLabel(): string {
    if (effectiveView === "day") return fmtDateHeading(anchor);
    if (effectiveView === "week") {
      const ws = startOfWeek(anchor);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) {
        return `${MONTHS[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}, ${ws.getFullYear()}`;
      }
      return `${MONTHS[ws.getMonth()]} ${ws.getDate()} – ${MONTHS[we.getMonth()]} ${we.getDate()}, ${ws.getFullYear()}`;
    }
    if (effectiveView === "month") {
      return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    }
    return "Upcoming";
  }

  const VIEW_MODES: { id: ViewMode; label: string }[] = [
    { id: "agenda", label: "Agenda" },
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];

  // Announce view + period changes to screen readers — the grids convey the
  // current view and date visually only. Skips the initial mount.
  const { announce } = useAnnouncer();
  const announcedRef = useRef(false);
  useEffect(() => {
    if (!announcedRef.current) { announcedRef.current = true; return; }
    const label = VIEW_MODES.find((v) => v.id === effectiveView)?.label ?? "";
    announce(`${label} view, ${headingLabel()}`);
    // headingLabel() reads viewMode + anchor; re-announce whenever either moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveView, anchor, announce]);

  return (
    <FamiliarColorContext.Provider value={accentFor}>
    <FamiliarNameContext.Provider value={nameFor}>
    <div ref={containerRef} className="relative flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <div className="calendar-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-3 sm:gap-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-1">
          {/* Nav arrows */}
          <IconButton
            icon="ph:arrow-left-bold"
            aria-label="Previous"
            onClick={() => navigate(-1)}
            className="calendar-toolbar-icon"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAnchor(new Date())}
            className="calendar-toolbar-button"
          >
            Today
          </Button>
          <IconButton
            icon="ph:arrow-right-bold"
            aria-label="Next"
            onClick={() => navigate(1)}
            className="calendar-toolbar-icon"
          />
        </div>

        {/* Heading + pending pill + jump-to-date popover */}
        <div className="relative min-w-[120px] flex flex-1 items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            className="calendar-heading-button focus-ring truncate text-sm font-semibold text-[var(--text-primary)] transition-colors hover:text-[var(--accent-presence)]"
          >
            {headingLabel()}
          </button>
          {pendingCount > 0 && (
            <span className="shrink-0 rounded-full bg-[var(--bg-raised)] border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] font-medium tabular-nums">
              {pendingCount} pending
            </span>
          )}
          {pickerOpen ? (
            <MiniMonthPopover
              anchor={anchor}
              onPick={(d) => { setAnchor(d); setPickerOpen(false); }}
              onClose={() => setPickerOpen(false)}
            />
          ) : null}
        </div>

        {/* View mode toggle — hidden on phones (only agenda is usable
            there; see the useEffect that pins viewMode to "agenda"). */}
        <div role="group" aria-label="Calendar view" className="hidden max-w-full shrink-0 items-center overflow-hidden rounded-lg border border-[var(--border-hairline)] md:flex">
          {VIEW_MODES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              aria-pressed={viewMode === id}
              className={`focus-ring-inset inline-flex h-7 items-center px-2.5 text-[11px] transition-colors sm:px-3 ${
                viewMode === id
                  ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {onAddEntry ? (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:plus-bold"
            onClick={() => onAddEntry({ fireAt: defaultEntryFireAt(anchor) })}
            className="calendar-toolbar-button shrink-0"
          >
            Add event
          </Button>
        ) : null}
      </div>

      {/* Per-familiar colour legend — only when ≥2 familiars own items in view,
          so a single-familiar scope shows no noise. */}
      {legendFamiliars.length >= 2 && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)] sm:px-6"
          aria-label="Familiar colour legend"
        >
          {legendFamiliars.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: f.color }} />
              <span className="text-[var(--text-secondary)]">{f.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* View body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {effectiveView === "agenda" && (
          <AgendaView
            items={scopedItems}
            deadlines={scopedDeadlines}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onOpenItem={(item) => setSelectedItem(item)}
            onOpenDeadline={onOpenDeadline}
          />
        )}
        {effectiveView === "day" && (
          <DayView
            items={scopedItems}
            deadlines={scopedDeadlines}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onReschedule={onReschedule}
            onOpenItem={(item) => setSelectedItem(item)}
            onOpenDeadline={onOpenDeadline}
          />
        )}
        {effectiveView === "week" && (
          <WeekView
            items={scopedItems}
            deadlines={scopedDeadlines}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onReschedule={onReschedule}
            onOpenItem={(item) => setSelectedItem(item)}
            onOpenDeadline={onOpenDeadline}
            onOpenDay={goToDay}
          />
        )}
        {effectiveView === "month" && (
          <MonthView
            items={scopedItems}
            deadlines={scopedDeadlines}
            anchor={anchor}
            onOpenItem={(item) => setSelectedItem(item)}
            onAddEntry={onAddEntry}
            onOpenDeadline={onOpenDeadline}
            onDayClick={goToDay}
          />
        )}
      </div>
      {/* Keyboard hints moved to the canonical ⌘/ Shortcuts sheet (§8 chrome
          diet — a permanently visible footer bar was chrome documenting
          chrome). The single-key bindings themselves are unchanged. */}
      {selectedItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onOpen={onOpenItem}
          onComplete={onComplete}
          onDismiss={onDismiss}
          onSnooze={onSnooze}
        />
      )}
    </div>
    </FamiliarNameContext.Provider>
    </FamiliarColorContext.Provider>
  );
}
