"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { catalogNode } from "@/lib/flow/flow-catalog";
import { flowRunDurationLabel } from "@/lib/flow/flow-execution-duration";
import {
  filterFlowRuns,
  FLOW_EXECUTION_STARTED_FILTERS,
  FLOW_EXECUTION_STATUS_FILTERS,
  type FlowExecutionStartedFilter,
  type FlowExecutionStatusFilter,
} from "@/lib/flow/flow-execution-filters";
import type { FlowRunRecord, FlowRunStatus } from "@/lib/flows";

const STATUS_LABEL: Record<FlowRunStatus, string> = {
  preview: "Preview",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

const EXECUTION_MODE_LABEL = {
  manual: "Manual",
  production: "Production",
} as const;

export type FlowExecutionsProps = {
  runs: FlowRunRecord[];
  loading: boolean;
  onInspectRun: (run: FlowRunRecord) => void;
  onRetryRun: (run: FlowRunRecord, mode: "current" | "original") => void;
  onLoadRunData: (run: FlowRunRecord) => void;
  onOpenSession: (sessionId: string) => void;
  onClear: () => void;
};

export function FlowExecutions({
  runs,
  loading,
  onInspectRun,
  onRetryRun,
  onLoadRunData,
  onOpenSession,
  onClear,
}: FlowExecutionsProps) {
  const [filter, setFilter] = useState<FlowExecutionStatusFilter>("all");
  const [startedFilter, setStartedFilter] = useState<FlowExecutionStartedFilter>("any");
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [durationNow, setDurationNow] = useState(() => new Date());
  const hasRunningRuns = runs.some((run) => run.status === "running");
  const filteredRuns = useMemo(
    () => filterFlowRuns(runs, { status: filter, started: startedFilter, customKey, customValue }),
    [customKey, customValue, filter, runs, startedFilter],
  );
  const counts = useMemo(() => {
    const next: Record<FlowExecutionStatusFilter, number> = {
      all: runs.length,
      preview: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    };
    for (const run of runs) next[run.status] += 1;
    return next;
  }, [runs]);

  useEffect(() => {
    if (!hasRunningRuns) return;
    setDurationNow(new Date());
    const interval = window.setInterval(() => setDurationNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, [hasRunningRuns]);

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
        <span className="flow-exec-count">
          {filteredRuns.length} of {runs.length} execution{runs.length === 1 ? "" : "s"}
        </span>
        <button type="button" className="flow-exec-clear" onClick={onClear}>
          <Icon name="ph:trash" width={13} /> Clear
        </button>
      </div>
      <div className="flow-exec-filters" aria-label="Execution filters">
        <div className="flow-exec-filter-group">
          <span className="flow-exec-filter-label">Status</span>
          {FLOW_EXECUTION_STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`flow-exec-filter${filter === option.value ? " is-active" : ""}`}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              <span>{counts[option.value]}</span>
            </button>
          ))}
        </div>
        <div className="flow-exec-filter-group">
          <span className="flow-exec-filter-label">Started</span>
          {FLOW_EXECUTION_STARTED_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`flow-exec-filter${startedFilter === option.value ? " is-active" : ""}`}
              aria-pressed={startedFilter === option.value}
              onClick={() => setStartedFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flow-exec-filter-group">
          <span className="flow-exec-filter-label">Saved data</span>
          <input
            className="flow-exec-custom-input"
            value={customKey}
            placeholder="key"
            aria-label="Custom data key"
            onChange={(event) => setCustomKey(event.target.value)}
          />
          <input
            className="flow-exec-custom-input"
            value={customValue}
            placeholder="value"
            aria-label="Custom data value"
            onChange={(event) => setCustomValue(event.target.value)}
          />
        </div>
      </div>
      {filteredRuns.length === 0 ? (
        <div className="flow-exec-filter-empty" role="status">
          No executions match this filter.
        </div>
      ) : (
        <ul className="flow-exec-list">
          {filteredRuns.map((run) => {
            const done = run.steps.filter((step) => step.status === "succeeded").length;
            const retryable = run.status === "failed" || run.status === "preview";
            const hasRunData = !run.redacted && run.steps.some((step) => step.detail?.trim());
            const loadRunDataLabel = run.status === "failed" ? "Debug in editor" : "Copy to editor";
            const mode = run.mode ?? "manual";
            const customEntries = Object.entries(run.customData ?? {});
            const duration = flowRunDurationLabel(run, durationNow);
            return (
              <li key={run.id} className="flow-exec-row">
                <span className={`flow-exec-status flow-exec-status-${run.status}`}>{STATUS_LABEL[run.status]}</span>
                <span className={`flow-exec-mode flow-exec-mode-${mode}`}>{EXECUTION_MODE_LABEL[mode]}</span>
                {run.redacted && <span className="flow-exec-redacted">Redacted</span>}
                <span className="flow-exec-main">
                  <span className="flow-exec-time">
                    <RelativeTime iso={run.startedAt} fallback="just now" />
                  </span>
                  <span className="flow-exec-meta">
                    {run.steps.length > 0 && `${done}/${run.steps.length} steps`}
                    {duration ? ` · Duration ${duration}` : ""}
                    {run.summary ? ` · ${run.summary}` : ""}
                  </span>
                  {customEntries.length > 0 && (
                    <span className="flow-exec-custom-data" aria-label="Saved custom execution data">
                      {customEntries.map(([key, value]) => (
                        <span key={key} className="flow-exec-custom-chip">
                          {key}: {value}
                        </span>
                      ))}
                    </span>
                  )}
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
                <button
                  type="button"
                  className="flow-exec-open"
                  onClick={() => onInspectRun(run)}
                >
                  Inspect
                </button>
                {retryable && (
                  <button
                    type="button"
                    className="flow-exec-open"
                    onClick={() => onRetryRun(run, "current")}
                  >
                    Retry current
                  </button>
                )}
                {retryable && run.flowSnapshot && (
                  <button
                    type="button"
                    className="flow-exec-open"
                    onClick={() => onRetryRun(run, "original")}
                  >
                    Retry original
                  </button>
                )}
                {hasRunData && (
                  <button
                    type="button"
                    className="flow-exec-open"
                    onClick={() => onLoadRunData(run)}
                  >
                    {loadRunDataLabel}
                  </button>
                )}
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
      )}
    </div>
  );
}
