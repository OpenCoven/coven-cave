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
  /**
   * "project" (default): one bar per scheduled task, grouped by project.
   * "task": one group per task, one bar per checklist step (using step dates,
   * falling back to the task's own range for undated steps).
   */
  groupMode?: "project" | "task";
};

type GanttCategory = "done" | "in-progress" | "pending" | "at-risk";

// A single timeline bar. In project mode it's a task; in task mode it's a step.
type GanttRow = {
  rowId: string;        // unique within the chart
  cardId: string;       // the task this row belongs to (selected on click)
  stepId?: string;      // set in task mode — the step this bar drags/patches
  label: string;
  owner: string;
  start: Date;
  end: Date;
  category: GanttCategory;
};
type Group = { key: string; name: string; rows: GanttRow[]; firstStart: number };

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

export function BoardGantt({ cards, familiars, projects, selectedCardId, onSelect, onPatch, groupMode = "project" }: Props) {
  // Click a group header to focus it (hide the others); click again to show all.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
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

  const beginDrag = (e: React.PointerEvent, rowId: string) => {
    if (!draggable) return;
    // Don't preventDefault — that would also swallow the click we rely on to
    // select a bar that was tapped (not dragged).
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: rowId, startX: e.clientX, moved: false };
    setDrag({ id: rowId, deltaDays: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    setDrag({ id: d.id, deltaDays: Math.round(dx / DAY_W) });
  };
  const endDrag = (e: React.PointerEvent, row: GanttRow) => {
    const d = dragRef.current;
    const active = drag;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.moved) suppressClickRef.current = true; // swallow the trailing click
    const delta = active?.deltaDays ?? 0;
    if (!(d.moved && delta !== 0 && onPatch)) return;
    const newStart = fmtISO(addDays(row.start, delta));
    const newEnd = fmtISO(addDays(row.end, delta));
    if (row.stepId) {
      // Task mode: shift this step's dates (promoting a card-range fallback to
      // explicit step dates), leaving the other steps untouched.
      const card = cards.find((c) => c.id === row.cardId);
      if (!card) return;
      const steps = (card.steps ?? []).map((s) =>
        s.id === row.stepId ? { ...s, startDate: newStart, endDate: newEnd } : s,
      );
      onPatch(row.cardId, { steps });
    } else {
      // Project mode: shift whichever of the task's own dates are set.
      const card = cards.find((c) => c.id === row.cardId);
      const patch: Partial<Card> = {};
      if (parseDate(card?.startDate)) patch.startDate = newStart;
      if (parseDate(card?.endDate)) patch.endDate = newEnd;
      if (patch.startDate || patch.endDate) onPatch(row.cardId, patch);
    }
  };

  const ownerName = (id: string | null): string =>
    (id ? familiars?.find((f) => f.id === id)?.display_name : undefined) ?? "—";
  const projectName = (id: string | null | undefined): string =>
    (id ? projects?.find((p) => p.id === id)?.name : undefined) ?? "No project";

  // A card's own date range; start/end fall back to each other. null if neither.
  const cardRange = (card: Card): { start: Date; end: Date } | null => {
    const s = parseDate(card.startDate);
    const e = parseDate(card.endDate);
    if (!s && !e) return null;
    const a = s ?? e!;
    const b = e ?? s!;
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  };

  const groups: Group[] = [];
  const placedCardIds = new Set<string>();

  if (groupMode === "task") {
    // One group per task; one bar per step, placed by the step's own dates and
    // falling back to the task's range for undated steps.
    for (const card of cards) {
      const steps = card.steps ?? [];
      if (steps.length === 0) continue;
      const cr = cardRange(card);
      const rows: GanttRow[] = [];
      for (const step of steps) {
        let s = parseDate(step.startDate);
        let e = parseDate(step.endDate);
        if (!s && !e) {
          if (!cr) continue; // no step dates and no task range — can't place it
          s = cr.start;
          e = cr.end;
        }
        const a = s ?? e!;
        const b = e ?? s!;
        rows.push({
          rowId: `${card.id}:${step.id}`,
          cardId: card.id,
          stepId: step.id,
          label: step.text,
          owner: "",
          start: a <= b ? a : b,
          end: a <= b ? b : a,
          category: step.done ? "done" : statusCategory(card.status),
        });
      }
      if (rows.length === 0) continue;
      placedCardIds.add(card.id);
      groups.push({ key: card.id, name: card.title, rows, firstStart: Math.min(...rows.map((r) => r.start.getTime())) });
    }
  } else {
    // One group per project; one bar per scheduled task.
    const groupMap = new Map<string, Group>();
    for (const card of cards) {
      const cr = cardRange(card);
      if (!cr) continue;
      placedCardIds.add(card.id);
      const key = card.projectId ?? "__none__";
      let group = groupMap.get(key);
      if (!group) {
        group = { key, name: projectName(card.projectId), rows: [], firstStart: cr.start.getTime() };
        groupMap.set(key, group);
      }
      group.rows.push({
        rowId: card.id,
        cardId: card.id,
        label: card.title,
        owner: ownerName(card.familiarId),
        start: cr.start,
        end: cr.end,
        category: statusCategory(card.status),
      });
      group.firstStart = Math.min(group.firstStart, cr.start.getTime());
    }
    groups.push(...groupMap.values());
  }

  groups.sort((a, b) => a.firstStart - b.firstStart);
  for (const g of groups) {
    g.rows.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  }

  const allRows = groups.flatMap((g) => g.rows);
  const unscheduledCount = cards.filter((c) => !placedCardIds.has(c.id)).length;

  if (allRows.length === 0) {
    return (
      <div className="board-gantt board-gantt--empty">
        <p>{groupMode === "task" ? "No tasks have steps with dates yet." : "No tasks have start and end dates yet."}</p>
        {unscheduledCount > 0 ? (
          <span>{unscheduledCount} task{unscheduledCount === 1 ? "" : "s"} without dates</span>
        ) : null}
      </div>
    );
  }

  // Focus: when a group is clicked, render only it (range stays global so bars don't jump).
  const focused = focusedKey && groups.some((g) => g.key === focusedKey) ? focusedKey : null;
  const visibleGroups = focused ? groups.filter((g) => g.key === focused) : groups;

  const min = new Date(Math.min(...allRows.map((r) => r.start.getTime())));
  const max = new Date(Math.max(...allRows.map((r) => r.end.getTime())));
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

            {visibleGroups.map((g) => (
              <div key={g.key} className="cg-group">
                <button
                  type="button"
                  className={`cg-grouprow cg-grouprow--btn${focused === g.key ? " cg-grouprow--focused" : ""}`}
                  onClick={() => setFocusedKey((cur) => (cur === g.key ? null : g.key))}
                  aria-pressed={focused === g.key}
                  title={focused === g.key ? "Show all groups" : `Focus ${g.name}`}
                >
                  <span className="cg-left cg-left--group">
                    <span className="cg-caret" aria-hidden>{focused === g.key ? "▸" : "▾"}</span>
                    <span className="cg-groupname">{g.name}</span>
                    <span className="cg-count">{g.rows.length}</span>
                  </span>
                  <span className="cg-grouptl" style={{ width: `${timelineW}px` }} aria-hidden />
                </button>

                {g.rows.map((row) => {
                  const { start, end } = row;
                  const cat = row.category;
                  const offset = Math.max(0, daysBetween(rangeStart, start));
                  const dur = Math.max(1, daysBetween(start, end) + 1);
                  const milestone = dur === 1;
                  const dragDelta = drag?.id === row.rowId ? drag.deltaDays : 0;
                  const dragging = drag?.id === row.rowId && dragDelta !== 0;
                  const left = (offset + dragDelta) * DAY_W;
                  const barClass = (base: string) =>
                    `${base}${draggable ? " cg-bar--grab" : ""}${dragging ? " cg-bar--dragging" : ""}`;
                  const handlers = draggable
                    ? {
                        onPointerDown: (e: React.PointerEvent) => beginDrag(e, row.rowId),
                        onPointerMove: moveDrag,
                        onPointerUp: (e: React.PointerEvent) => endDrag(e, row),
                      }
                    : {};
                  return (
                    <button
                      key={row.rowId}
                      type="button"
                      className={`cg-row${selectedCardId === row.cardId ? " cg-row--sel" : ""}`}
                      onClick={() => {
                        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                        onSelect(row.cardId);
                      }}
                      title={`${row.label} · ${formatLabel(addDays(start, dragDelta))}–${formatLabel(addDays(end, dragDelta))}${draggable ? " · drag to reschedule" : ""}`}
                    >
                      <span className="cg-left">
                        <span className="cg-c-task">{row.label}</span>
                        <span className="cg-c-owner">{row.owner}</span>
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
      {unscheduledCount > 0 ? (
        <div className="board-gantt-unscheduled">
          {unscheduledCount} task{unscheduledCount === 1 ? "" : "s"} {groupMode === "task" ? "without scheduled steps" : "without dates"}
        </div>
      ) : null}
    </div>
  );
}
