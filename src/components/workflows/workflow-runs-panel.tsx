"use client";

import { useState } from "react";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Icon, type IconName } from "@/lib/icon";
import { SkeletonRows } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/relative-time";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";
import type { WorkflowPlaybackState } from "@/lib/workflow-playback";
import type {
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowSummary,
} from "@/lib/workflows";

type WorkflowRunsPanelProps = {
  runs: WorkflowRunRecord[];
  loading: boolean;
  workflow: WorkflowSummary | null;
  playback: WorkflowPlaybackState | null;
  onReplayRun: (run: WorkflowRunRecord) => void;
  /** Clear this workflow's recorded run history. */
  onClearRuns: () => void;
};


/** Human duration between started/finished, or null when a run never finished. */
function runDuration(run: WorkflowRunRecord): string | null {
  if (!run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function stepRollup(run: WorkflowRunRecord): string {
  if (run.steps.length === 0) return run.summary ?? "no step detail";
  const counts = new Map<string, number>();
  for (const step of run.steps) {
    counts.set(step.status, (counts.get(step.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(" · ");
}

const STEP_STATUS_ICON: Record<WorkflowRunStepRecord["status"], IconName> = {
  ready: "ph:circle-dashed",
  succeeded: "ph:check-circle",
  skipped: "ph:minus-circle",
  blocked: "ph:warning-circle",
  failed: "ph:x-circle-fill",
};

/** A run is "clear" unless it's blocked or failed. */
function isProblemRun(run: WorkflowRunRecord): boolean {
  return run.status === "blocked" || run.status === "failed";
}

type WorkflowRunFilter = "all" | "problems" | "executions" | "plans";

const RUN_FILTERS: Array<{ id: WorkflowRunFilter; label: string; match: (run: WorkflowRunRecord) => boolean }> = [
  { id: "all", label: "All", match: () => true },
  { id: "problems", label: "Problems", match: isProblemRun },
  { id: "executions", label: "Runs", match: (run) => run.kind === "execution" },
  { id: "plans", label: "Plans", match: (run) => run.kind === "dry-run" },
];

/** Header rollup: total, problem count, and the most recent run's age. */
function summarizeRuns(runs: WorkflowRunRecord[]): string {
  if (runs.length === 0) return "0 recorded";
  const problems = runs.filter(isProblemRun).length;
  const health = problems === 0 ? "all clear" : `${problems} blocked/failed`;
  return `${runs.length} · ${health} · last ${relativeTime(runs[0].startedAt)}`;
}

/** Run history for the selected workflow: plan snapshots and executions. */
export function WorkflowRunsPanel({ runs, loading, workflow, playback, onReplayRun, onClearRuns }: WorkflowRunsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkflowRunFilter>("all");
  const replaying = playback?.source === "replay" && playback.workflowId === workflow?.id;

  const activeFilter = RUN_FILTERS.find((entry) => entry.id === filter) ?? RUN_FILTERS[0];
  const visibleRuns = filter === "all" ? runs : runs.filter(activeFilter.match);

  const handleClear = () => {
    if (window.confirm("Clear this workflow's run history? Recorded plan snapshots and run records are removed.")) {
      onClearRuns();
    }
  };

  return (
    <section className="workflow-runs-panel" aria-label="Workflow run history">
      <div className="workflow-runs-heading">
        <Icon name="ph:clock-countdown" width={13} />
        <span>Runs</span>
        <span className="workflow-runs-count">
          {loading ? "loading" : summarizeRuns(runs)}
        </span>
        {workflow && runs.length > 0 && (
          <button
            type="button"
            className="workflow-runs-clear"
            onClick={handleClear}
            title="Clear run history for this workflow"
          >
            <Icon name="ph:trash" width={12} />
            Clear
          </button>
        )}
      </div>
      {/* Filter history once there's more than a couple of runs — a busy
          workflow's plan snapshots otherwise bury its real executions. */}
      {workflow && runs.length > 2 && (
        <Tabs
          variant="segment"
          size="sm"
          ariaLabel="Filter runs"
          value={filter}
          onChange={setFilter}
          items={RUN_FILTERS.map((entry) => ({
            id: entry.id,
            label: entry.label,
            count: entry.id === "all" ? runs.length : runs.filter(entry.match).length,
          })) satisfies TabItem<WorkflowRunFilter>[]}
        />
      )}
      {!workflow ? (
        <p className="workflow-muted">Select a workflow to see its run history.</p>
      ) : runs.length === 0 && loading ? (
        <SkeletonRows count={3} className="workflow-runs-loading" />
      ) : runs.length === 0 && !loading ? (
        <p className="workflow-muted">
          No runs yet — dry-run snapshots and daemon executions land here.
        </p>
      ) : visibleRuns.length === 0 ? (
        <p className="workflow-muted">No {activeFilter.label.toLowerCase()} runs in this history.</p>
      ) : (
        <ol className="workflow-runs-list">
          {visibleRuns.map((run) => {
            const expanded = expandedId === run.id;
            const duration = runDuration(run);
            const replayable = run.steps.length > 0;
            return (
              <li key={run.id} className={`workflow-run-item${expanded ? " is-expanded" : ""}`}>
                <button
                  type="button"
                  className="workflow-run-row"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : run.id)}
                >
                  <Icon
                    name={expanded ? "ph:caret-down" : "ph:caret-right"}
                    width={11}
                    className="workflow-run-caret"
                  />
                  <span className={`workflow-run-chip workflow-run-chip-${run.status}`}>{run.status}</span>
                  <span className="workflow-run-kind">{run.kind}</span>
                  <span className="workflow-run-detail">{stepRollup(run)}</span>
                  <span className="workflow-run-time" title={formatTimestamp(run.startedAt, readDateTimePrefs())}>
                    <RelativeTime iso={run.startedAt} />
                  </span>
                </button>
                {expanded && (
                  <div className="workflow-run-expansion">
                    <dl className="workflow-run-meta">
                      <div>
                        <dt>Source</dt>
                        <dd>{run.source}</dd>
                      </div>
                      {run.version && (
                        <div>
                          <dt>Version</dt>
                          <dd>{run.version}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Duration</dt>
                        <dd>{duration ?? (run.kind === "dry-run" ? "instant" : "—")}</dd>
                      </div>
                      <div>
                        <dt>Started</dt>
                        <dd title={formatTimestamp(run.startedAt, readDateTimePrefs())}>{relativeTime(run.startedAt)}</dd>
                      </div>
                    </dl>
                    {run.summary && <p className="workflow-run-summary-line">{run.summary}</p>}
                    {replayable ? (
                      <>
                        <ol className="workflow-run-steps">
                          {run.steps.map((step) => (
                            <li
                              key={step.id}
                              className={`workflow-run-step workflow-run-step-${step.status}`}
                            >
                              <Icon name={STEP_STATUS_ICON[step.status]} width={13} />
                              <span className="workflow-run-step-id">{step.id}</span>
                              <span className="workflow-run-step-kind">{step.kind}</span>
                              <span className="workflow-run-step-status">{step.status}</span>
                            </li>
                          ))}
                        </ol>
                        <div className="workflow-run-actions-row">
                          <button
                            type="button"
                            className="workflow-run-replay"
                            disabled={replaying}
                            onClick={() => onReplayRun(run)}
                            title="Re-animate this run across the canvas"
                          >
                            <Icon name="ph:arrow-counter-clockwise" width={12} />
                            {replaying ? "Replaying" : "Replay on canvas"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="workflow-muted workflow-run-no-steps">
                        No per-step detail recorded — the daemon engine will populate steps once it lands.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
