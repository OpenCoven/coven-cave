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
  groupMode?: "project" | "task" | "familiar";
};

type GanttCategory = "done" | "in-progress" | "pending" | "at-risk";

// A single timeline bar. In project mode it's a task; in task mode it's a step.
type GanttRow = {
  rowId: string;        // unique within the chart
  cardId: string;       // the task this row belongs to (selected on click)
  stepId?: string;      // set in task mode — the step this bar drags/patches
  label: string;
  start: Date;
  end: Date;
  category: GanttCategory;
  /** Per-familiar bar colour, set only when grouping by familiar. */
  color?: string;
};
type Group = { key: string; name: string; rows: GanttRow[]; firstStart: number };

const ZOOM_DAY_W = { day: 22, week: 11, month: 5 } as const; // px per day column at each zoom
type GanttZoom = keyof typeof ZOOM_DAY_W;
const ZOOM_LABELS: Array<[GanttZoom, string]> = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
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

type DragMode = "move" | "resize-start" | "resize-end";

// Clamp a drag delta so a resize can never invert the bar — the moving edge
// stops one day short of the fixed edge (minimum 1-day duration). "move" is
// unbounded (the whole bar slides freely).
function clampDelta(mode: DragMode, delta: number, dur: number): number {
  if (mode === "resize-start") return Math.min(delta, dur - 1); // start can't pass end
  if (mode === "resize-end") return Math.max(delta, -(dur - 1)); // end can't pass start
  return delta;
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
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  // "Today" depends on the clock, so resolve it after mount to avoid an SSR
  // hydration mismatch — the line just isn't drawn on the first client render.
  const [todayMs, setTodayMs] = useState<number | null>(null);
  useEffect(() => setTodayMs(Date.now()), []);
  useDateTimePrefs();
  // Timeline zoom (px/day) + a ref to the scroller so "Today" can recenter.
  const [zoom, setZoom] = useState<GanttZoom>(() => {
    if (typeof window === "undefined") return "day";
    const v = window.localStorage.getItem("cave:board:ganttZoom");
    return v === "day" || v === "week" || v === "month" ? v : "day";
  });
  useEffect(() => { try { window.localStorage.setItem("cave:board:ganttZoom", zoom); } catch { /* ignore */ } }, [zoom]);
  const DAY_W = ZOOM_DAY_W[zoom];
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Drag a bar to reschedule it: grab the middle to MOVE both dates together,
  // or grab a left/right edge handle to RESIZE one end — changing the start or
  // end date independently. While dragging we track the live day delta and
  // reshape the bar visually; the actual patch lands once on pointer-up.
  const draggable = !!onPatch;
  const [drag, setDrag] = useState<{ id: string; mode: DragMode; deltaDays: number } | null>(null);
  const dragRef = useRef<{ id: string; mode: DragMode; startX: number; moved: boolean } | null>(null);
  // Suppresses the row's select-click that would otherwise fire after a drag.
  const suppressClickRef = useRef(false);

  const beginDrag = (e: React.PointerEvent, rowId: string, mode: DragMode) => {
    if (!draggable) return;
    // Don't preventDefault — that would also swallow the click we rely on to
    // select a bar that was tapped (not dragged). stopPropagation keeps an
    // edge-handle press from also starting the bar's move-drag.
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: rowId, mode, startX: e.clientX, moved: false };
    setDrag({ id: rowId, mode, deltaDays: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    setDrag({ id: d.id, mode: d.mode, deltaDays: Math.round(dx / DAY_W) });
  };
  const endDrag = (e: React.PointerEvent, row: GanttRow) => {
    const d = dragRef.current;
    const active = drag;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.moved) suppressClickRef.current = true; // swallow the trailing click
    const dur = daysBetween(row.start, row.end) + 1;
    const delta = clampDelta(d.mode, active?.deltaDays ?? 0, dur);
    if (!(d.moved && delta !== 0 && onPatch)) return;
    const card = cards.find((c) => c.id === row.cardId);
    if (!card) return;
    const newStart = fmtISO(addDays(row.start, delta));
    const newEnd = fmtISO(addDays(row.end, delta));
    const curStart = fmtISO(row.start);
    const curEnd = fmtISO(row.end);
    // Resolve the new {start,end} for the dragged mode.
    const next =
      d.mode === "move" ? { startDate: newStart, endDate: newEnd }
      : d.mode === "resize-start" ? { startDate: newStart, endDate: curEnd }
      : { startDate: curStart, endDate: newEnd };
    if (row.stepId) {
      // Task mode: write this step's dates (promoting a card-range fallback to
      // explicit dates), leaving the other steps untouched.
      const steps = (card.steps ?? []).map((s) =>
        s.id === row.stepId ? { ...s, ...next } : s,
      );
      onPatch(row.cardId, { steps });
    } else {
      // Project mode: a move shifts whichever of the task's own dates are set;
      // a resize sets the dragged end explicitly.
      const patch: Partial<Card> = {};
      if (d.mode === "move") {
        if (parseDate(card.startDate)) patch.startDate = newStart;
        if (parseDate(card.endDate)) patch.endDate = newEnd;
      } else if (d.mode === "resize-start") {
        patch.startDate = newStart;
      } else {
        patch.endDate = newEnd;
      }
      if (patch.startDate || patch.endDate) onPatch(row.cardId, patch);
    }
  };

  const ownerName = (id: string | null): string =>
    (id ? familiars?.find((f) => f.id === id)?.display_name : undefined) ?? "—";
  const projectName = (id: string | null | undefined): string =>
    (id ? projects?.find((p) => p.id === id)?.name : undefined) ?? "No project";
  // A stable per-familiar colour for by-familiar bars: the familiar's own
  // colour when set, otherwise a hue derived from its id so distinct familiars
  // stay visually distinct. Unassigned rows keep their status colour.
  const familiarColor = (id: string | null): string | undefined => {
    if (!id) return undefined;
    const set = familiars?.find((f) => f.id === id)?.color;
    if (set) return set;
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return `hsl(${h} 52% 52%)`;
  };

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
    // One group per project (or familiar); one bar per scheduled task.
    const byFamiliar = groupMode === "familiar";
    const groupMap = new Map<string, Group>();
    for (const card of cards) {
      const cr = cardRange(card);
      if (!cr) continue;
      placedCardIds.add(card.id);
      const key = byFamiliar ? (card.familiarId ?? "__unassigned__") : (card.projectId ?? "__none__");
      let group = groupMap.get(key);
      if (!group) {
        const name = byFamiliar
          ? (card.familiarId ? ownerName(card.familiarId) : "Unassigned")
          : projectName(card.projectId);
        group = { key, name, rows: [], firstStart: cr.start.getTime() };
        groupMap.set(key, group);
      }
      group.rows.push({
        rowId: card.id,
        cardId: card.id,
        label: card.title,
        start: cr.start,
        end: cr.end,
        category: statusCategory(card.status),
        color: byFamiliar ? familiarColor(card.familiarId) : undefined,
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
  const unscheduledCards = cards.filter((c) => !placedCardIds.has(c.id));
  const unscheduledCount = unscheduledCards.length;

  // The tasks the timeline can't place (no dates / no scheduled steps) used to
  // be a dead-end count; make it an expandable tray so they can be scheduled.
  const unscheduledTray =
    unscheduledCount === 0 ? null : (
      <div className="board-gantt-unscheduled">
        <button
          type="button"
          onClick={() => setShowUnscheduled((v) => !v)}
          aria-expanded={showUnscheduled}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "inherit", cursor: "pointer", font: "inherit" }}
        >
          <span aria-hidden>{showUnscheduled ? "▾" : "▸"}</span>
          {unscheduledCount} task{unscheduledCount === 1 ? "" : "s"} {groupMode === "task" ? "without scheduled steps" : "without dates"}
        </button>
        {showUnscheduled ? (
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {unscheduledCards.map((c) => (
              <li key={c.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={() => onSelect(c.id)} title="Open task" style={{ flex: 1, minWidth: 120, textAlign: "left", background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", font: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</button>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ownerName(c.familiarId)}</span>
                {onPatch ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="date" aria-label={`Start date for ${c.title}`} value={c.startDate ?? ""} onChange={(e) => onPatch(c.id, { startDate: e.target.value || null })} style={{ fontSize: 11, padding: "1px 4px", borderRadius: 4, border: "1px solid var(--border-hairline)", background: "var(--bg-base)", color: "var(--text-secondary)" }} />
                    <span aria-hidden style={{ color: "var(--text-muted)" }}>→</span>
                    <input type="date" aria-label={`End date for ${c.title}`} value={c.endDate ?? ""} onChange={(e) => onPatch(c.id, { endDate: e.target.value || null })} style={{ fontSize: 11, padding: "1px 4px", borderRadius: 4, border: "1px solid var(--border-hairline)", background: "var(--bg-base)", color: "var(--text-secondary)" }} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );

  if (allRows.length === 0) {
    return (
      <div className="board-gantt board-gantt--empty">
        <p>{groupMode === "task" ? "No tasks have steps with dates yet." : "No tasks have start and end dates yet."}</p>
        {unscheduledTray}
      </div>
    );
  }

  // Focus: when a group is clicked, render only it (range stays global so bars don't jump).
  const focused = focusedKey && groups.some((g) => g.key === focusedKey) ? focusedKey : null;
  const visibleGroups = focused ? groups.filter((g) => g.key === focused) : groups;

  const min = new Date(Math.min(...allRows.map((r) => r.start.getTime())));
  const max = new Date(Math.max(...allRows.map((r) => r.end.getTime())));
  // Anchor the timeline on the earliest task itself so the first bar sits flush
  // against the left edge. Snapping back to that week's Monday left a near-empty
  // leading column whenever the first task started late in its week.
  const rangeStart = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), min.getUTCDate()));
  const rangeEnd = addDays(startOfWeekMon(max), 7); // complete the final week
  const totalDays = Math.max(7, daysBetween(rangeStart, rangeEnd));
  const timelineW = totalDays * DAY_W;

  const weeks: Array<{ left: number; width: number; label: string }> = [];
  for (let i = 0; i < totalDays; i += 7) {
    // Clamp the trailing column: the range no longer ends on a week boundary.
    weeks.push({ left: i * DAY_W, width: Math.min(7, totalDays - i) * DAY_W, label: `Week ${isoWeek(addDays(rangeStart, i))}` });
  }

  let todayX: number | null = null;
  if (todayMs !== null) {
    const now = new Date(todayMs);
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const offset = daysBetween(rangeStart, todayUtc);
    if (offset >= 0 && offset <= totalDays) todayX = offset * DAY_W + DAY_W / 2;
  }

  // Scroll the timeline so today sits in the middle of the viewport.
  const scrollToToday = () => {
    const el = scrollRef.current;
    if (!el || todayX === null) return;
    el.scrollLeft = Math.max(0, LEFT_W + todayX - el.clientWidth / 2);
  };

  return (
    <div className="board-gantt">
      <div className="cg-controls" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", padding: "2px 8px 6px" }}>
        <div className="board-group-toggle" role="group" aria-label="Timeline zoom">
          {ZOOM_LABELS.map(([z, label]) => (
            <button key={z} type="button" className={`board-group-toggle-btn${zoom === z ? " board-group-toggle-btn--active" : ""}`} onClick={() => setZoom(z)} aria-pressed={zoom === z}>{label}</button>
          ))}
        </div>
        <button type="button" className="board-group-toggle-btn" onClick={scrollToToday} disabled={todayX === null} title="Scroll the timeline to today">Today</button>
      </div>
      <div className="board-gantt__scroll" ref={scrollRef}>
        <div className="cg" style={{ ["--cg-day" as string]: `${DAY_W}px`, ["--cg-tl" as string]: `${timelineW}px` }}>
          {/* Header: left column titles + week band */}
          <div className="cg-head">
            <div className="cg-left cg-left--head">
              <span className="cg-c-task">Group / Task</span>
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
                  // Live drag state for this row, clamped so a resize can't
                  // invert the bar. A diamond has no edges, so it only moves.
                  const active = drag?.id === row.rowId ? drag : null;
                  const mode: DragMode = active?.mode ?? "move";
                  const dragDelta = active ? clampDelta(mode, active.deltaDays, dur) : 0;
                  const dragging = active !== null && dragDelta !== 0;
                  // Reshape the bar per mode: move slides it, resize-start moves
                  // the left edge (offset + delta, shorter), resize-end stretches
                  // the right edge (longer). Dates preview the same way.
                  const previewOffset = mode === "resize-end" ? offset : offset + dragDelta;
                  const previewDur =
                    mode === "resize-start" ? dur - dragDelta : mode === "resize-end" ? dur + dragDelta : dur;
                  const left = previewOffset * DAY_W;
                  const previewStart = addDays(start, mode === "resize-end" ? 0 : dragDelta);
                  const previewEnd = addDays(end, mode === "resize-start" ? 0 : dragDelta);
                  const barClass = (base: string) =>
                    `${base}${draggable ? " cg-bar--grab" : ""}${dragging ? " cg-bar--dragging" : ""}`;
                  const handlers = draggable
                    ? {
                        onPointerDown: (e: React.PointerEvent) => beginDrag(e, row.rowId, "move"),
                        onPointerMove: moveDrag,
                        onPointerUp: (e: React.PointerEvent) => endDrag(e, row),
                      }
                    : {};
                  // Edge handles share the move pointer plumbing but start in a
                  // resize mode; stopPropagation in beginDrag keeps them distinct.
                  const resizeHandle = (which: "start" | "end") => (
                    <span
                      className={`cg-bar__resize cg-bar__resize--${which}`}
                      onPointerDown={(e) => beginDrag(e, row.rowId, which === "start" ? "resize-start" : "resize-end")}
                      onPointerMove={moveDrag}
                      onPointerUp={(e) => endDrag(e, row)}
                      aria-hidden
                    />
                  );
                  return (
                    <button
                      key={row.rowId}
                      type="button"
                      className={`cg-row${selectedCardId === row.cardId ? " cg-row--sel" : ""}`}
                      onClick={() => {
                        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                        onSelect(row.cardId);
                      }}
                      title={`${row.label} · ${formatLabel(previewStart)}–${formatLabel(previewEnd)}${draggable ? " · drag to move, drag edges to resize" : ""}`}
                    >
                      <span className="cg-left">
                        <span className="cg-c-task">{row.label}</span>
                        <span className="cg-c-date">{formatLabel(previewStart)}</span>
                        <span className="cg-c-date">{formatLabel(previewEnd)}</span>
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
                            style={{ left: `${left}px`, width: `${Math.max(DAY_W, previewDur * DAY_W - 3)}px`, touchAction: "none", ...(row.color ? { background: row.color } : {}) }}
                            {...handlers}
                          >
                            {draggable ? resizeHandle("start") : null}
                            <span className="cg-bar__cap" aria-hidden />
                            {draggable ? resizeHandle("end") : null}
                          </span>
                        )}
                        {dragging ? (
                          <span className="cg-drag-label" style={{ left: `${Math.max(0, left)}px` }}>
                            {formatLabel(previewStart)}
                            {milestone ? "" : `–${formatLabel(previewEnd)}`}
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
      {unscheduledTray}
    </div>
  );
}
