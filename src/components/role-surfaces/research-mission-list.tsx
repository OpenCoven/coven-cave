"use client";

import { Icon } from "@/lib/icon";
import type { ResearchMission } from "@/lib/research-missions";

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

export function ResearchMissionList({ missions, selectedId, loading, onSelect }: Props) {
  return (
    <nav className="research-mission-nav" aria-label="Research missions">
      <div className="research-mission-nav__head">
        <span>Mission ledger</span>
        <span>{missions.length}</span>
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
        <ul className="research-mission-nav__list">
          {missions.map((mission) => {
            const selected = mission.id === selectedId;
            const iteration = mission.iterations.at(-1);
            return (
              <li key={mission.id}>
                <button
                  type="button"
                  className={`research-mission-row${selected ? " is-selected" : ""}`}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(mission.id)}
                >
                  <span className="research-mission-row__top">
                    <span className={`research-status-dot research-status-dot--${STATUS_TONE[mission.status] ?? "muted"}`} aria-hidden />
                    <strong>{mission.title}</strong>
                  </span>
                  <span className="research-mission-row__meta">
                    <span>{mission.mode}</span>
                    <span>{mission.status}</span>
                    {iteration ? <span>i{iteration.number}/{mission.bounds.maxIterations}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
