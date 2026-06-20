"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/cave-board-types";
import { useDateTimePrefs, readDateTimePrefs } from "@/lib/datetime-format";

type Props = {
  cards: Card[];
  selectedCardId: string | null;
  onSelect: (id: string) => void;
};

type ScheduledCard = {
  card: Card;
  start: Date;
  end: Date;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLabel(date: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  const day = date.getUTCDate();
  // Order by the user's date preference (month-first vs day-first).
  return readDateTimePrefs().date === "ddmm" ? `${day} ${month}` : `${month} ${day}`;
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function BoardGantt({ cards, selectedCardId, onSelect }: Props) {
  // "Today" is derived from the clock, so it can't be computed during SSR
  // without risking a hydration mismatch (and the guide would jump). Resolve it
  // after mount — the line simply isn't drawn for the first client render.
  const [todayMs, setTodayMs] = useState<number | null>(null);
  useEffect(() => setTodayMs(Date.now()), []);
  // Re-render axis + row dates when the date-format preference changes.
  useDateTimePrefs();

  const scheduled: ScheduledCard[] = [];
  const unscheduled: Card[] = [];

  for (const card of cards) {
    const startDate = parseDate(card.startDate);
    const endDate = parseDate(card.endDate);
    if (!startDate && !endDate) {
      unscheduled.push(card);
      continue;
    }
    const start = startDate ?? endDate!;
    const end = endDate ?? startDate!;
    scheduled.push({ card, start: start <= end ? start : end, end: start <= end ? end : start });
  }

  if (scheduled.length === 0) {
    return (
      <div className="board-gantt board-gantt--empty">
        <p>No tasks have start and end dates yet.</p>
        {unscheduled.length > 0 ? (
          <span>{unscheduled.length} task{unscheduled.length === 1 ? "" : "s"} without dates</span>
        ) : null}
      </div>
    );
  }

  const min = new Date(Math.min(...scheduled.map((item) => item.start.getTime())));
  const max = new Date(Math.max(...scheduled.map((item) => item.end.getTime())));
  const span = Math.max(1, daysBetween(min, max) + 1);

  // Today as a percentage across the [min, max] span, matched to the same UTC
  // midnight coordinate the bars use. Null when out of range so we don't draw a
  // guide pinned to the edge for a board whose work is all past or all future.
  let todayPct: number | null = null;
  if (todayMs !== null) {
    const now = new Date(todayMs);
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayOffset = daysBetween(min, todayUtc);
    if (todayOffset >= 0 && todayOffset <= span) todayPct = (todayOffset / span) * 100;
  }
  const todayLeft = todayPct === null ? undefined : `${todayPct}%`;

  return (
    <div className="board-gantt">
      <div className="board-gantt-header">
        <span aria-hidden />
        <span className="board-gantt-axis">
          <span>{formatLabel(min)}</span>
          {todayLeft !== undefined ? (
            <span className="board-gantt-axis__today" style={{ left: todayLeft }}>Today</span>
          ) : null}
          <span>{formatLabel(max)}</span>
        </span>
        <span aria-hidden />
      </div>
      <div className="board-gantt-plot">
        {/* One full-height guide spanning the whole list reads as a continuous
            line, where a per-row marker would break across the row gaps. It
            shares the rows' column grid so it lands in the same track column. */}
        {todayLeft !== undefined ? (
          <div className="board-gantt-today" aria-hidden>
            <span />
            <span className="board-gantt-today__col">
              <span className="board-gantt-today__line" style={{ left: todayLeft }} />
            </span>
            <span />
          </div>
        ) : null}
        <div className="board-gantt-list">
          {scheduled
            .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime())
            .map(({ card, start, end }) => {
              const offset = Math.max(0, daysBetween(min, start));
              const duration = Math.max(1, daysBetween(start, end) + 1);
              const left = `${(offset / span) * 100}%`;
              const width = `${Math.max(5, (duration / span) * 100)}%`;
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`board-gantt-row${selectedCardId === card.id ? " board-gantt-row--selected" : ""}`}
                  onClick={() => onSelect(card.id)}
                >
                  <span className="board-gantt-row__title">{card.title}</span>
                  <span className="board-gantt-row__track" aria-hidden>
                    <span className={`board-gantt-row__bar board-gantt-row__bar--${card.priority}`} style={{ left, width }} />
                  </span>
                  <span className="board-gantt-row__dates">
                    {formatLabel(start)}–{formatLabel(end)} · {duration}d
                  </span>
                </button>
              );
            })}
        </div>
      </div>
      {unscheduled.length > 0 ? (
        <div className="board-gantt-unscheduled">
          {unscheduled.length} task{unscheduled.length === 1 ? "" : "s"} without dates
        </div>
      ) : null}
    </div>
  );
}
