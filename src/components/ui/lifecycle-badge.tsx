"use client";

import type { CardLifecycle } from "@/lib/cave-board-types";

const LABEL: Record<CardLifecycle, string> = {
  queued: "queued",
  dispatched: "dispatched",
  running: "running",
  review: "review",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

type Props = {
  lifecycle: CardLifecycle;
  needsHuman?: boolean;
  className?: string;
};

export function LifecycleBadge({ lifecycle, needsHuman, className }: Props) {
  return (
    <span
      className={`ui-lifecycle-badge${className ? ` ${className}` : ""}`}
      data-lifecycle={lifecycle}
      data-needs-human={needsHuman ? "true" : undefined}
      title={needsHuman ? `${LABEL[lifecycle]} · needs human` : LABEL[lifecycle]}
    >
      {LABEL[lifecycle]}
      {needsHuman ? <span className="ui-lifecycle-needs-human">needs human</span> : null}
    </span>
  );
}

/**
 * Formats "running 47m of 2h" for the timeout badge. Returns null when the
 * card isn't running, has no `runningSince`, or has no effective timeout.
 */
export function formatTimeoutBadge(
  runningSince: string | undefined,
  timeoutMs: number | undefined,
  defaultTimeoutMs: number,
): string | null {
  if (!runningSince) return null;
  const timeout = timeoutMs ?? defaultTimeoutMs;
  if (!timeout || timeout <= 0) return null;
  const elapsed = Date.now() - new Date(runningSince).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return `running ${formatDuration(elapsed)} of ${formatDuration(timeout)}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
