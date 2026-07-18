"use client";

/**
 * Navigator Surface — the Chart Room.
 *
 * Course-plotting over the Cave's real board. Left rail: task intake that
 * charts real board cards, the course lanes, and the upcoming legs derived
 * from card dates. Center: the charted cards in the selected lane. Right
 * sidebar: the selected card's facts, steps, and real lane moves
 * (`PATCH /api/board/[id]`). Bottom drawer: the voyage log — recently
 * completed and currently blocked cards.
 *
 * Every card is the Cave's real board state (`/api/board`); moves and new
 * tasks are real writes to it. Panels with nothing to show say so.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { relativeTime } from "@/lib/relative-time";
import {
  COURSE_LANES,
  cardProgress,
  chartRoomStatus,
  groupByLane,
  scopeCards,
  upcomingLegs,
} from "./navigator-charts";
import { RailSection, SurfaceCanvas, SurfaceEmpty, SurfaceRail, SurfaceRoom } from "./surface-room";
import { NAVIGATOR_SURFACE_ID } from "./ids";

export type NavigatorState = {
  lane: CardStatus | "all";
  selectedId: string | null;
  drawerOpen: boolean;
  /** Latest lane counts — read by the registration manifest's status chip. */
  lastCounts: { running: number; blocked: number } | null;
};

export const NAVIGATOR_INITIAL_STATE: NavigatorState = {
  lane: "all",
  selectedId: null,
  drawerOpen: false,
  lastCounts: null,
};

const LANE_LABELS: Record<CardStatus, string> = {
  backlog: "Backlog",
  inbox: "Inbox",
  running: "Underway",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

export function NavigatorSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<NavigatorState>(
    familiarId,
    NAVIGATOR_SURFACE_ID,
    NAVIGATOR_INITIAL_STATE,
  );

  // ── The real board ─────────────────────────────────────────────────────────
  const [cards, setCards] = useState<Card[] | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const loadBoard = useCallback(async () => {
    setBoardError(null);
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = res.ok ? ((await res.json()) as { ok?: boolean; cards?: Card[] }) : null;
      if (!json?.ok || !Array.isArray(json.cards)) throw new Error("bad response");
      const scoped = scopeCards(json.cards, familiarId);
      setCards(scoped);
      const lanes = groupByLane(scoped);
      patch({
        lastCounts: {
          running: lanes.find((l) => l.status === "running")?.cards.length ?? 0,
          blocked: lanes.find((l) => l.status === "blocked")?.cards.length ?? 0,
        },
      });
    } catch {
      setBoardError("Couldn't load the board.");
      setCards((prev) => prev ?? []);
    }
  }, [familiarId, patch]);
  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const lanes = useMemo(() => groupByLane(cards ?? []), [cards]);
  const visible = useMemo(
    () => (state.lane === "all" ? (cards ?? []) : (lanes.find((l) => l.status === state.lane)?.cards ?? [])),
    [cards, lanes, state.lane],
  );
  const selected = useMemo(
    () => (cards ?? []).find((c) => c.id === state.selectedId) ?? null,
    [cards, state.selectedId],
  );
  const today = new Date().toISOString().slice(0, 10);
  const legs = useMemo(() => upcomingLegs(cards ?? [], today), [cards, today]);
  const recentlyDone = useMemo(
    () =>
      (cards ?? [])
        .filter((c) => c.status === "done")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    [cards],
  );
  const blocked = useMemo(() => lanes.find((l) => l.status === "blocked")?.cards ?? [], [lanes]);

  // ── Real writes: chart a task, move a card ─────────────────────────────────
  const [draftTitle, setDraftTitle] = useState("");
  const [charting, setCharting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const chartTask = async () => {
    const title = draftTitle.trim();
    if (!title || charting) return;
    setCharting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, familiarId, status: "backlog" }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setDraftTitle("");
      await loadBoard();
    } catch {
      setActionError("Couldn't chart the task — the board didn't accept it.");
    } finally {
      setCharting(false);
    }
  };

  const [moving, setMoving] = useState(false);
  const moveSelected = async (status: CardStatus) => {
    if (!selected || moving) return;
    setMoving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/board/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await loadBoard();
    } catch {
      setActionError("Move failed — the board didn't accept the change.");
    } finally {
      setMoving(false);
    }
  };

  return (
    <SurfaceRoom
      accentHue={105}
      drawerTitle="Voyage log"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawer={
        <div className="role-surface-drawer-grid">
          <RailSection title="Recently completed" iconName="ph:flag-checkered">
            {recentlyDone.length === 0 ? (
              <SurfaceEmpty title="Nothing completed yet." />
            ) : (
              <ul className="role-surface-list" aria-label="Recently completed cards">
                {recentlyDone.map((card) => (
                  <li key={card.id} className="role-surface-list-row">
                    <span>{card.title}</span>
                    <span className="role-surface-tag">{relativeTime(card.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
          <RailSection title="Blocked" iconName="ph:warning">
            {blocked.length === 0 ? (
              <SurfaceEmpty title="No blocked cards." />
            ) : (
              <ul className="role-surface-list" aria-label="Blocked cards">
                {blocked.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      className="role-surface-row-btn focus-ring-inset"
                      onClick={() => patch({ selectedId: card.id, lane: "blocked" })}
                    >
                      {card.title}
                      <span className="role-surface-tag">{card.priority}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
        </div>
      }
    >
      <SurfaceRail side="left" label="Course">
        <RailSection title="Chart a task" iconName="ph:compass">
          <form
            className="role-surface-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void chartTask();
            }}
          >
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="New task for this familiar…"
              aria-label="New task title"
            />
            <button type="submit" className="role-surface-chip focus-ring" disabled={!draftTitle.trim() || charting}>
              <Icon name="ph:plus" width={11} height={11} aria-hidden /> {charting ? "Charting…" : "Chart"}
            </button>
          </form>
          <p className="role-surface-hint">Charts a real board card in Backlog, assigned to this familiar.</p>
        </RailSection>
        <RailSection title="Course lanes" iconName="ph:kanban">
          <ul className="role-surface-list">
            <li>
              <button
                type="button"
                className={`role-surface-row-btn focus-ring-inset${state.lane === "all" ? " role-surface-row-btn--active" : ""}`}
                onClick={() => patch({ lane: "all" })}
              >
                All
                <span className="role-surface-tag">{(cards ?? []).length}</span>
              </button>
            </li>
            {lanes.map((lane) => (
              <li key={lane.status}>
                <button
                  type="button"
                  className={`role-surface-row-btn focus-ring-inset${state.lane === lane.status ? " role-surface-row-btn--active" : ""}`}
                  onClick={() => patch({ lane: lane.status })}
                >
                  {LANE_LABELS[lane.status]}
                  <span className="role-surface-tag">{lane.cards.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </RailSection>
        <RailSection title="Upcoming legs" iconName="ph:calendar-blank">
          {cards == null ? (
            <SurfaceEmpty title="Loading charts…" />
          ) : legs.length === 0 ? (
            <SurfaceEmpty title="No dated legs." hint="Cards with start or end dates chart the voyage here." />
          ) : (
            <ul className="role-surface-list" aria-label="Upcoming legs">
              {legs.map((leg) => (
                <li key={leg.card.id}>
                  <button
                    type="button"
                    className="role-surface-row-btn focus-ring-inset"
                    onClick={() => patch({ selectedId: leg.card.id })}
                  >
                    {leg.card.title}
                    <span className={leg.overdue ? "role-surface-tag role-surface-metric-warn" : "role-surface-tag"}>
                      {leg.overdue ? "overdue" : leg.sailsOn}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      </SurfaceRail>

      <SurfaceCanvas label="Charted cards">
        <div className="role-surface-canvas-stack">
          {boardError ? (
            <div role="alert" className="role-surface-hint">
              {boardError}{" "}
              <button type="button" className="role-surface-chip focus-ring" onClick={() => void loadBoard()}>
                Try again
              </button>
            </div>
          ) : null}
          {cards == null ? (
            <SurfaceEmpty title="Loading the board…" />
          ) : visible.length === 0 ? (
            <SurfaceEmpty
              iconName="ph:compass"
              title="Nothing in this lane."
              hint="Chart a task from the rail, or pick another lane."
            />
          ) : (
            <ul className="role-surface-grid" aria-label="Cards">
              {visible.slice(0, 60).map((card) => {
                const progress = cardProgress(card);
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      className={`role-surface-card focus-ring${card.id === state.selectedId ? " role-surface-card--active" : ""}`}
                      aria-current={card.id === state.selectedId ? "true" : undefined}
                      onClick={() => patch({ selectedId: card.id })}
                    >
                      <span className="role-surface-card-tags">
                        <span className="role-surface-tag">{LANE_LABELS[card.status]}</span>
                        <span
                          className={
                            card.priority === "urgent" || card.priority === "high"
                              ? "role-surface-tag role-surface-metric-warn"
                              : "role-surface-tag"
                          }
                        >
                          {card.priority}
                        </span>
                        {card.familiarId == null && <span className="role-surface-tag">unassigned</span>}
                      </span>
                      <span className="role-surface-memory-path">{card.title}</span>
                      <span className="role-surface-memory-excerpt">
                        {progress.label} · updated {relativeTime(card.updatedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SurfaceCanvas>

      <SurfaceRail side="right" label="Card details">
        {!selected ? (
          <RailSection title="Details" iconName="ph:note">
            <SurfaceEmpty title="Select a card to plot its course." />
          </RailSection>
        ) : (
          <>
            <RailSection title="Selected card" iconName="ph:note">
              <p className="role-surface-memory-path">{selected.title}</p>
              {selected.notes && <p className="role-surface-memory-excerpt">{selected.notes}</p>}
              <dl className="role-surface-facts">
                <dt>Lane</dt>
                <dd>{LANE_LABELS[selected.status]}</dd>
                <dt>Priority</dt>
                <dd>{selected.priority}</dd>
                <dt>Lifecycle</dt>
                <dd>{selected.lifecycle}</dd>
                <dt>Steps</dt>
                <dd>{cardProgress(selected).label}</dd>
                {(selected.startDate || selected.endDate) && (
                  <>
                    <dt>Scheduled</dt>
                    <dd>
                      {selected.startDate ?? "…"} → {selected.endDate ?? "…"}
                    </dd>
                  </>
                )}
                {selected.labels.length > 0 && (
                  <>
                    <dt>Labels</dt>
                    <dd>{selected.labels.join(", ")}</dd>
                  </>
                )}
              </dl>
              {selected.sessionId && (
                <div className="role-surface-btn-row">
                  <button
                    type="button"
                    className="role-surface-chip focus-ring"
                    onClick={() => context.openSession(selected.sessionId as string, familiarId)}
                  >
                    Open session
                  </button>
                </div>
              )}
            </RailSection>
            {selected.steps.length > 0 && (
              <RailSection title="Steps" iconName="ph:list">
                <ul className="role-surface-list" aria-label="Card steps">
                  {selected.steps.map((step) => (
                    <li key={step.id} className={`role-surface-check${step.done ? " role-surface-check--done" : ""}`}>
                      {step.text}
                    </li>
                  ))}
                </ul>
              </RailSection>
            )}
            <RailSection title="Move to" iconName="ph:kanban">
              {actionError ? (
                <p role="alert" className="role-surface-hint">
                  {actionError}
                </p>
              ) : null}
              <div className="role-surface-btn-row" role="group" aria-label="Move card to lane">
                {COURSE_LANES.filter((lane) => lane !== selected.status).map((lane) => (
                  <button
                    key={lane}
                    type="button"
                    className="role-surface-chip focus-ring"
                    disabled={moving}
                    onClick={() => void moveSelected(lane)}
                  >
                    {LANE_LABELS[lane]}
                  </button>
                ))}
              </div>
              <p className="role-surface-hint">Moves update the real board card for every surface.</p>
            </RailSection>
          </>
        )}
      </SurfaceRail>
    </SurfaceRoom>
  );
}
