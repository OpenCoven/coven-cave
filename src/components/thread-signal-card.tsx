"use client";

import type { MouseEvent } from "react";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { contextPressureLabel, type BlockerImpact, type ThreadSelfReport } from "@/lib/thread-self-report";

type ThreadSignalCardProps = {
  report: ThreadSelfReport;
  onViewFull: () => void;
  onDismiss: () => void;
};

const IMPACT_WEIGHT: Record<BlockerImpact, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocking: 4,
};

export function topPersistentBlocker(report: ThreadSelfReport) {
  return [...report.persistentBlockers].sort((a, b) => IMPACT_WEIGHT[b.impact] - IMPACT_WEIGHT[a.impact])[0] ?? null;
}

export function ThreadSignalCard({ report, onViewFull, onDismiss }: ThreadSignalCardProps) {
  const context = contextPressureLabel(report.contextPressure);
  const blocker = topPersistentBlocker(report);
  const name = report.threadTitle?.trim() || report.familiarId;
  const age = relativeTime(report.reportedAt);

  function stopAndRun(event: MouseEvent<HTMLButtonElement>, action: () => void) {
    event.preventDefault();
    action();
  }

  return (
    <article className="tsc-card" aria-label="Thread Signal">
      <div className="tsc-head">
        <span className="tsc-title">
          <Icon name="ph:brain-bold" aria-hidden />
          Thread Signal
        </span>
        <span className="tsc-meta">{name} - {age}</span>
      </div>
      <div className="tsc-scores">
        <span className="tsc-score-item">
          <b>Confidence</b>
          <strong>{Math.round(report.overallConfidence)}</strong>
        </span>
        <span className="tsc-score-item">
          <b>Tool reliability</b>
          <strong>{Math.round(report.toolReliability.score)}</strong>
        </span>
        <span className={`tsc-score-item tsc-score-item--${context.severity}`}>
          <b>Context</b>
          <strong>{context.label}</strong>
        </span>
      </div>
      {blocker ? (
        <div className="tsc-blockers">
          {report.persistentBlockers.length} {report.persistentBlockers.length === 1 ? "blocker" : "blockers"}:{" "}
          {blocker.title} ({blocker.impact})
        </div>
      ) : null}
      <div className="tsc-actions">
        <button type="button" onClick={(event) => stopAndRun(event, onViewFull)}>
          View full report <Icon name="ph:arrow-square-out-bold" aria-hidden />
        </button>
        <button type="button" onClick={(event) => stopAndRun(event, onDismiss)}>
          Dismiss
        </button>
      </div>
    </article>
  );
}
