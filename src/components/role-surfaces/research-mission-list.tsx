"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/lib/icon";
import type { ResearchMission } from "@/lib/research-missions";
import { relativeTime } from "@/lib/relative-time";
import { nextRovingId, resolveRovingId, type RovingKey } from "@/lib/roving-list";

type Props = {
  missions: ResearchMission[];
  selectedId: string | null;
  loading: boolean;
  onSelect(id: string): void;
};

const STATUS_TONE: Partial<Record<ResearchMission["status"], string>> = {
  running: "busy",
  queued: "busy",
  checkpoint: "warn",
  paused: "warn",
  failed: "error",
  completed: "ok",
};

const ROVING_KEYS = new Set<string>(["ArrowDown", "ArrowUp", "Home", "End"]);

export function ResearchMissionList({ missions, selectedId, loading, onSelect }: Props) {
  // Archived missions leave the working ledger and collapse into a disclosure
  // group at the bottom so finished noise never buries active work.
  const { activeMissions, archivedMissions } = useMemo(() => {
    const active: ResearchMission[] = [];
    const archived: ResearchMission[] = [];
    for (const mission of missions) {
      (mission.status === "archived" ? archived : active).push(mission);
    }
    return { activeMissions: active, archivedMissions: archived };
  }, [missions]);
  const [archivedOpen, setArchivedOpen] = useState(false);

  // Selecting an archived mission (e.g. a stable selection that got archived
  // by a poll refresh) must keep its row reachable, so the group opens.
  useEffect(() => {
    if (selectedId && archivedMissions.some((mission) => mission.id === selectedId)) {
      setArchivedOpen(true);
    }
  }, [selectedId, archivedMissions]);

  // Keyboard roving covers exactly the rendered rows: active rows always,
  // archived rows only while the group is expanded.
  const visibleIds = useMemo(() => [
    ...activeMissions.map((mission) => mission.id),
    ...(archivedOpen ? archivedMissions.map((mission) => mission.id) : []),
  ], [activeMissions, archivedMissions, archivedOpen]);
  const [rovingId, setRovingId] = useState<string | null>(() => resolveRovingId(visibleIds, selectedId, selectedId));
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    setRovingId((current) => resolveRovingId(visibleIds, current, selectedId));
  }, [visibleIds, selectedId]);

  const focusMission = (id: string | null) => {
    if (!id) return;
    requestAnimationFrame(() => buttonRefs.current.get(id)?.focus());
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!ROVING_KEYS.has(event.key)) return;
    event.preventDefault();
    const nextId = nextRovingId(visibleIds, rovingId, event.key as RovingKey);
    setRovingId(nextId);
    focusMission(nextId);
  };

  const renderRow = (mission: ResearchMission) => {
    const selected = mission.id === selectedId;
    const iteration = mission.iterations.at(-1);
    return (
      <li key={mission.id}>
        <button
          type="button"
          ref={(node) => {
            if (node) {
              buttonRefs.current.set(mission.id, node);
            } else {
              buttonRefs.current.delete(mission.id);
            }
          }}
          className={`research-mission-row focus-ring${selected ? " is-selected" : ""}`}
          aria-current={selected ? "true" : undefined}
          tabIndex={mission.id === rovingId ? 0 : -1}
          onFocus={() => setRovingId(mission.id)}
          onClick={() => {
            setRovingId(mission.id);
            onSelect(mission.id);
          }}
        >
          <span className="research-mission-row__top">
            <span className={`research-status-dot research-status-dot--${STATUS_TONE[mission.status] ?? "muted"}`} aria-hidden />
            <strong>{mission.title}</strong>
          </span>
          <span className="research-mission-row__meta">
            <span>{mission.mode}</span>
            <span>{mission.status}</span>
            {iteration ? <span>i{iteration.number}/{mission.bounds.maxIterations}</span> : null}
            <time dateTime={mission.updatedAt}>{relativeTime(mission.updatedAt) || "just now"}</time>
          </span>
        </button>
      </li>
    );
  };

  return (
    <nav className="research-mission-nav" aria-label="Research missions">
      <div className="research-mission-nav__head">
        <span>Mission ledger</span>
        <span>{activeMissions.length}</span>
      </div>
      {loading ? (
        <p className="research-mission-nav__empty">Loading missions…</p>
      ) : missions.length === 0 ? (
        <div className="research-mission-nav__empty">
          <Icon name="ph:flask" width={18} height={18} aria-hidden />
          <p>No research missions yet.</p>
          <span>Describe an investigation to start the first one.</span>
        </div>
      ) : (
        <>
          {activeMissions.length === 0 ? (
            <p className="research-mission-nav__empty">No active missions.</p>
          ) : (
            <ul className="research-mission-nav__list" onKeyDown={onListKeyDown}>
              {activeMissions.map(renderRow)}
            </ul>
          )}
          {archivedMissions.length > 0 ? (
            <div className="research-mission-nav__group">
              <button
                type="button"
                className="research-mission-nav__group-toggle focus-ring"
                aria-expanded={archivedOpen}
                onClick={() => setArchivedOpen((open) => !open)}
              >
                <Icon name={archivedOpen ? "ph:caret-down" : "ph:caret-right"} width={12} height={12} aria-hidden />
                <span>Archived</span>
                <span className="research-mission-nav__group-count">{archivedMissions.length}</span>
              </button>
              {archivedOpen ? (
                <ul className="research-mission-nav__list" onKeyDown={onListKeyDown}>
                  {archivedMissions.map(renderRow)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </nav>
  );
}
