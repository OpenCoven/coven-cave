"use client";

/**
 * CodeSessionRail — left rail of the Code surface (cave-k0ua): every active
 * coding conversation from the shared review queue, with per-session branch,
 * diff, PR and recency context. Selection drives the workbench; the rail never
 * mutates sessions itself.
 */

import { Icon } from "@/lib/icon";
import { CodeReviewQueueControls } from "@/components/code-review-queue-controls";
import type { CodeQueueMode, CodeReviewQueue } from "@/lib/code-review-queue";
import { relativeTime } from "@/lib/relative-time";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
} from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

const ACTIVITY_WORD = {
  running: "Running",
  error: "Failed",
  idle: "Idle",
} as const;

const ACTIVITY_A11Y = {
  running: "running",
  error: "failed",
  idle: "idle",
} as const;

function PrChip({ pr }: { pr: NonNullable<SessionRow["pullRequest"]> }) {
  const state = (pr.state ?? "").toLowerCase();
  const tone =
    state === "merged"
      ? "text-[var(--accent-presence)]"
      : state === "closed"
        ? "text-[var(--color-danger)]"
        : "text-[var(--text-secondary)]";
  return (
    <span
      className={`inline-flex h-4 shrink-0 items-center gap-0.5 rounded border border-[var(--border-hairline)] px-1 font-mono text-[length:var(--text-2xs)] ${tone}`}
      title={pr.url ? `${pr.url}${state ? ` (${state})` : ""}` : undefined}
    >
      <Icon name="ph:git-pull-request" width={10} height={10} />
      {pr.number != null ? `#${pr.number}` : state || "PR"}
    </span>
  );
}

function ActivityDot({ row }: { row: SessionRow }) {
  const activity = codeSessionActivity(row);
  if (activity === "running") {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-presence)]" aria-label="running" />;
  }
  if (activity === "error") {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-danger)]" aria-label="failed" />;
  }
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--border-hairline)]" aria-hidden />;
}

export type CodeSessionRailProps = {
  queue: CodeReviewQueue;
  mode: CodeQueueMode;
  onModeChange: (mode: CodeQueueMode) => void;
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession?: () => void;
  open?: boolean;
  onExpand?: () => void;
};

export function CodeSessionRail({
  queue,
  mode,
  onModeChange,
  selectedId,
  onSelect,
  onNewSession,
  open = true,
  onExpand,
}: CodeSessionRailProps) {
  const groups = queue.groups;
  const openRailClassName = onExpand ? "py-2" : "overflow-y-auto py-2";
  const scopeControls = open ? (
    <div className="px-2 pb-2">
      <CodeReviewQueueControls
        mode={mode}
        reviewableCount={queue.reviewableCount}
        allLocalCount={queue.allLocalCount}
        outsideCurrentFilter={queue.outsideCurrentFilter}
        onModeChange={onModeChange}
      />
    </div>
  ) : null;

  const newButton = open && onNewSession ? (
    <div className="px-2 pb-1">
      <button
        type="button"
        className="focus-ring flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={onNewSession}
      >
        <Icon name="ph:plus" width={12} height={12} />
        New session
      </button>
    </div>
  ) : null;
  if (groups.length === 0) {
    if (!open) {
      return <nav aria-label="Coding sessions" className="flex h-full min-h-0 flex-col" />;
    }
    return (
      <div className="flex h-full flex-col py-2">
        {scopeControls}
        {newButton}
        <div className="px-3 py-4 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {mode === "reviewable"
            ? "No GitHub repository sessions need review."
            : "No coding sessions yet. Start one here — or from Chat — and it will appear with its branch, diff, and PR context."}
        </div>
      </div>
    );
  }
  // onExpand is only supplied when this rail is hosted inside SurfaceRail
  // (cave-iixug): that wrapper's own .surface-rail__content already scrolls,
  // so owning overflow here too would nest a second scroll container. The
  // non-hosted narrow/list-first path (no onExpand, no SurfaceRail around it)
  // keeps its own scroll.
  return (
    <nav
      aria-label="Coding sessions"
      className={`flex h-full min-h-0 flex-col ${
        open ? openRailClassName : "items-center gap-1"
      }`}

    >
      {scopeControls}
      {newButton}
      {groups.map((group) => (
        <section key={group.key || "(unknown)"} className="mb-2">
          {open ? (
            <div
              className="truncate px-3 py-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
              title={group.key || undefined}
            >
              {group.label}
            </div>
          ) : null}
          <ul className={`flex flex-col ${open ? "" : "items-center gap-1"}`}>
            {group.sessions.map((row) => {
              const branch = codeSessionBranch(row);
              const diffstat = codeSessionDiffstat(row);
              const selected = row.id === selectedId;
              const title = row.title || row.id;
              const activity = codeSessionActivity(row);
              const activityText = ACTIVITY_WORD[activity];
              const activityTone =
                activity === "running"
                  ? "text-[var(--color-success)]"
                  : activity === "error"
                    ? "text-[var(--color-danger)]"
                    : "text-[var(--text-muted)]";
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onExpand?.();
                      onSelect(row.id);
                    }}
                    aria-current={selected ? "true" : undefined}
                    data-code-session-id={row.id}
                    aria-label={open ? undefined : `Open ${title} in ${group.label}, ${ACTIVITY_A11Y[activity]}`}
                    title={open ? undefined : title}
                    className={
                      open
                        ? `focus-ring-inset flex w-full flex-col gap-0.5 px-3 py-1.5 text-left ${
                            selected ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"
                          }`
                        : `focus-ring relative flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${
                            selected ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
                          }`
                    }
                  >
                    {open ? (
                      <>
                        <span className="flex min-w-0 items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-[length:var(--text-xs)] text-[var(--text-primary)]">
                            {title}
                          </span>
                          <span className={`shrink-0 font-mono text-[length:var(--text-2xs)] uppercase tracking-wide ${activityTone}`}>
                            {activityText}
                          </span>
                        </span>
                        {(branch || diffstat || row.pullRequest || row.updated_at) ? (
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                            {branch ? (
                              <span className="min-w-0 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]" title={branch}>
                                {branch}
                              </span>
                            ) : null}
                            {diffstat ? (
                              <span className="shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-secondary)]">{diffstat}</span>
                            ) : null}
                            {row.pullRequest ? <PrChip pr={row.pullRequest} /> : null}
                            <span className="shrink-0 text-[var(--text-secondary)]">{relativeTime(row.updated_at)}</span>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Icon name="ph:terminal-window" width={16} height={16} aria-hidden />
                        <span className="absolute right-1 top-1">
                          <ActivityDot row={row} />
                        </span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
