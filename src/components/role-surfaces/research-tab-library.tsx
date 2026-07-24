"use client";

/**
 * Library tab (cave-dl74, Phase B3) — every mission's artifacts, flattened
 * into one newest-first shelf (design lines 261–307 / 1260–1292).
 *
 * Honesty rules this file enforces:
 * - The live ticker only renders from real mission data: the current phase
 *   comes from researchPhaseStatuses, the pass count from the mission's own
 *   iterations, and the "min left" reading is derived from the wall-clock
 *   bound reading (budget remaining — a stop-gate fact) — never an invented
 *   completion estimate. No startedAt or an over-budget clock → no reading.
 * - Card summaries are real text only: the iteration summary that produced
 *   the artifact when one exists, otherwise the mission intent. Nothing is
 *   paraphrased or invented.
 * - Artifacts are backed by real mission workspace files served via
 *   /api/research/missions/[id]/files/[key].
 */

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { Icon } from "@/lib/icon";
import {
  researchBoundReadings,
  researchPhaseStatuses,
  type ResearchArtifactKind,
  type ResearchArtifactRef,
  type ResearchMission,
  type ResearchMissionMode,
  type ResearchMissionStatus,
} from "@/lib/research-missions";
import { relativeTime } from "@/lib/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import type { ResearchTabProps } from "./researcher-surface";
import { ResearchArtifactActions } from "./research-artifact-actions";

// ── Cards / rows view preference (persisted, SSR-guarded) ────────────────────

type LibraryView = "cards" | "rows";

const VIEW_STORAGE_KEY = "cave:research:lib-view";

/** Stored view preference; stored garbage falls back to cards. */
function readStoredView(): LibraryView {
  if (typeof window === "undefined") return "cards";
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "rows" ? "rows" : "cards";
  } catch {
    return "cards";
  }
}

// ── Filter mapping (design 277–280) ──────────────────────────────────────────

type LibraryFilter = "all" | "findings" | "maps" | "progress";

/** Classified entry buckets; "other" (rejected drafts, leftover working copies
 *  on settled runs) only ever shows under All — it matches no named filter. */
type LibraryEntryType = "findings" | "maps" | "progress" | "other";

/** Findings = knowledge deliverables, counted only once published. */
const FINDINGS_KINDS: ReadonlySet<ResearchArtifactKind> = new Set([
  "brief",
  "report",
  "paper",
  "findings",
  "presentation",
]);

/** Source maps = the evidence-shaped artifacts, whatever their state. */
const SOURCE_MAP_KINDS: ReadonlySet<ResearchArtifactKind> = new Set([
  "source-ledger",
  "research-log",
]);

/** Runs that are over for good — their working drafts are leftovers, not
 *  progress. failed is deliberately NOT here: a failed run is retryable from
 *  the Desk, so its working draft still reads as in-progress (red-tinted). */
const SETTLED_STATUSES: ReadonlySet<ResearchMissionStatus> = new Set([
  "completed",
  "cancelled",
  "archived",
]);

export type LibraryEntry = {
  artifact: ResearchArtifactRef;
  mission: ResearchMission;
  type: LibraryEntryType;
};

function classifyLibraryEntry(
  artifact: ResearchArtifactRef,
  mission: ResearchMission,
): LibraryEntryType {
  if (artifact.state === "working" && !SETTLED_STATUSES.has(mission.status)) return "progress";
  if (SOURCE_MAP_KINDS.has(artifact.kind)) return "maps";
  if (FINDINGS_KINDS.has(artifact.kind) && artifact.state === "published") return "findings";
  return "other";
}

// ── Live ticker (design 264–270) ─────────────────────────────────────────────

const LIVE_STATUSES: ReadonlySet<ResearchMissionStatus> = new Set([
  "running",
  "planning",
  "queued",
]);

const PHASES = [
  ["scope", "Scope"],
  ["gather", "Gather"],
  ["challenge", "Challenge"],
  ["synthesize", "Synthesize"],
  ["control", "Control"],
  ["publish", "Publish"],
] as const;

const PHASE_IDS = PHASES.map(([id]) => id);

/** The phase the engine is on right now: the running phase, else the first
 *  still-pending one (a queued run is honestly "Scope"). */
function currentPhaseLabel(mission: ResearchMission): string | null {
  const statuses = researchPhaseStatuses(mission, PHASE_IDS);
  const running = statuses.indexOf("running");
  const index = running !== -1 ? running : statuses.indexOf("pending");
  return index === -1 ? null : PHASES[index][1];
}

/**
 * Remaining wall-clock budget, derived from the bound reading — the only
 * remaining-time fact the mission actually has. It is a stop-gate bound
 * ("left in budget"), not a completion estimate, and it is omitted whenever
 * the reading cannot support it: no startedAt (clock never started), the
 * reading is already over budget, or the value is not the elapsed/budget form.
 */
function tickerBudgetLeft(mission: ResearchMission): string | null {
  if (!mission.startedAt) return null;
  const time = researchBoundReadings(mission).find((reading) => reading.id === "time");
  if (!time || time.tone === "over") return null;
  const match = /^(\d+)\/(\d+) min$/.exec(time.value);
  if (!match) return null;
  const left = Number(match[2]) - Number(match[1]);
  return left > 0 ? `~${left} min left in budget` : null;
}

// ── Card copy ────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<ResearchArtifactKind, string> = {
  brief: "Brief",
  report: "Report",
  paper: "Paper",
  findings: "Findings",
  presentation: "Presentation",
  "source-ledger": "Source map",
  "research-log": "Research log",
};

const MODE_LABELS: Record<ResearchMissionMode, string> = {
  brief: "brief",
  sweep: "sweep",
  paper: "paper",
  autoresearch: "deep loop",
};

/** How the owning run reads on an in-progress draft's kicker. */
const PROGRESS_PHRASES: Partial<Record<ResearchMissionStatus, string>> = {
  running: "run live",
  planning: "planning",
  queued: "queued",
  checkpoint: "at checkpoint",
  paused: "run paused",
  failed: "run failed",
};

type KickerTone = "accent" | "muted" | "warn" | "err";

function entryKicker(entry: LibraryEntry): { text: string; tone: KickerTone } {
  const { artifact, mission, type } = entry;
  const kind = KIND_LABELS[artifact.kind];
  if (type === "progress") {
    const phrase = PROGRESS_PHRASES[mission.status] ?? mission.status;
    return {
      text: `${kind} · draft v${artifact.iteration} · ${phrase}`,
      tone: mission.status === "failed" ? "err" : "warn",
    };
  }
  if (type === "maps") {
    const suffix = artifact.state === "published" ? "" : ` · ${artifact.state}`;
    return { text: `${kind} · v${artifact.iteration}${suffix}`, tone: "muted" };
  }
  return {
    text: `${kind} · v${artifact.iteration} · ${artifact.state}`,
    tone: artifact.state === "published" ? "accent" : artifact.state === "rejected" ? "err" : "muted",
  };
}

/** Real text only: the summary of the iteration that produced the artifact
 *  when the run recorded one, otherwise the mission's own intent. */
function entrySummary(entry: LibraryEntry): string {
  const iteration = entry.mission.iterations.find(
    (item) => item.number === entry.artifact.iteration,
  );
  return iteration?.summary?.trim() || entry.mission.intent;
}

function entryMeta(entry: LibraryEntry): string {
  const { artifact, mission, type } = entry;
  const mode = MODE_LABELS[mission.mode];
  const sourceCount = mission.sources.length;
  const sources = `${sourceCount} source${sourceCount === 1 ? "" : "s"}`;
  if (type === "progress") {
    return `${mode} · pass ${artifact.iteration} of ${mission.bounds.maxIterations} · ${sources}`;
  }
  const passes = mission.iterations.length;
  return `${sources} · ${passes} pass${passes === 1 ? "" : "es"} · ${mode}`;
}

// ── Component ────────────────────────────────────────────────────────────────

const FILTER_DEFS: ReadonlyArray<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "findings", label: "Findings" },
  { id: "maps", label: "Source maps" },
  { id: "progress", label: "In progress" },
];

export function ResearchTabLibrary({ research, onNavigate }: ResearchTabProps) {
  // Relative stamps and the ticker's budget reading advance between polls.
  useMinuteTick();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [view, setViewState] = useState<LibraryView>(readStoredView);

  const setView = useCallback((next: LibraryView) => {
    setViewState(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Private mode / quota — the toggle still works for the session.
    }
  }, []);

  const missions = research.missions;

  // Newest-first flatten of every mission's artifacts.
  const entries = useMemo<LibraryEntry[]>(() => {
    const flat = missions.flatMap((mission) =>
      mission.artifacts.map((artifact) => ({
        artifact,
        mission,
        type: classifyLibraryEntry(artifact, mission),
      })));
    const stamp = (entry: LibraryEntry) => {
      const parsed = Date.parse(entry.artifact.updatedAt);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return flat.sort((a, b) => stamp(b) - stamp(a));
  }, [missions]);

  // Real counts: artifacts across all runs, runs that produced any.
  const artifactCount = entries.length;
  const runCount = missions.filter((mission) => mission.artifacts.length > 0).length;

  const counts = useMemo(() => {
    const tally: Record<LibraryFilter, number> = { all: entries.length, findings: 0, maps: 0, progress: 0 };
    for (const entry of entries) {
      if (entry.type !== "other") tally[entry.type] += 1;
    }
    return tally;
  }, [entries]);

  const visible = filter === "all" ? entries : entries.filter((entry) => entry.type === filter);

  // Ticker: the most recently touched live mission, if any.
  const tickerMission = useMemo(() => {
    const live = missions.filter((mission) => LIVE_STATUSES.has(mission.status));
    if (live.length === 0) return null;
    return live.reduce((latest, mission) =>
      Date.parse(mission.updatedAt) > Date.parse(latest.updatedAt) ? mission : latest);
  }, [missions]);

  const tickerLine = useMemo(() => {
    if (!tickerMission) return null;
    const phase = currentPhaseLabel(tickerMission);
    const pass = tickerMission.iterations.at(-1)?.number;
    const budgetLeft = tickerBudgetLeft(tickerMission);
    const segments = [
      phase,
      pass !== undefined ? `pass ${pass}/${tickerMission.bounds.maxIterations}` : null,
      budgetLeft,
    ].filter((segment): segment is string => segment !== null);
    return segments.length > 0
      ? `${tickerMission.title} — ${segments.join(", ")}`
      : tickerMission.title;
  }, [tickerMission]);

  return (
    <section className="research-library" aria-label="Research library">
      {tickerMission ? (
        <div className="research-library__ticker" role="status">
          <i className="research-library__ticker-dot" aria-hidden />
          <strong>Running now:</strong>
          <span className="research-library__ticker-line">{tickerLine}</span>
          <button
            type="button"
            className="research-library__ticker-watch focus-ring"
            onClick={() => onNavigate("desk", { missionId: tickerMission.id })}
          >
            Watch →
          </button>
        </div>
      ) : null}

      <div className="research-library__body">
        <header className="research-library__head">
          <h2>Library</h2>
          <span className="research-library__count">
            {artifactCount} artifact{artifactCount === 1 ? "" : "s"} from {runCount} run{runCount === 1 ? "" : "s"}
          </span>
          <span className="research-library__sort">Sorted by newest</span>
        </header>

        {artifactCount === 0 ? (
          <div className="research-library__empty">
            <Icon name="ph:books" width={28} height={28} aria-hidden />
            <p>No artifacts yet — finished runs publish here.</p>
            <Button size="xs" variant="primary" onClick={() => onNavigate("prompt")}>
              Start research
            </Button>
          </div>
        ) : (
          <>
            <div className="research-library__toolbar">
              <div className="research-library__filters" role="group" aria-label="Filter artifacts">
                {FILTER_DEFS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className="research-library__chip focus-ring"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label} <span className="research-library__chip-count">{counts[id]}</span>
                  </button>
                ))}
              </div>
              <div className="research-library__seg" role="group" aria-label="Library layout">
                <button
                  type="button"
                  className="research-library__seg-opt focus-ring"
                  aria-pressed={view === "cards"}
                  onClick={() => setView("cards")}
                >
                  <Icon name="ph:squares-four" width={12} height={12} aria-hidden />
                  Cards
                </button>
                <button
                  type="button"
                  className="research-library__seg-opt focus-ring"
                  aria-pressed={view === "rows"}
                  onClick={() => setView("rows")}
                >
                  <Icon name="ph:rows" width={12} height={12} aria-hidden />
                  Rows
                </button>
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="research-library__filter-empty">
                Nothing under this filter yet — runs publish here as they go.
              </p>
            ) : (
              <ul className="research-library__grid" data-view={view}>
                {visible.map((entry) => {
                  const { artifact, mission, type } = entry;
                  const kicker = entryKicker(entry);
                  const when = relativeTime(artifact.updatedAt) || "just now";
                  const progressPct = type === "progress"
                    ? Math.max(0, Math.min(100, Math.round(
                      (artifact.iteration / Math.max(1, mission.bounds.maxIterations)) * 100,
                    )))
                    : null;
                  return (
                    <li
                      key={`${mission.id}:${artifact.key}`}
                      className="research-library-card"
                      data-type={type}
                      data-mission-status={mission.status}
                    >
                      <div className="research-library-card__head">
                        <span className="research-library-card__kicker" data-tone={kicker.tone}>
                          {kicker.text}
                        </span>
                        <time className="research-library-card__when" dateTime={artifact.updatedAt}>
                          {when}
                        </time>
                      </div>
                      <strong className="research-library-card__title">{artifact.title}</strong>
                      <span className="research-library-card__summary">{entrySummary(entry)}</span>
                      {progressPct !== null ? (
                        <div
                          className="research-library-card__progress"
                          role="img"
                          aria-label={`Pass ${artifact.iteration} of ${mission.bounds.maxIterations}`}
                        >
                          <i style={{ width: `${progressPct}%` }} aria-hidden />
                        </div>
                      ) : null}
                      <span className="research-library-card__meta">
                        {entryMeta(entry)}
                        <span className="research-library-card__meta-when"> · {when}</span>
                      </span>
                      <div className="research-library-card__actions">
                        {artifact.knowledgeId ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            aria-label={`Open ${artifact.title} in the Grimoire`}
                            onClick={() => openGrimoireDoc("knowledge", artifact.knowledgeId!)}
                          >
                            Open
                          </Button>
                        ) : (
                          <ResearchArtifactActions mission={mission} artifact={artifact} />
                        )}
                        <button
                          type="button"
                          className="research-library-card__run focus-ring"
                          onClick={() => onNavigate("desk", { missionId: mission.id })}
                        >
                          View run →
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
