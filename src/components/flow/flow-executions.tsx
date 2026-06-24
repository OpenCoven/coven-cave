"use client";

import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { catalogNode } from "@/lib/flow/flow-catalog";
import type { FlowRunRecord, FlowRunStatus } from "@/lib/flows";

const STATUS_LABEL: Record<FlowRunStatus, string> = {
  preview: "Preview",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

export type FlowExecutionsProps = {
  runs: FlowRunRecord[];
  loading: boolean;
  onOpenSession: (sessionId: string) => void;
  onClear: () => void;
};

export function FlowExecutions({ runs, loading, onOpenSession, onClear }: FlowExecutionsProps) {
  if (loading && runs.length === 0) {
    return (
      <div className="flow-executions">
        <ul className="flow-exec-list">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flow-exec-row flow-exec-skeleton" aria-hidden />
          ))}
        </ul>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flow-executions flow-executions-empty">
        <EmptyState
          icon="ph:clock-counter-clockwise"
          headline="No executions yet"
          subtitle="Press Execute to run this flow. Each run shows up here with its steps and a link to the live session."
        />
      </div>
    );
  }

  return (
    <div className="flow-executions">
      <div className="flow-exec-head">
        <span className="flow-exec-count">{runs.length} execution{runs.length === 1 ? "" : "s"}</span>
        <button type="button" className="flow-exec-clear" onClick={onClear}>
          <Icon name="ph:trash" width={13} /> Clear
        </button>
      </div>
      <ul className="flow-exec-list">
        {runs.map((run) => {
          const done = run.steps.filter((step) => step.status === "succeeded").length;
          return (
            <li key={run.id} className="flow-exec-row">
              <span className={`flow-exec-status flow-exec-status-${run.status}`}>{STATUS_LABEL[run.status]}</span>
              <span className="flow-exec-main">
                <span className="flow-exec-time">
                  <RelativeTime iso={run.startedAt} fallback="just now" />
                </span>
                <span className="flow-exec-meta">
                  {run.steps.length > 0 && `${done}/${run.steps.length} steps`}
                  {run.summary ? ` · ${run.summary}` : ""}
                </span>
                {run.steps.length > 0 && (
                  <span className="flow-exec-steps" aria-hidden>
                    {run.steps.map((step) => (
                      <span
                        key={step.id}
                        className={`flow-exec-step flow-exec-step-${step.status}`}
                        title={`${catalogNode(step.type)?.label ?? step.type}: ${step.status}`}
                      />
                    ))}
                  </span>
                )}
              </span>
              {run.sessionId && (
                <button
                  type="button"
                  className="flow-exec-open"
                  onClick={() => onOpenSession(run.sessionId as string)}
                >
                  Open session
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
