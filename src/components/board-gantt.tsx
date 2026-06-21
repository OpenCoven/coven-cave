"use client";

import { useEffect, useRef, useState } from "react";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { Familiar } from "@/lib/types";
import { useDateTimePrefs, readDateTimePrefs } from "@/lib/datetime-format";

type ProjectLike = { id: string; name: string };

type Props = {
  cards: Card[];
  familiars?: Familiar[];
  projects?: ProjectLike[];
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  /** Persist a card change — used to drag a bar to reschedule its dates. */
  onPatch?: (id: string, patch: Partial<Card>) => void;
};

type ScheduledCard = { card: Card; start: Date; end: Date };
type Group = { key: string; name: string; tasks: ScheduledCard[]; firstStart: number };
type GanttCategory = "done" | "in-progress" | "pending" | "at-risk";

const DAY_W = 22; // px per day column — keep in sync with --cg-day in board.css
const LEFT_W = 416; // sum of the left table columns — keep in sync with .cg-left

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLabel(date: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  const day = date.getUTCDate();
  return readDateTimePrefs().date === "ddmm" ? `${day} ${month}` : `${month} ${day}`;
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** YYYY-MM-DD in UTC — the board's date storage format. */
function fmtISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekMon(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

function isoWeek(d: Date): number {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  const ftDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDow + 3);
  return 1 + Math.round((x.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

// Map the board's status vocabulary onto the Gantt's four colour categories.
function statusCategory(status: CardStatus): GanttCategory {
  if (status === "done") return "done";
  if (status === "running") return "in-progress";
  if (status === "blocked") return "at-risk";
  return "pending"; // backlog · inbox · review
}

export function BoardGantt({ cards, familiars, projects, selectedCardId, onSelect, onPatch }: Props) {
  // "Today" depends on the clock, so resolve it after mount to avoid an SSR
  // hydration mismatch — the line just isn't drawn on the first client render.
  const [todayMs, setTodayMs] = useState<number | null>(null);
  useEffect(() => setTodayMs(Date.now()), []);
  useDateTimePrefs();

  // Drag-to-reschedule: while a bar is dragged we track the live day delta and
  // shift the bar visually; the actual patch lands once on pointer-up.
  const draggable = !!onPatch;
  const [drag, setDrag] = useState<{ id: string; deltaDays: number } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; moved: boolean } | null>(null);
  // Suppresses the row's select-click that would otherwise fire after a drag.
  const suppressClickRef = useRef(false);

  const beginDrag = (e: React.PointerEvent, cardId: string) => {
    if (!draggable) return;
    // Don't preventDefault — that would also swallow the click we rely on to
    // select a bar that was tapped (not dragged).
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: cardId, startX: e.clientX, moved: false };
    setDrag({ id: cardId, deltaDays: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    setDrag({ id: d.id, deltaDays: Math.round(dx / DAY_W) });
  };
  const endDrag = (e: React.PointerEvent, card: Card) => {
    const d = dragRef.current;
    const active = drag;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.moved) suppressClickRef.current = true; // swallow the trailing click
    const delta = active?.deltaDays ?? 0;
    if (d.moved && delta !== 0 && onPatch) {
      const patch: Partial<Card> = {};
      const s = parseDate(card.startDate);
      const en = parseDate(card.endDate);
      if (s) patch.startDate = fmtISO(addDays(s, delta));
      if (en) patch.endDate = fmtISO(addDays(en, delta));
      if (patch.startDate || patch.endDate) onPatch(card.id, patch);
    }
  };

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

  const ownerName = (id: string | null): string =>
    (id ? familiars?.find((f) => f.id === id)?.display_name : undefined) ?? "—";
  const projectName = (id: string | null | undefined): string =>
    (id ? projects?.find((p) => p.id === id)?.name : undefined) ?? "No project";

  // Group scheduled tasks by project, each group sorted by start date.
  const groupMap = new Map<string, Group>();
  for (const item of scheduled) {
    const key = item.card.projectId ?? "__none__";
    let group = groupMap.get(key);
    if (!group) {
      group = { key, name: projectName(item.card.projectId), tasks: [], firstStart: item.start.getTime() };
      groupMap.set(key, group);
    }
    group.tasks.push(item);
    group.firstStart = Math.min(group.firstStart, item.start.getTime());
  }
  const groups = [...groupMap.values()].sort((a, b) => a.firstStart - b.firstStart);
  for (const g of groups) {
    g.tasks.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  }

  const min = new Date(Math.min(...scheduled.map((i) => i.start.getTime())));
  const max = new Date(Math.max(...scheduled.map((i) => i.end.getTime())));
  const rangeStart = startOfWeekMon(min);
  const rangeEnd = addDays(startOfWeekMon(max), 7); // complete the final week
  const totalDays = Math.max(7, daysBetween(rangeStart, rangeEnd));
  const timelineW = totalDays * DAY_W;

  const weeks: Array<{ left: number; width: number; label: string }> = [];
  for (let i = 0; i < totalDays; i += 7) {
    weeks.push({ left: i * DAY_W, width: 7 * DAY_W, label: `Week ${isoWeek(addDays(rangeStart, i))}` });
  }

  let todayX: number | null = null;
  if (todayMs !== null) {
    const now = new Date(todayMs);
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const offset = daysBetween(rangeStart, todayUtc);
    if (offset >= 0 && offset <= totalDays) todayX = offset * DAY_W + DAY_W / 2;
  }

  return (
    <div className="board-gantt">
      <div className="board-gantt__scroll">
        <div className="cg" style={{ ["--cg-day" as string]: `${DAY_W}px`, ["--cg-tl" as string]: `${timelineW}px` }}>
          {/* Header: left column titles + week band */}
          <div className="cg-head">
            <div className="cg-left cg-left--head">
              <span className="cg-c-task">Group / Task</span>
              <span className="cg-c-owner">Owner</span>
              <span className="cg-c-date">Start</span>
              <span className="cg-c-date">End</span>
              <span className="cg-c-st">St</span>
            </div>
            <div className="cg-weeks" style={{ width: `${timelineW}px` }}>
              {weeks.map((w) => (
                <span key={w.left} className="cg-week" style={{ left: `${w.left}px`, width: `${w.width}px` }}>
                  {w.label}
                </span>
              ))}
            </div>
          </div>

          {/* Body: today line + grouped rows */}
          <div className="cg-body">
            {todayX !== null ? (
              <span className="cg-today" style={{ left: `calc(${LEFT_W}px + ${todayX}px)` }} aria-hidden>
                <span className="cg-today__flag">TODAY</span>
              </span>
            ) : null}

            {groups.map((g) => (
              <div key={g.key} className="cg-group">
                <div className="cg-grouprow">
                  <div className="cg-left cg-left--group">
                    <span className="cg-caret" aria-hidden>▾</span>
                    <span className="cg-groupname">{g.name}</span>
                    <span className="cg-count">{g.tasks.length}</span>
                  </div>
                  <div className="cg-grouptl" style={{ width: `${timelineW}px` }} aria-hidden />
                </div>

                {g.tasks.map(({ card, start, end }) => {
                  const cat = statusCategory(card.status);
                  const offset = Math.max(0, daysBetween(rangeStart, start));
                  const dur = Math.max(1, daysBetween(start, end) + 1);
                  const milestone = dur === 1;
                  const dragDelta = drag?.id === card.id ? drag.deltaDays : 0;
                  const dragging = drag?.id === card.id && dragDelta !== 0;
                  const left = (offset + dragDelta) * DAY_W;
                  const barClass = (base: string) =>
                    `${base}${draggable ? " cg-bar--grab" : ""}${dragging ? " cg-bar--dragging" : ""}`;
                  const handlers = draggable
                    ? {
                        onPointerDown: (e: React.PointerEvent) => beginDrag(e, card.id),
                        onPointerMove: moveDrag,
                        onPointerUp: (e: React.PointerEvent) => endDrag(e, card),
                      }
                    : {};
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`cg-row${selectedCardId === card.id ? " cg-row--sel" : ""}`}
                      onClick={() => {
                        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                        onSelect(card.id);
                      }}
                      title={`${card.title} · ${formatLabel(addDays(start, dragDelta))}–${formatLabel(addDays(end, dragDelta))}${draggable ? " · drag to reschedule" : ""}`}
                    >
                      <span className="cg-left">
                        <span className="cg-c-task">{card.title}</span>
                        <span className="cg-c-owner">{ownerName(card.familiarId)}</span>
                        <span className="cg-c-date">{formatLabel(addDays(start, dragDelta))}</span>
                        <span className="cg-c-date">{formatLabel(addDays(end, dragDelta))}</span>
                        <span className="cg-c-st"><span className={`cg-dot cg-dot--${cat}`} aria-hidden /></span>
                      </span>
                      <span className="cg-track" style={{ width: `${timelineW}px` }}>
                        {milestone ? (
                          <span
                            className={barClass(`board-gantt-row__bar board-gantt-row__bar--${cat} cg-diamond`)}
                            style={{ left: `${left + DAY_W / 2}px`, touchAction: "none" }}
                            {...handlers}
                          />
                        ) : (
                          <span
                            className={barClass(`board-gantt-row__bar board-gantt-row__bar--${cat} cg-bar`)}
                            style={{ left: `${left}px`, width: `${Math.max(DAY_W, dur * DAY_W - 3)}px`, touchAction: "none" }}
                            {...handlers}
                          >
                            <span className="cg-bar__cap" aria-hidden />
                          </span>
                        )}
                        {dragging ? (
                          <span className="cg-drag-label" style={{ left: `${Math.max(0, left)}px` }}>
                            {formatLabel(addDays(start, dragDelta))}
                            {milestone ? "" : `–${formatLabel(addDays(end, dragDelta))}`}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="cg-legend">
            <span className="cg-leg"><span className="cg-sw cg-sw--done" aria-hidden />Done</span>
            <span className="cg-leg"><span className="cg-sw cg-sw--in-progress" aria-hidden />In Progress</span>
            <span className="cg-leg"><span className="cg-sw cg-sw--pending" aria-hidden />Pending</span>
            <span className="cg-leg"><span className="cg-sw cg-sw--at-risk" aria-hidden />At Risk</span>
            <span className="cg-leg"><span className="cg-diamond cg-diamond--leg" aria-hidden />Milestone</span>
            <span className="cg-leg"><span className="cg-today-sw" aria-hidden />Today</span>
          </div>
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
