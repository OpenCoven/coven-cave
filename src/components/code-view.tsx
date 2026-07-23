"use client";

/**
 * CodeView — the dedicated Code surface (cave-k0ua): a Codex-style
 * multi-session coding tab. Reverses the earlier Code-mode retirement on the
 * owner's request; gated by caveCodeSurface() (NEXT_PUBLIC_CAVE_CODE_SURFACE).
 *
 * Phase 3+ (this shape): top-level Sessions/GitHub tabs, the session rail
 * (grouped by project, git-attribution badges, + New session) and the
 * per-session workbench (Diff | Files | Terminal | PR) with the follow-up
 * composer (code-composer.tsx). New sessions start via code-new-session.tsx —
 * project + familiar + optional fresh worktree. The inspector and mobile
 * layout land in follow-up PRs. GitHub mounts whole under the GitHub tab
 * (its sidebar row hides when the flag is on).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import {
  groupCodeRailSessions,
  parseCodeDeepLink,
  type CodeTopTab,
} from "@/lib/code-surface";
import { CodeSessionRail } from "@/components/code-session-rail";
import { CodeWorkbench } from "@/components/code-workbench";
import { CodeNewSession } from "@/components/code-new-session";
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

export function CodeView({
  sessions,
  onJumpToSession,
  onFocusCard,
  githubTarget,
  onTasksRefresh,
}: CodeViewProps) {
  // `?mode=code&session=<id>&ctab=<sessions|github>&wtab=<diff|files|terminal|pr>`
  // deep link — read once on mount, then strip (the workspace's ?mode= idiom)
  // so reloads stay clean. wtab is forwarded to the workbench for the
  // deep-linked session only.
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
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  // A session created HERE isn't in the polled list yet; hold its selection
  // until /api/sessions/list catches up instead of auto-picking the newest.
  const pendingNewIdRef = useRef<string | null>(null);

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
    if (selected) {
      if (pendingNewIdRef.current === selected.id) pendingNewIdRef.current = null;
      return;
    }
    if (selectedId && pendingNewIdRef.current === selectedId) return;
    const first = groups[0]?.sessions[0];
    if (first) setSelectedId(first.id);
  }, [groups, selected, selectedId]);

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
            <CodeSessionRail
              sessions={sessions}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNewSession={() => setNewSessionOpen(true)}
            />
          </div>
          <div className="min-w-0 flex-1">
            {selected ? (
              <CodeWorkbench
                key={selected.id}
                row={selected}
                initialTab={deepLink?.sessionId === selected.id ? deepLink?.workbenchTab : undefined}
                onJumpToSession={onJumpToSession}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                Select a session to see its branch, diff, and PR context.
              </div>
            )}
          </div>
        </div>
      )}
      <CodeNewSession
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onCreated={(sessionId) => {
          pendingNewIdRef.current = sessionId;
          setSelectedId(sessionId);
          setNewSessionOpen(false);
        }}
      />
    </div>
  );
}
