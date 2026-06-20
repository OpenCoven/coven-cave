"use client";

import type { Card } from "@/lib/cave-board-types";

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
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function BoardGantt({ cards, selectedCardId, onSelect }: Props) {
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

  return (
    <div className="board-gantt">
      <div className="board-gantt-header">
        <span>{formatLabel(min)}</span>
        <span>{formatLabel(max)}</span>
      </div>
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
                  {formatLabel(start)}-{formatLabel(end)}
                </span>
              </button>
            );
          })}
      </div>
      {unscheduled.length > 0 ? (
        <div className="board-gantt-unscheduled">
          {unscheduled.length} task{unscheduled.length === 1 ? "" : "s"} without dates
        </div>
      ) : null}
    </div>
  );
}
