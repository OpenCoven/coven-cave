"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "agenda" | "day" | "week" | "month";

type Props = {
  items: InboxItem[];
  familiars: Familiar[];
  onAddEntry?: (defaults?: { fireAt?: string; title?: string; whenText?: string }) => void;
  onOpenItem?: (item: InboxItem) => void;
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
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDateHeading(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function fmtHourLabel(h: number): string {
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

function defaultWeekEntryFireAt(anchor: Date): string {
  const weekStart = startOfWeek(anchor);
  const today = startOfDay(new Date());
  const day =
    Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).find(
      (candidate) => startOfDay(candidate).getTime() >= today.getTime(),
    ) ?? weekStart;
  return defaultEntryFireAt(day);
}

function itemDate(item: InboxItem): Date | null {
  const iso = item.fireAt ?? item.firedAt ?? item.createdAt;
  if (!iso) return null;
  return new Date(iso);
}

function urgencyColor(item: InboxItem): string {
  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  if (!meta) return "bg-[var(--text-muted)]";
  if (meta.urgency === "expiring") return "bg-[var(--accent-presence)]";
  if (meta.urgency === "time-sensitive") return "bg-[var(--color-warning)]";
  return "bg-[var(--text-muted)]";
}

function platformIcon(item: InboxItem): IconName {
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
  return (
    <button
      onClick={onClick}
      className="focus-ring flex w-full items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-left text-[11px] hover:bg-[var(--bg-elevated)] transition-colors group"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(item)}`} />
      <Icon
        name={platformIcon(item)}
        className="shrink-0 text-[var(--text-muted)] text-[12px]"
      />
      <span className="flex-1 truncate text-[var(--text-primary)]">{item.title}</span>
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
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
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
  // Group items by date, sorted ascending from anchor
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
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .filter((g) => g.date >= startOfDay(anchor));
  }, [items, anchor]);

  if (groups.length === 0) {
    return (
      <EmptyScheduleState
        icon="ph:calendar-blank"
        label="Nothing scheduled"
        onAddEntry={
          onAddEntry
            ? () => onAddEntry({ fireAt: defaultEntryFireAt(anchor) })
            : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 overflow-y-auto px-3 py-4 sm:px-6">
      {groups.map(({ date, items: groupItems }) => (
        <div key={date.toISOString()}>
          <div className="mb-2 flex items-center gap-3">
            <span
              className={`text-[11px] font-semibold uppercase tracking-wider ${
                isSameDay(date, new Date())
                  ? "text-[var(--accent-presence)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {isSameDay(date, new Date()) ? "Today" : fmtDateHeading(date)}
            </span>
            <div className="flex-1 h-px bg-[var(--border-hairline)]" />
            <span className="text-[10px] text-[var(--text-muted)]">
              {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {groupItems
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
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] bg-[var(--accent-presence)]/15 border border-[var(--accent-presence)]/30 hover:bg-[var(--accent-presence)]/25 transition-colors w-full text-left truncate"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(item)}`} />
                <span className="truncate text-[var(--text-primary)]">{item.title}</span>
              </button>
            ))}
            {col.items.length > MAX_ALLDAY_VISIBLE && (
              <button
                onClick={() => onDayClick?.(col.date)}
                className="text-[9px] text-[var(--text-muted)] px-1 hover:text-[var(--accent-presence)] transition-colors text-left w-full"
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
}: {
  columns: { label: string; date: Date; isToday: boolean; items: InboxItem[] }[];
  onOpenItem?: (item: InboxItem) => void;
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

  function itemTop(item: InboxItem): number {
    const d = itemDate(item);
    if (!d) return 0;
    return (d.getHours() + d.getMinutes() / 60) * HOUR_HEIGHT;
  }

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
            className="absolute right-2 text-[9px] text-[var(--text-muted)] -translate-y-1/2"
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
          <div key={ci} className="flex-1 relative min-w-[80px]" style={{ height: totalHeight }}>
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

            {/* Items */}
            {col.items
              .filter((it) => itemDate(it) !== null)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-calendar-event="true"
                  onClick={() => onOpenItem?.(item)}
                  className="absolute left-1 right-1 rounded px-1.5 py-0.5 text-left text-[10px] bg-[var(--accent-presence)]/15 border border-[var(--accent-presence)]/30 hover:bg-[var(--accent-presence)]/25 transition-colors overflow-hidden"
                  style={{
                    top: itemTop(item) + 1,
                    minHeight: 20,
                  }}
                >
                  <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${urgencyColor(item)}`} />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
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

  const isEmpty = timedItems.length === 0 && allDayItems.length === 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-3 py-3 sm:px-6">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
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
        <TimeGrid columns={columns} onOpenItem={onOpenItem} />
        {isEmpty && onAddEntry ? (
          <button
            type="button"
            onClick={() => onAddEntry({ fireAt: defaultEntryFireAt(anchor) })}
            className="focus-ring absolute top-3 right-3 z-10 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/80 px-2.5 py-1 text-[11px] text-[var(--text-secondary)] backdrop-blur transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            + Add event
          </button>
        ) : null}
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

  const isWeekEmpty =
    columns.every((col) => col.items.length === 0) &&
    allDayColumns.every((col) => col.items.length === 0);

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
              className={`flex-1 min-w-[80px] px-2 py-2 text-center ${
                col.isToday ? "bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)]" : ""
              }`}
            >
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
        <TimeGrid columns={columns} onOpenItem={onOpenItem} />
        {isWeekEmpty && onAddEntry ? (
          <button
            type="button"
            onClick={() => onAddEntry({ fireAt: defaultWeekEntryFireAt(anchor) })}
            className="focus-ring absolute top-3 right-3 z-10 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/80 px-2.5 py-1 text-[11px] text-[var(--text-secondary)] backdrop-blur transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            + Add event
          </button>
        ) : null}
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
}: {
  items: InboxItem[];
  anchor: Date;
  onOpenItem?: (item: InboxItem) => void;
  onDayClick?: (day: Date) => void;
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
                  onClick={() => onDayClick?.(day)}
                  className={`flex cursor-pointer flex-col overflow-hidden p-1.5 transition-colors ${
                    isCurrentMonth
                      ? "bg-[var(--bg-panel)] hover:bg-[var(--bg-raised)]"
                      : "bg-[var(--bg-base)] hover:bg-[var(--bg-panel)]"
                  }`}
                >
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
                    {dayItems.slice(0, 3).map((item) => (
                      <button
                        key={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenItem?.(item);
                        }}
                        className="focus-ring flex w-full items-center gap-1 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1 py-0.5 text-left text-[9px] hover:bg-[var(--bg-elevated)]"
                      >
                        <span className={`h-1 w-1 shrink-0 rounded-full ${urgencyColor(item)}`} />
                        <span className="truncate text-[var(--text-primary)]">{item.title}</span>
                      </button>
                    ))}
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

function ItemDetailPanel({
  item,
  onClose,
}: {
  item: InboxItem;
  onClose: () => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const SNOOZE_OPTIONS = [
    { label: "1 hour",   ms: 60 * 60 * 1000 },
    { label: "3 hours",  ms: 3 * 60 * 60 * 1000 },
    { label: "Tomorrow", ms: 24 * 60 * 60 * 1000 },
  ];
  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;

  return (
    <div className="cave-cal-detail-panel">
      <div className="cave-cal-detail-header">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={platformIcon(item)} className="shrink-0 text-[var(--text-muted)] text-[14px]" />
          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
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
              {new Date((item.fireAt ?? item.firedAt)!).toLocaleString(undefined, {
                weekday: "short", month: "short", day: "numeric",
                hour: "numeric", minute: "2-digit",
              })}
            </span>
          </div>
        )}
        {(item as unknown as { body?: string }).body && (
          <p className="text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
            {(item as unknown as { body: string }).body}
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[var(--border-hairline)] flex gap-2">
        <button
          onClick={onClose}
          className="focus-ring flex-1 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
        >
          Dismiss
        </button>
        <div className="relative flex-1">
          <button
            onClick={() => setSnoozeOpen((v) => !v)}
            className="focus-ring w-full rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] text-white transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)]"
          >
            Snooze →
          </button>
          {snoozeOpen && (
            <div className="absolute bottom-full right-0 mb-1 w-32 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] shadow-lg overflow-hidden z-10">
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => { setSnoozeOpen(false); onClose(); }}
                  className="focus-ring w-full px-3 py-2 text-left text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main CalendarView ────────────────────────────────────────────────────────

export function CalendarView({ items, familiars, onAddEntry, onOpenItem }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      // Don't fire when focus is inside input/textarea/select
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      switch (e.key) {
        case "ArrowLeft":  e.preventDefault(); navigate(-1); break;
        case "ArrowRight": e.preventDefault(); navigate(1);  break;
        case "t": case "T": setAnchor(new Date()); break;
        case "d": case "D": setViewMode("day");    break;
        case "w": case "W": setViewMode("week");   break;
        case "m": case "M": setViewMode("month");  break;
        case "a": case "A": setViewMode("agenda"); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode]); // re-bind when viewMode changes so navigate() closure is current

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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-3 sm:gap-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-1">
          {/* Nav arrows */}
          <button
            onClick={() => navigate(-1)}
            aria-label="Previous"
            className="focus-ring grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:arrow-left-bold" width={12} />
          </button>
          <button
            onClick={() => setAnchor(new Date())}
            className="focus-ring rounded-md border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Today
          </button>
          <button
            onClick={() => navigate(1)}
            aria-label="Next"
            className="focus-ring grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:arrow-right-bold" width={12} />
          </button>
        </div>

        {/* Heading + pending pill */}
        <div className="min-w-[120px] flex flex-1 items-center gap-2 min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {headingLabel()}
          </h2>
          {items.filter((i) => i.status === "pending").length > 0 && (
            <span className="shrink-0 rounded-full bg-[var(--bg-raised)] border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] font-medium tabular-nums">
              {items.filter((i) => i.status === "pending").length} pending
            </span>
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex max-w-full shrink-0 items-center overflow-hidden rounded-lg border border-[var(--border-hairline)]">
          {VIEW_MODES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              className={`focus-ring-inset px-2.5 py-1 text-[11px] transition-colors sm:px-3 ${
                viewMode === id
                  ? "bg-[var(--accent-presence)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* View body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {viewMode === "agenda" && (
          <AgendaView
            items={items}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onOpenItem={(item) => setSelectedItem(item)}
          />
        )}
        {viewMode === "day" && (
          <DayView
            items={items}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onOpenItem={(item) => setSelectedItem(item)}
          />
        )}
        {viewMode === "week" && (
          <WeekView
            items={items}
            anchor={anchor}
            onAddEntry={onAddEntry}
            onOpenItem={(item) => setSelectedItem(item)}
          />
        )}
        {viewMode === "month" && (
          <MonthView
            items={items}
            anchor={anchor}
            onOpenItem={(item) => setSelectedItem(item)}
            onDayClick={(day) => {
              setAnchor(day);
              setViewMode("day");
            }}
          />
        )}
      </div>
      {selectedItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
