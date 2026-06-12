"use client";

import { Icon } from "@/lib/icon";
import type { WorkflowRunRecord, WorkflowSummary } from "@/lib/workflows";

type WorkflowRunsPanelProps = {
  runs: WorkflowRunRecord[];
  loading: boolean;
  workflow: WorkflowSummary | null;
};

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function stepRollup(run: WorkflowRunRecord): string {
  if (run.steps.length === 0) return run.summary ?? "no step detail";
  const counts = new Map<string, number>();
  for (const step of run.steps) {
    counts.set(step.status, (counts.get(step.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(" · ");
}

/** Run history for the selected workflow: plan snapshots and executions. */
export function WorkflowRunsPanel({ runs, loading, workflow }: WorkflowRunsPanelProps) {
  return (
    <section className="workflow-runs-panel" aria-label="Workflow run history">
      <div className="workflow-runs-heading">
        <Icon name="ph:clock-countdown" width={13} />
        <span>Runs</span>
        <span className="workflow-runs-count">
          {loading ? "loading" : `${runs.length} recorded`}
        </span>
      </div>
      {!workflow ? (
        <p className="workflow-muted">Select a workflow to see its run history.</p>
      ) : runs.length === 0 && !loading ? (
        <p className="workflow-muted">
          No runs yet — dry-run snapshots and daemon executions land here.
        </p>
      ) : (
        <ol className="workflow-runs-list">
          {runs.map((run) => (
            <li key={run.id} className="workflow-run-row">
              <span className={`workflow-run-chip workflow-run-chip-${run.status}`}>{run.status}</span>
              <span className="workflow-run-kind">{run.kind}</span>
              <span className="workflow-run-detail">{stepRollup(run)}</span>
              <span className="workflow-run-time" title={run.startedAt}>
                {relativeTime(run.startedAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
