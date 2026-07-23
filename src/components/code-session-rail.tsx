"use client";

/**
 * CodeSessionRail — left rail of the Code surface (cave-k0ua): every active
 * coding conversation grouped by project, newest first, with per-session git
 * attribution badges (branch, PR, diffstat, worktree). Selection drives the
 * workbench; the rail never mutates sessions itself.
 */

import React from "react";
import { Icon } from "@/lib/icon";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  groupCodeRailSessions,
} from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

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
  sessions: SessionRow[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession?: () => void;
};

export function CodeSessionRail({ sessions, selectedId, onSelect, onNewSession }: CodeSessionRailProps) {
  const groups = groupCodeRailSessions(sessions);
  const newButton = onNewSession ? (
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
    return (
      <div className="flex h-full flex-col py-2">
        {newButton}
        <div className="px-3 py-4 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          No coding sessions yet. Start one here — or from Chat — and it will
          appear with its branch, diff, and PR context.
        </div>
      </div>
    );
  }
  return (
    <nav aria-label="Coding sessions" className="flex h-full min-h-0 flex-col overflow-y-auto py-2">
      {newButton}      {groups.map((group) => (
        <section key={group.root || "(unknown)"} className="mb-2">
          <div
            className="truncate px-3 py-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
            title={group.root || undefined}
          >
            {group.label}
          </div>
          <ul className="flex flex-col">
            {group.sessions.map((row) => {
              const branch = codeSessionBranch(row);
              const diffstat = codeSessionDiffstat(row);
              const selected = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    aria-current={selected ? "true" : undefined}
                    className={`focus-ring-inset flex w-full flex-col gap-0.5 px-3 py-1.5 text-left ${
                      selected ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ActivityDot row={row} />
                      <span className="min-w-0 truncate text-[length:var(--text-xs)] text-[var(--text-primary)]">
                        {row.title || row.id}
                      </span>
                    </span>
                    {(branch || diffstat || row.pullRequest || row.git?.isWorktree) ? (
                      <span className="flex min-w-0 items-center gap-1.5 pl-3">
                        {row.git?.isWorktree ? (
                          <Icon name="ph:git-fork" width={10} height={10} className="shrink-0 text-[var(--text-muted)]" />
                        ) : null}
                        {branch ? (
                          <span className="min-w-0 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]" title={branch}>
                            {branch}
                          </span>
                        ) : null}
                        {diffstat ? (
                          <span className="shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-secondary)]">{diffstat}</span>
                        ) : null}
                        {row.pullRequest ? <PrChip pr={row.pullRequest} /> : null}
                      </span>
                    ) : null}
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
