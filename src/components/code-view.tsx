"use client";

/**
 * CodeView — the dedicated Code surface (cave-k0ua): a Codex-style
 * multi-session coding tab. Reverses the earlier Code-mode retirement on the
 * owner's request; gated by caveCodeSurface() (NEXT_PUBLIC_CAVE_CODE_SURFACE).
 *
 * Phase 1 (this shell): top-level Sessions/GitHub tabs, the session rail
 * grouped by project with git-attribution badges, and a per-session overview
 * pane. The workbench tabs (Diff, Files, Terminal, PR), inspector, composer,
 * and new-session flow land in follow-up PRs — see the CODE_WORKBENCH_TABS
 * vocabulary in src/lib/code-surface.ts which already fixes their deep-link
 * names. GitHub mounts whole under the GitHub tab (its sidebar row hides when
 * the flag is on).
 */

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relative-time";
import {
  codeSessionBranch,
  codeSessionDiffstat,
  groupCodeRailSessions,
  parseCodeDeepLink,
  type CodeTopTab,
} from "@/lib/code-surface";
import { CodeSessionRail } from "@/components/code-session-rail";
import type { GitHubItemTarget } from "@/lib/github-item-url";
import type { SessionRow } from "@/lib/types";

// GitHubView keeps its own chunk: CodeView opens far more often than its
// GitHub tab, and github-view is a 3k-line surface (same split posture as
// lazy-surfaces.tsx, done locally to avoid a lazy-surfaces ↔ code-view cycle).
const LazyGitHubView = dynamic(
  () => import("@/components/github-view").then((m) => m.GitHubView),
  { ssr: false },
);

export type CodeViewProps = {
  sessions: SessionRow[];
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard: (cardId: string) => void;
  githubTarget?: GitHubItemTarget | null;
  onTasksRefresh: () => void;
};

function OverviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="min-w-0 truncate font-mono text-[length:var(--text-xs)] text-[var(--text-primary)]">
        {children}
      </span>
    </div>
  );
}

function SessionOverview({
  row,
  onJumpToSession,
}: {
  row: SessionRow;
  onJumpToSession: CodeViewProps["onJumpToSession"];
}) {
  const branch = codeSessionBranch(row);
  const diffstat = codeSessionDiffstat(row);
  const pr = row.pullRequest;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">
            {row.title || row.id}
          </h2>
          <p className="mt-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            Updated {relativeTime(row.updated_at)}
          </p>
        </div>
        <Button size="sm" onClick={() => onJumpToSession(row.id, row.familiarId)}>
          Open in Chat
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-[var(--border-hairline)] p-3">
        <OverviewRow label="Project">{row.project_root || "—"}</OverviewRow>
        <OverviewRow label="Branch">
          {branch ?? "—"}
          {row.git?.isWorktree ? " (worktree)" : ""}
        </OverviewRow>
        {row.git?.worktreeRoot ? <OverviewRow label="Worktree">{row.git.worktreeRoot}</OverviewRow> : null}
        <OverviewRow label="Diff">{diffstat ?? "clean"}</OverviewRow>
        <OverviewRow label="PR">
          {pr?.url ? (
            <a className="focus-ring underline decoration-dotted underline-offset-2" href={pr.url} target="_blank" rel="noreferrer">
              {pr.number != null ? `#${pr.number}` : pr.url}
              {pr.state ? ` (${pr.state})` : ""}
            </a>
          ) : (
            "—"
          )}
        </OverviewRow>
        <OverviewRow label="Harness">
          {row.harness}
          {row.model ? ` · ${row.model}` : ""}
        </OverviewRow>
      </div>
      <p className="mt-3 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        Diff, Files, Terminal, and PR tabs land here next.
      </p>
    </div>
  );
}

export function CodeView({
  sessions,
  onJumpToSession,
  onFocusCard,
  githubTarget,
  onTasksRefresh,
}: CodeViewProps) {
  // `?mode=code&session=<id>&ctab=<sessions|github>` deep link — read once on
  // mount, then strip (the workspace's ?mode= idiom) so reloads stay clean.
  // wtab joins when the workbench tabs land.
  const [deepLink] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const parsed = parseCodeDeepLink(params);
    if (params.has("session") || params.has("ctab") || params.has("wtab")) {
      params.delete("session");
      params.delete("ctab");
      params.delete("wtab");
      const query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
    }
    return parsed;
  });
  const [topTab, setTopTab] = useState<CodeTopTab>(
    githubTarget ? "github" : deepLink?.topTab ?? "sessions",
  );
  const [selectedId, setSelectedId] = useState<string | null>(deepLink?.sessionId ?? null);

  const groups = useMemo(() => groupCodeRailSessions(sessions), [sessions]);
  const selected = useMemo(() => {
    if (!selectedId) return null;
    for (const group of groups) {
      const hit = group.sessions.find((row) => row.id === selectedId);
      if (hit) return hit;
    }
    return null;
  }, [groups, selectedId]);

  // Land on the newest session so the surface is immediately useful; keep the
  // user's explicit pick as long as that session is still visible.
  useEffect(() => {
    if (selected) return;
    const first = groups[0]?.sessions[0];
    if (first) setSelectedId(first.id);
  }, [groups, selected]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Code surface"
        className="flex shrink-0 items-center gap-1 border-b border-[var(--border-hairline)] px-3 py-1.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={topTab === "sessions"}
          onClick={() => setTopTab("sessions")}
          className={`focus-ring inline-flex items-center gap-1.5 rounded px-2 py-1 text-[length:var(--text-xs)] ${
            topTab === "sessions"
              ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Icon name="ph:code" width={14} height={14} />
          Sessions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={topTab === "github"}
          onClick={() => setTopTab("github")}
          className={`focus-ring inline-flex items-center gap-1.5 rounded px-2 py-1 text-[length:var(--text-xs)] ${
            topTab === "github"
              ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Icon name="ph:github-logo" width={14} height={14} />
          GitHub
        </button>
      </div>
      {topTab === "github" ? (
        <div className="min-h-0 flex-1">
          <LazyGitHubView
            onJumpToSession={onJumpToSession}
            onFocusCard={onFocusCard}
            initialTarget={githubTarget}
            onTasksRefresh={onTasksRefresh}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0 border-r border-[var(--border-hairline)]">
            <CodeSessionRail sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <div className="min-w-0 flex-1">
            {selected ? (
              <SessionOverview row={selected} onJumpToSession={onJumpToSession} />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                Select a session to see its branch, diff, and PR context.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
