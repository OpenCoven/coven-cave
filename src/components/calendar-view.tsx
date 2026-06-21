"use client";

import { useId, useMemo, useState, useRef, useEffect } from "react";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { formatClock, formatDate, readDateTimePrefs } from "@/lib/datetime-format";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { SnoozeMenu } from "@/components/snooze-menu";
import { itemDate, packEventColumns } from "@/lib/calendar-layout";
import { useIsMobile } from "@/lib/use-viewport";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "agenda" | "day" | "week" | "month";

type Props = {
  items: InboxItem[];
  familiars: Familiar[];
  /** When set, the calendar hard-scopes to items belonging to this familiar.
   *  Defensive null escape: bypass the familiar filter entirely. Mirrors
   *  BoardView's hard-scope. */
  activeFamiliarId?: string | null;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
  /** Mark an item done. Optimistic; the SSE stream reconciles. */
  onComplete?: (id: string) => void;
  /** Dismiss (remove) an item. */
  onDismiss?: (id: string) => void;
  /** Snooze an item until the given ISO timestamp. */
  onSnooze?: (id: string, untilIso: string) => void;
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
function relDayWord(date: Date): string | null {
  const days = Math.round(
    (startOfDay(date).getTime() - startOfDay(new Date()).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return null;
}

function agendaDayLabel(date: Date): string {
  return relDayWord(date) ?? fmtDateHeading(date);
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
  if (target.getTime() > now.getTime()) return target.toISOString();

  const fallback = new Date(now);
  fallback.setMinutes(Math.ceil((fallback.getMinutes() + 5) / 15) * 15, 0, 0);
  return fallback.toISOString();
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

function ItemChip({
  item,
  onClick,
}: {
  item: InboxItem;
  onClick?: () => void;
}) {
  const done = item.status === "done";
  return (
    <button
      onClick={onClick}
      className={`focus-ring group flex w-full items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2 py-2.5 text-left text-[13px] transition-colors md:py-1 md:text-[11px] ${done ? "bg-[var(--bg-base)] opacity-60 hover:bg-[var(--bg-raised)]" : "bg-[var(--bg-raised)] hover:bg-[var(--bg-elevated)]"}`}
    >
      {done
        ? <Icon name="ph:check-circle" className="shrink-0 text-[var(--text-muted)] text-[12px]" />
        : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(item)}`} />}
      <Icon
        name={platformIcon(item)}
        className="shrink-0 text-[var(--text-muted)] text-[12px]"
      />
      <span className={`flex-1 truncate text-[var(--text-primary)] ${done ? "line-through" : ""}`}>{item.title}</span>
      {(item.fireAt ?? item.firedAt) && (
        <span className="shrink-0 text-[var(--text-muted)]">
          {fmtTime((item.fireAt ?? item.firedAt)!)}
        </span>
      )}
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
        <button
          type="button"
          onClick={onAddEntry}
          className="calendar-empty-action inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
        >
          <Icon name="ph:plus" width={12} />
          Add task or event
        </button>
      ) : null}
    </div>
  );
}

// ─── Agenda view ──────────────────────────────────────────────────────────────

function AgendaView({
  items,
  anchor,
  onAddEntry,
  onOpenItem,
}: {
  items: InboxItem[];
  anchor: Date;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
}) {
  const [showPast, setShowPast] = useState(false);

  const pastCount = useMemo(
    () => items.filter((it) => {
      const d = itemDate(it);
      return d && d < startOfDay(anchor);
    }).length,
    [items, anchor],
  );

  // Group items by date, then filter / sort based on showPast.
  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: InboxItem[] }>();
    for (const item of items) {
      const d = itemDate(item);
      if (!d) continue;
      const key = startOfDay(d).toISOString();
      if (!map.has(key)) map.set(key, { date: startOfDay(d), items: [] });
      map.get(key)!.items.push(item);
    }
    return Array.from(map.values())
      .filter((g) => showPast ? true : g.date >= startOfDay(anchor))
      .sort((a, b) => showPast
        ? b.date.getTime() - a.date.getTime()
        : a.date.getTime() - b.date.getTime());
  }, [items, anchor, showPast]);

  if (groups.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center text-sm text-[var(--text-muted)]">
        <Icon name="ph:calendar-blank" width={32} className="text-[var(--text-muted)]" />
        <div>Nothing scheduled upcoming.</div>
        {pastCount > 0 && !showPast ? (
          <button
            type="button"
            onClick={() => setShowPast(true)}
            className="calendar-empty-action focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            Show {pastCount} past item{pastCount !== 1 ? "s" : ""}
          </button>
        ) : null}
        {onAddEntry ? (
          <button
            type="button"
            onClick={() => onAddEntry({ fireAt: defaultEntryFireAt(anchor) })}
            className="calendar-empty-action focus-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:plus" width={11} />
            Add task or event
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 overflow-y-auto px-3 py-4 sm:px-6">
      {showPast ? (
        <div className="-mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => setShowPast(false)}
            className="calendar-empty-action focus-ring rounded-md px-2 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            Hide past
          </button>
        </div>
      ) : null}
      {groups.map(({ date, items: groupItems }) => (
        <div key={date.toISOString()}>
          <div className="mb-2 flex items-center gap-2 rounded-md border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] px-3 py-1.5">
            <span
              className={`text-[12px] font-bold uppercase tracking-wider ${
                isSameDay(date, new Date())
                  ? "text-[var(--accent-presence)]"
                  : "text-[var(--text-primary)]"
              }`}
            >
              {agendaDayLabel(date)}
            </span>
            <span className="ml-auto font-mono text-[11px] text-[var(--text-secondary)] opacity-80">
              {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {[...groupItems]
              .sort((a, b) => {
                const ta = new Date(a.fireAt ?? a.createdAt).getTime();
                const tb = new Date(b.fireAt ?? b.createdAt).getTime();
                return ta - tb;
              })
              .map((item) => (
                <ItemChip
                  key={item.id}
                  item={item}
                  onClick={() => onOpenItem?.(item)}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── All-day strip ───────────────────────────────────────────────────────────

const MAX_ALLDAY_VISIBLE = 3;

function AllDayStrip({
  columns,
  onOpenItem,
  onDayClick,
}: {
  columns: { date: Date; items: InboxItem[] }[];
  onOpenItem?: (item: InboxItem) => void;
  onDayClick?: (day: Date) => void;
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
        {columns.map((col, i) => (
          <div key={i} className="flex-1 min-w-[80px] flex flex-col gap-0.5 p-1">
            {col.items.slice(0, MAX_ALLDAY_VISIBLE).map((item) => (
              <button
                key={item.id}
                onClick={() => onOpenItem?.(item)}
                className="focus-ring-inset flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] bg-[var(--accent-presence)]/15 border border-[var(--accent-presence)]/30 hover:bg-[var(--accent-presence)]/25 transition-colors w-full text-left truncate"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(item)}`} />
                <span className="truncate text-[var(--text-primary)]">{item.title}</span>
              </button>
            ))}
            {col.items.length > MAX_ALLDAY_VISIBLE && (
              <button
                onClick={() => onDayClick?.(col.date)}
                className="focus-ring-inset text-[9px] text-[var(--text-muted)] px-1 hover:text-[var(--accent-presence)] transition-colors text-left w-full"
                title={`${col.items.length - MAX_ALLDAY_VISIBLE} more — click to see all`}
              >
                +{col.items.length - MAX_ALLDAY_VISIBLE} more
              </button>
            )}
          </div>
        ))}
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

function TimeGrid({
  columns,
  onOpenItem,
  onAddEntry,
}: {
  columns: { label: string; date: Date; isToday: boolean; items: InboxItem[] }[];
  onOpenItem?: (item: InboxItem) => void;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
}) {
  const nowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const today = new Date();

  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: "center" });
  }, []);

  useRovingTabIndex({
    containerRef: gridRef,
    itemSelector: '[data-calendar-event="true"]',
    orientation: "vertical",
  });

  const totalHeight = 24 * HOUR_HEIGHT;
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;

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
            className={`calendar-daycol flex-1 relative min-w-[80px] ${
              col.isToday ? "bg-[color-mix(in_oklch,var(--accent-presence)_6%,transparent)]" : ""
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
                    slot.setHours(hour, 0, 0, 0);
                    onAddEntry({ fireAt: slot.toISOString() });
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

            {/* Current time indicator (today's column only) */}
            {col.isToday && (
              <div
                ref={nowRef}
                className="absolute left-0 right-0 flex items-center z-10"
                style={{ top: nowTop }}
              >
                <div className="h-2 w-2 rounded-full bg-[var(--accent-presence)] -ml-1 shrink-0" />
                <div className="flex-1 h-px bg-[var(--accent-presence)]" />
              </div>
            )}

            {/* Items — lane-packed so overlaps sit side by side */}
            {packEventColumns(col.items).map((ev) => {
              const widthPct = 100 / ev.lanes;
              const leftPct = ev.lane * widthPct;
              const height = Math.max(18, ((ev.end - ev.start) / 60) * HOUR_HEIGHT - 2);
              const done = ev.item.status === "done";
              return (
                <button
                  key={ev.item.id}
                  type="button"
                  data-calendar-event="true"
                  onClick={() => onOpenItem?.(ev.item)}
                  title={ev.item.title}
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
                  }}
                >
                  {done
                    ? <Icon name="ph:check" width={9} className="shrink-0 text-[var(--text-muted)]" />
                    : <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(ev.item)}`} />}
                  <span className={`truncate ${done ? "line-through" : ""}`}>{ev.item.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Day view ─────────────────────────────────────────────────────────────────

function DayView({
  items,
  anchor,
  onAddEntry,
  onOpenItem,
}: {
  items: InboxItem[];
  anchor: Date;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
}) {
  const today = new Date();

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

  const columns = useMemo(() => [{
    label: fmtDateHeading(anchor),
    date: anchor,
    isToday: isSameDay(anchor, today),
    items: timedItems,
  }], [anchor, timedItems]);


  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-3 py-3 sm:px-6">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          {relDayWord(anchor) ? (
            <span className="text-[var(--accent-presence)]">{relDayWord(anchor)} · </span>
          ) : null}
          {fmtDateHeading(anchor)}
        </h2>
      </div>
      {/* All-day strip */}
      {allDayItems.length > 0 && (
        <AllDayStrip
          columns={[{ date: anchor, items: allDayItems }]}
          onOpenItem={onOpenItem}
        />
      )}
      {/* Time grid — always rendered for visual parity with Week */}
      <div className="relative flex flex-1 overflow-hidden">
        <TimeGrid columns={columns} onOpenItem={onOpenItem} onAddEntry={onAddEntry} />
      </div>
    </div>
  );
}

// ─── Week view ────────────────────────────────────────────────────────────────

function WeekView({
  items,
  anchor,
  onAddEntry,
  onOpenItem,
}: {
  items: InboxItem[];
  anchor: Date;
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
}) {
  const weekStart = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  const columns = useMemo(() => {
    return days.map((day) => ({
      label: `${WEEKDAYS[day.getDay()]} ${day.getDate()}`,
      date: day,
      isToday: isSameDay(day, today),
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
              className={`group relative flex-1 min-w-[80px] px-2 py-2 text-center ${
                col.isToday ? "bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)]" : ""
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
                  col.isToday ? "text-[var(--accent-presence)]" : "text-[var(--text-primary)]"
                }`}
              >
                {col.date.getDate()}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* All-day strip */}
      {allDayColumns.some((c) => c.items.length > 0) && (
        <AllDayStrip columns={allDayColumns} onOpenItem={onOpenItem} />
      )}
      <div className="relative flex flex-1 overflow-hidden">
        <TimeGrid columns={columns} onOpenItem={onOpenItem} onAddEntry={onAddEntry} />
      </div>
    </div>
  );
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({
  items,
  anchor,
  onOpenItem,
  onDayClick,
  onAddEntry,
}: {
  items: InboxItem[];
  anchor: Date;
  onOpenItem?: (item: InboxItem) => void;
  onDayClick?: (day: Date) => void;
  onAddEntry?: (opts: { fireAt: string }) => void;
}) {
  const today = new Date();
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);

  // 6 weeks × 7 days grid
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const byDay = useMemo(() => {
    const map = new Map<string, InboxItem[]>();
    for (const item of items) {
      const d = itemDate(item);
      if (!d) continue;
      const key = startOfDay(d).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden px-2 pb-3 sm:px-4 sm:pb-4">
      {/* Weekday headers */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-w-[560px] flex-col">
          <div className="mb-1 grid grid-cols-7">
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                className="py-1 text-center text-[10px] uppercase tracking-wider text-[var(--text-secondary)]"
              >
                {wd}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-lg bg-[var(--border-hairline)]">
            {cells.map((day, i) => {
              const key = startOfDay(day).toISOString();
              const dayItems = byDay.get(key) ?? [];
              const isCurrentMonth = day.getMonth() === anchor.getMonth();
              const isToday = isSameDay(day, today);

              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={`${fmtDateHeading(day)}${dayItems.length ? `, ${dayItems.length} item${dayItems.length !== 1 ? "s" : ""}` : ""}`}
                  onClick={() => onDayClick?.(day)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDayClick?.(day);
                    }
                  }}
                  className={`group relative focus-ring-inset flex cursor-pointer flex-col overflow-hidden p-1.5 transition-colors ${
                    isCurrentMonth
                      ? "bg-[var(--bg-panel)] hover:bg-[var(--bg-raised)]"
                      : "bg-[var(--bg-base)] hover:bg-[var(--bg-panel)]"
                  } ${isToday ? "ring-1 ring-inset ring-[var(--accent-presence)]" : ""}`}
                >
                  {onAddEntry && isCurrentMonth && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddEntry({ fireAt: defaultEntryFireAt(day) });
                      }}
                      aria-label={`Add a reminder on ${fmtDateHeading(day)}`}
                      title="Add reminder"
                      className="focus-ring absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-presence)] group-hover:flex group-focus-within:flex"
                    >
                      <Icon name="ph:plus" width={10} aria-hidden />
                    </button>
                  )}
                  <span
                    className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ${
                      isToday
                        ? "bg-[var(--accent-presence)] text-white"
                        : isCurrentMonth
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {dayItems.slice(0, 3).map((item) => {
                      const done = item.status === "done";
                      return (
                      <button
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenItem?.(item);
                        }}
                        title={item.title}
                        className={`focus-ring flex w-full items-center gap-1 rounded border border-[var(--border-hairline)] px-1 py-0.5 text-left text-[9px] ${done ? "bg-[var(--bg-base)] opacity-60 hover:bg-[var(--bg-raised)]" : "bg-[var(--bg-raised)] hover:bg-[var(--bg-elevated)]"}`}
                      >
                        {done
                          ? <Icon name="ph:check" width={8} className="shrink-0 text-[var(--text-muted)]" />
                          : <span className={`h-1 w-1 shrink-0 rounded-full ${urgencyColor(item)}`} />}
                        <span className={`truncate text-[var(--text-primary)] ${done ? "line-through" : ""}`}>{item.title}</span>
                      </button>
                      );
                    })}
                    {dayItems.length > 3 && (
                      <button
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const monthStart = view;
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Jump to date"
      className="absolute top-full left-0 z-20 mt-2 w-[260px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setView((d) => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}
          className="focus-ring grid h-6 w-6 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          aria-label="Previous month"
        >
          <Icon name="ph:arrow-left-bold" width={10} />
        </button>
        <span className="text-[12px] font-medium text-[var(--text-primary)]">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => setView((d) => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}
          className="focus-ring grid h-6 w-6 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          aria-label="Next month"
        >
          <Icon name="ph:arrow-right-bold" width={10} />
        </button>
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
              className={`focus-ring h-7 w-full rounded text-[11px] transition-colors ${
                isAnchor
                  ? "bg-[var(--accent-presence)] text-white"
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
      <button
        type="button"
        onClick={() => onPick(today)}
        className="focus-ring mt-2 w-full rounded-md border border-[var(--border-hairline)] py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
      >
        Today
      </button>
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
  useFocusTrap(true, panelRef, { onEscape: onClose });

  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  const body = (item as unknown as { body?: string }).body;
  const openLabel = openTargetLabel(item);
  const isDone = item.status === "done";

  return (
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
        <button
          onClick={onClose}
          aria-label="Close"
          className="focus-ring shrink-0 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Icon name="ph:x" width={14} />
        </button>
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
          <button
            onClick={() => { onOpen(item); onClose(); }}
            className="focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] text-white transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)]"
          >
            <Icon name="ph:arrow-square-out" width={12} />
            {openLabel}
          </button>
        ) : null}
        <div className="flex items-center gap-2">
          {!isDone && onComplete ? (
            <button
              onClick={() => { onComplete(item.id); onClose(); }}
              className="focus-ring inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:check" width={12} />
              Done
            </button>
          ) : null}
          {onSnooze ? (
            <SnoozeMenu
              className="shrink-0"
              onSnooze={(untilIso) => { onSnooze(item.id, untilIso); onClose(); }}
            />
          ) : null}
          {onDismiss ? (
            <button
              onClick={() => { onDismiss(item.id); onClose(); }}
              aria-label="Dismiss"
              className="focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              title="Dismiss"
            >
              <Icon name="ph:trash" width={12} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Main CalendarView ────────────────────────────────────────────────────────

export function CalendarView({ items, familiars, activeFamiliarId, onAddEntry, onOpenItem, onComplete, onDismiss, onSnooze }: Props) {
  const isMobile = useIsMobile();
  // SSR returns false from useIsMobile, so initial render is always "week"
  // on the server; the effect below snaps to agenda on mount when the
  // viewport actually matches mobile. Keeps server/client markup in sync.
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Force agenda on phone-class viewports: the day/week/month grids all
  // have a `min-w-[560px]` floor, which would overflow a 360px screen.
  // Lets the user swap back to a grid once they're on a tablet+.
  useEffect(() => {
    if (isMobile && viewMode !== "agenda") setViewMode("agenda");
  }, [isMobile, viewMode]);

  // Hard-scope: filter every downstream view (agenda/day/week/month) to the
  // active familiar. Defensive null escape: bypass the filter entirely.
  const scopedItems = useMemo(
    () =>
      (activeFamiliarId == null
        ? items
        : items.filter((it) => it.familiarId === activeFamiliarId)
      // Dismissed items are removed from the calendar so a Dismiss reads as
      // "gone"; done items stay (rendered with a completed treatment).
      ).filter((it) => it.status !== "dismissed"),
    [items, activeFamiliarId],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedItem(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      // Don't fire when focus is inside an editable field (incl. contenteditable).
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || target.isContentEditable) return;
      switch (e.key) {
        case "ArrowLeft":  e.preventDefault(); navigate(-1); break;
        case "ArrowRight": e.preventDefault(); navigate(1);  break;
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
  }, [viewMode, anchor, onAddEntry]);

  function navigate(dir: -1 | 1) {
    setAnchor((prev) => {
      if (viewMode === "day") return addDays(prev, dir);
      if (viewMode === "week") return addDays(prev, dir * 7);
      if (viewMode === "month") {
        const d = new Date(prev);
        d.setMonth(d.getMonth() + dir);
        return d;
      }
      // agenda: jump by 2 weeks
      return addDays(prev, dir * 14);
    });
  }

  function headingLabel(): string {
    if (viewMode === "day") return fmtDateHeading(anchor);
    if (viewMode === "week") {
      const ws = startOfWeek(anchor);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) {
        return `${MONTHS[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}, ${ws.getFullYear()}`;
      }
      return `${MONTHS[ws.getMonth()]} ${ws.getDate()} – ${MONTHS[we.getMonth()]} ${we.getDate()}, ${ws.getFullYear()}`;
    }
    if (viewMode === "month") {
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

  return (
    <div ref={containerRef} className="relative flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <div className="calendar-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-3 sm:gap-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-1">
          {/* Nav arrows */}
          <button
            onClick={() => navigate(-1)}
            aria-label="Previous"
            className="calendar-toolbar-icon focus-ring grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:arrow-left-bold" width={12} />
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="calendar-toolbar-button focus-ring inline-flex h-7 items-center rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Today
          </button>
          <button
            onClick={() => navigate(1)}
            aria-label="Next"
            className="calendar-toolbar-icon focus-ring grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:arrow-right-bold" width={12} />
          </button>
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
          {scopedItems.filter((i) => i.status === "pending").length > 0 && (
            <span className="shrink-0 rounded-full bg-[var(--bg-raised)] border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] font-medium tabular-nums">
              {scopedItems.filter((i) => i.status === "pending").length} pending
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
        <div className="hidden max-w-full shrink-0 items-center overflow-hidden rounded-lg border border-[var(--border-hairline)] md:flex">
          {VIEW_MODES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              className={`focus-ring-inset inline-flex h-7 items-center px-2.5 text-[11px] transition-colors sm:px-3 ${
                viewMode === id
                  ? "bg-[var(--accent-presence)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {onAddEntry ? (
          <button
            type="button"
            onClick={() => onAddEntry({ fireAt: defaultEntryFireAt(anchor) })}
            aria-label="Add event"
            className="calendar-toolbar-button focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:plus-bold" width={10} />
            Add event
          </button>
        ) : null}
      </div>

      {/* View body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {viewMode === "agenda" && (
          <AgendaView
            items={scopedItems}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onOpenItem={(item) => setSelectedItem(item)}
          />
        )}
        {viewMode === "day" && (
          <DayView
            items={scopedItems}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onOpenItem={(item) => setSelectedItem(item)}
          />
        )}
        {viewMode === "week" && (
          <WeekView
            items={scopedItems}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onOpenItem={(item) => setSelectedItem(item)}
          />
        )}
        {viewMode === "month" && (
          <MonthView
            items={scopedItems}
            anchor={anchor}
            onOpenItem={(item) => setSelectedItem(item)}
            onAddEntry={onAddEntry}
            onDayClick={(day) => {
              setAnchor(day);
              setViewMode("day");
            }}
          />
        )}
      </div>
      {/* Keyboard hint — hidden on coarse-pointer / narrow viewports
          where the single-key shortcuts can't be triggered. */}
      <footer
        className="hidden shrink-0 border-t border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)] sm:px-6 md:block"
      >
        ← → navigate · T today · D Day · W Week · M Month · A Agenda{onAddEntry ? " · N new" : ""}
      </footer>
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
  );
}
