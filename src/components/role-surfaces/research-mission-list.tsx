"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type { ResearchMission } from "@/lib/research-missions";
import { relativeTime } from "@/lib/relative-time";
import { nextRovingId, resolveRovingId, type RovingKey } from "@/lib/roving-list";
import {
  filterResearchMissionsByText,
  groupResearchMissions,
  matchesResearchMissionScope,
  type ResearchMissionGroup,
  type ResearchMissionScope,
} from "./research-desk-view";

type Props = {
  missions: ResearchMission[];
  selectedId: string | null;
  loading: boolean;
  onSelect(id: string): void;
  /** Live query from the desk command bar (plain text or "/find …") — rows
   *  whose title/intent do not match are hidden; empty means no filtering. */
  filter?: string;
  scope: ResearchMissionScope;
  onClearFilters(): void;
  /** Collapse the queue to its spine. Absent means the queue is not
   *  collapsible in this host, so no control renders. */
  onCollapse?(): void;
};

const STATUS_TONE: Partial<Record<ResearchMission["status"], string>> = {
  running: "busy",
  // Planning is an active working state — it presents like running/queued,
  // never like the muted idle dot.
  planning: "busy",
  queued: "busy",
  checkpoint: "warn",
  paused: "warn",
  failed: "error",
  completed: "ok",
};

const ROVING_KEYS = new Set<string>(["ArrowDown", "ArrowUp", "Home", "End"]);

export function ResearchMissionList({
  missions,
  selectedId,
  loading,
  onSelect,
  filter,
  scope,
  onClearFilters,
  onCollapse,
}: Props) {
  const filteredMissions = useMemo(
    () => filterResearchMissionsByText(missions, filter).filter((mission) =>
      matchesResearchMissionScope(mission, scope)),
    [missions, filter, scope],
  );

  const groups = useMemo(
    () => groupResearchMissions(filteredMissions),
    [filteredMissions],
  );
  const nonArchivedGroups = groups.filter((group) => group.id !== "archived");
  const archivedMissions = groups.find(
    (group) => group.id === "archived",
  )?.missions ?? [];
  const nonArchivedCount = nonArchivedGroups.reduce(
    (count, group) => count + group.missions.length,
    0,
  );
  const [archivedOpen, setArchivedOpen] = useState(false);

  // The amber attention line derives from the full mission set — a rail
  // filter must never hide the fact that a run is waiting on a human.
  const checkpointMissions = useMemo(
    () => missions.filter((mission) => mission.status === "checkpoint"),
    [missions],
  );

  // Selecting an archived mission (e.g. a stable selection that got archived
  // by a poll refresh) must keep its row reachable, so the group opens — but
  // only once per selection, so a deliberate re-collapse survives later poll
  // refreshes that recreate the missions array.
  const autoOpenedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || autoOpenedFor.current === selectedId) return;
    if (archivedMissions.some((mission) => mission.id === selectedId)) {
      autoOpenedFor.current = selectedId;
      setArchivedOpen(true);
    }
  }, [selectedId, archivedMissions]);

  // Keyboard roving covers exactly the rendered rows: active rows always,
  // archived rows only while the group is expanded.
  const visibleIds = useMemo(
    () => groups.flatMap((group) =>
      group.id === "archived" && !archivedOpen
        ? []
        : group.missions.map((mission) => mission.id)),
    [groups, archivedOpen],
  );
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

  const renderGroup = (group: ResearchMissionGroup) => (
    <section
      key={group.id}
      className="research-mission-nav__section"
      aria-labelledby={`research-mission-group-${group.id}`}
    >
      <div
        id={`research-mission-group-${group.id}`}
        className="research-mission-nav__section-title"
      >
        <span>{group.label}</span>
        <span>{group.missions.length}</span>
      </div>
      <ul className="research-mission-nav__list" onKeyDown={onListKeyDown}>
        {group.missions.map(renderRow)}
      </ul>
    </section>
  );

  return (
    <nav className="research-mission-nav" aria-label="Research missions">
      <div className="research-mission-nav__head">
        <span>Runs</span>
        <span className="research-mission-nav__count">{nonArchivedCount}</span>
        {onCollapse ? (
          <button
            type="button"
            className="research-mission-nav__collapse focus-ring"
            aria-label="Collapse the run queue"
            title="Collapse the run queue"
            onClick={onCollapse}
          >
            <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
          </button>
        ) : null}
      </div>
      {checkpointMissions.length > 0 ? (
        <p className="research-mission-nav__waiting" role="status">
          {checkpointMissions.length} checkpoint{checkpointMissions.length === 1 ? "" : "s"} waiting
          {checkpointMissions.length === 1 ? (
            <>
              {" · "}
              <time dateTime={checkpointMissions[0].updatedAt}>
                {relativeTime(checkpointMissions[0].updatedAt) || "just now"}
              </time>
            </>
          ) : null}
        </p>
      ) : null}
      {loading ? (
        <p className="research-mission-nav__empty">Loading missions…</p>
      ) : missions.length === 0 ? (
        <div className="research-mission-nav__empty">
          <Icon name="ph:flask" width={18} height={18} aria-hidden />
          <p>No research missions yet.</p>
          <span>Describe an investigation to start the first one.</span>
        </div>
      ) : filteredMissions.length === 0 ? (
        <div className="research-mission-nav__empty">
          <p>No runs match the current filters.</p>
          <Button size="xs" variant="ghost" onClick={onClearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {nonArchivedGroups.length === 0 ? (
            <p className="research-mission-nav__empty">No active missions.</p>
          ) : (
            nonArchivedGroups.map(renderGroup)
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
