"use client";

import { useMemo, useState } from "react";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "agenda" | "day" | "week" | "month";

type Props = {
  items: InboxItem[];
  familiars: Familiar[];
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

function itemDate(item: InboxItem): Date | null {
  const iso = item.fireAt ?? item.firedAt ?? item.createdAt;
  if (!iso) return null;
  return new Date(iso);
}

function urgencyColor(item: InboxItem): string {
  const meta = (item as unknown as { comms?: { urgency?: string } }).comms;
  if (!meta) return "bg-[var(--text-muted)]";
  if (meta.urgency === "expiring") return "bg-[#8E3DFF]";
  if (meta.urgency === "time-sensitive") return "bg-amber-400";
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
      className="flex w-full items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2 py-1 text-left text-[11px] hover:bg-[var(--bg-elevated)] transition-colors group"
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

// ─── Agenda view ──────────────────────────────────────────────────────────────

function AgendaView({
  items,
  anchor,
  onOpenItem,
}: {
  items: InboxItem[];
  anchor: Date;
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
      <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)] text-sm gap-2">
        <Icon name="ph:calendar-blank" className="text-3xl opacity-30" />
        <span>Nothing scheduled</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-4 overflow-y-auto">
      {groups.map(({ date, items: groupItems }) => (
        <div key={date.toISOString()}>
          <div className="mb-2 flex items-center gap-3">
            <span
              className={`text-[11px] font-semibold uppercase tracking-wider ${
                isSameDay(date, new Date())
                  ? "text-[#8E3DFF]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {isSameDay(date, new Date()) ? "Today" : fmtDateHeading(date)}
            </span>
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
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

// ─── Day view ─────────────────────────────────────────────────────────────────

function DayView({
  items,
  anchor,
  onOpenItem,
}: {
  items: InboxItem[];
  anchor: Date;
  onOpenItem?: (item: InboxItem) => void;
}) {
  const dayItems = useMemo(
    () =>
      items
        .filter((it) => {
          const d = itemDate(it);
          return d && isSameDay(d, anchor);
        })
        .sort((a, b) => {
          const ta = new Date(a.fireAt ?? a.createdAt).getTime();
          const tb = new Date(b.fireAt ?? b.createdAt).getTime();
          return ta - tb;
        }),
    [items, anchor]
  );

  return (
    <div className="flex flex-col px-6 py-4 gap-4 overflow-y-auto">
      <h2 className="text-sm font-medium text-[var(--text-primary)]">
        {fmtDateHeading(anchor)}
      </h2>
      {dayItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] text-sm gap-2">
          <Icon name="ph:sun" className="text-3xl opacity-30" />
          <span>Nothing scheduled for this day</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {dayItems.map((item) => (
            <ItemChip key={item.id} item={item} onClick={() => onOpenItem?.(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Week view ────────────────────────────────────────────────────────────────

function WeekView({
  items,
  anchor,
  onOpenItem,
}: {
  items: InboxItem[];
  anchor: Date;
  onOpenItem?: (item: InboxItem) => void;
}) {
  const weekStart = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  const byDay = useMemo(() => {
    const map = new Map<number, InboxItem[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const item of items) {
      const d = itemDate(item);
      if (!d) continue;
      const idx = days.findIndex((day) => isSameDay(day, d));
      if (idx >= 0) map.get(idx)!.push(item);
    }
    return map;
  }, [items, days]);

  return (
    <div className="grid grid-cols-7 flex-1 overflow-hidden divide-x divide-[var(--border-subtle)]">
      {days.map((day, i) => {
        const dayItems = byDay.get(i) ?? [];
        const isToday = isSameDay(day, today);
        return (
          <div key={i} className="flex flex-col overflow-hidden">
            {/* Day header */}
            <div
              className={`px-2 py-2 text-center border-b border-[var(--border-subtle)] ${
                isToday ? "bg-[#8E3DFF]/10" : ""
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {WEEKDAYS[day.getDay()]}
              </div>
              <div
                className={`text-sm font-semibold ${
                  isToday ? "text-[#8E3DFF]" : "text-[var(--text-primary)]"
                }`}
              >
                {day.getDate()}
              </div>
            </div>
            {/* Items */}
            <div className="flex flex-col gap-1 overflow-y-auto p-1.5">
              {dayItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpenItem?.(item)}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-left text-[10px] bg-[var(--bg-raised)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] transition-colors w-full"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(item)}`} />
                  <span className="truncate text-[var(--text-primary)]">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
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
    <div className="flex flex-col flex-1 overflow-hidden px-4 pb-4">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="py-1 text-center text-[10px] uppercase tracking-wider text-[var(--text-muted)]"
          >
            {wd}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1 gap-px bg-[var(--border-subtle)] rounded-lg overflow-hidden">
        {cells.map((day, i) => {
          const key = startOfDay(day).toISOString();
          const dayItems = byDay.get(key) ?? [];
          const isCurrentMonth = day.getMonth() === anchor.getMonth();
          const isToday = isSameDay(day, today);

          return (
            <div
              key={i}
              onClick={() => onDayClick?.(day)}
              className={`flex flex-col p-1.5 cursor-pointer transition-colors overflow-hidden ${
                isCurrentMonth
                  ? "bg-[var(--bg-panel)] hover:bg-[var(--bg-raised)]"
                  : "bg-[var(--bg-base)] hover:bg-[var(--bg-panel)]"
              }`}
            >
              <span
                className={`text-[11px] font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full ${
                  isToday
                    ? "bg-[#8E3DFF] text-white"
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
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] bg-[var(--bg-raised)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] w-full text-left"
                  >
                    <span className={`h-1 w-1 shrink-0 rounded-full ${urgencyColor(item)}`} />
                    <span className="truncate text-[var(--text-primary)]">{item.title}</span>
                  </button>
                ))}
                {dayItems.length > 3 && (
                  <span className="text-[9px] text-[var(--text-muted)] px-1">
                    +{dayItems.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main CalendarView ────────────────────────────────────────────────────────

export function CalendarView({ items, familiars, onOpenItem }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(new Date());

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
    <div className="flex flex-col h-full bg-[var(--bg-base)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border-subtle)] shrink-0">
        {/* Nav arrows */}
        <button
          onClick={() => navigate(-1)}
          className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Icon name="ph:arrow-left-bold" />
        </button>
        <button
          onClick={() => setAnchor(new Date())}
          className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
        >
          Today
        </button>
        <button
          onClick={() => navigate(1)}
          className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Icon name="ph:arrow-right-bold" />
        </button>

        {/* Heading */}
        <h2 className="flex-1 text-sm font-semibold text-[var(--text-primary)]">
          {headingLabel()}
        </h2>

        {/* Item count */}
        <span className="text-[11px] text-[var(--text-muted)]">
          {items.filter((i) => i.status === "pending").length} pending
        </span>

        {/* View mode toggle */}
        <div className="flex items-center rounded-lg border border-[var(--border-subtle)] overflow-hidden">
          {VIEW_MODES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              className={`px-3 py-1 text-[11px] transition-colors ${
                viewMode === id
                  ? "bg-[#8E3DFF] text-white"
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
          <AgendaView items={items} anchor={anchor} onOpenItem={onOpenItem} />
        )}
        {viewMode === "day" && (
          <DayView items={items} anchor={anchor} onOpenItem={onOpenItem} />
        )}
        {viewMode === "week" && (
          <WeekView items={items} anchor={anchor} onOpenItem={onOpenItem} />
        )}
        {viewMode === "month" && (
          <MonthView
            items={items}
            anchor={anchor}
            onOpenItem={onOpenItem}
            onDayClick={(day) => {
              setAnchor(day);
              setViewMode("day");
            }}
          />
        )}
      </div>
    </div>
  );
}
