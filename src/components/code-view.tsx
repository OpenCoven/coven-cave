"use client";

/**
 * CodeView — the dedicated Code surface (cave-k0ua): a Codex-style
 * multi-session coding tab. Reverses the earlier Code-mode retirement on the
 * owner's request; default-on since phase 2 (cave-m6ys).
 *
 * Phase 3+ (this shape): top-level Sessions/GitHub tabs, the session rail
 * (grouped by project, git-attribution badges, + New session) and the
 * per-session workbench (Diff | Files | Terminal | PR) with the follow-up
 * composer (code-composer.tsx). New sessions start via code-new-session.tsx —
 * project + familiar + optional fresh worktree. The inspector and mobile
 * layout land in follow-up PRs. GitHub mounts whole under the GitHub tab
 * (the standalone GitHub surface and its sidebar row were absorbed; the
 * "github" workspace mode is now a tab alias landing here).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import {
  codeSessionWorkRoot,
  groupCodeRailSessions,
  parseCodeDeepLink,
  type CodeTopTab,
} from "@/lib/code-surface";
import { CodeSessionRail } from "@/components/code-session-rail";
import { CodeWorkbench } from "@/components/code-workbench";
import { CodeNewSession } from "@/components/code-new-session";
import type { GitHubItemTarget } from "@/lib/github-item-url";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
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
  /** Landing tab override — the "github" mode alias mounts CodeView on its
   *  GitHub tab (deep-link continuity for the absorbed standalone surface). */
  initialTopTab?: CodeTopTab;
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard: (cardId: string) => void;
  githubTarget?: GitHubItemTarget | null;
  /** A file/diff open raised anywhere in the app (cave-ohcj): the workspace
   *  routes cave:open-project-file / cave:open-file-diff /
   *  cave:browse-project-files here instead of Chat's code rail. */
  pendingOpen?: PendingCodeOpen | null;
  onPendingOpenHandled?: () => void;
  onTasksRefresh: () => void;
};

export function CodeView({
  sessions,
  initialTopTab,
  onJumpToSession,
  onFocusCard,
  githubTarget,
  pendingOpen,
  onPendingOpenHandled,
  onTasksRefresh,
}: CodeViewProps) {
  // `?mode=code&session=<id>&ctab=<sessions|github>&wtab=<diff|files|terminal|pr>`
  // deep link — parsed once (initializer stays PURE: React StrictMode runs it
  // twice, so stripping here would feed the second run an already-stripped
  // URL and lose the target), then stripped in a mount effect (the
  // workspace's ?mode= idiom) so reloads stay clean. wtab is forwarded to the
  // workbench for the deep-linked session only.
  const [deepLink] = useState(() => {
    if (typeof window === "undefined") return null;
    return parseCodeDeepLink(new URLSearchParams(window.location.search));
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("session") && !params.has("ctab") && !params.has("wtab")) return;
    params.delete("session");
    params.delete("ctab");
    params.delete("wtab");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
  }, []);
  const [topTab, setTopTab] = useState<CodeTopTab>(
    githubTarget ? "github" : deepLink?.topTab ?? initialTopTab ?? "sessions",
  );
  // Selection is tri-state for the mobile drill-in: `undefined` = nothing
  // chosen yet (auto-pick allowed), `null` = the user explicitly went Back to
  // the session list (auto-pick must NOT re-select), string = a session.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(
    deepLink?.sessionId ?? undefined,
  );
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  // A session created HERE isn't in the polled list yet; hold its selection
  // until /api/sessions/list catches up instead of auto-picking the newest.
  const pendingNewIdRef = useRef<string | null>(null);
  // On a phone the rail IS the landing screen — auto-picking the newest
  // session would skip the list and drop the user straight into a workbench
  // with no context. Captured once at mount (Tailwind md breakpoint).
  const narrowMountRef = useRef(
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );

  const groups = useMemo(() => groupCodeRailSessions(sessions), [sessions]);

  // Consume a routed file/diff open (cave-ohcj): select the raising chat
  // session's workbench — or, for a Projects-hub root browse, the newest
  // session working in that root — and hand the target down for tab focus.
  // Held with the session it resolved to so a later manual session switch
  // doesn't replay a stale file focus into an unrelated workbench.
  const [workbenchTarget, setWorkbenchTarget] = useState<{
    open: PendingCodeOpen;
    sessionId: string | null;
  } | null>(null);
  useEffect(() => {
    if (!pendingOpen) return;
    const byId = pendingOpen.sessionId
      ? groups.flatMap((g) => g.sessions).find((row) => row.id === pendingOpen.sessionId)
      : undefined;
    const root = pendingOpen.kind === "files" ? pendingOpen.root : undefined;
    const trim = (p: string) => p.replace(/\/+$/, "");
    const byRoot =
      !byId && root
        ? groups.flatMap((g) => g.sessions).find((row) => trim(codeSessionWorkRoot(row)) === trim(root))
        : undefined;
    const target = byId ?? byRoot;
    setTopTab("sessions");
    if (target) setSelectedId(target.id);
    // Root browse with no matching session: there is no workbench to focus —
    // land on the surface and leave the rail/selection as-is.
    setWorkbenchTarget(root && !target ? null : { open: pendingOpen, sessionId: target?.id ?? null });
    onPendingOpenHandled?.();
  }, [groups, onPendingOpenHandled, pendingOpen]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    for (const group of groups) {
      const hit = group.sessions.find((row) => row.id === selectedId);
      if (hit) return hit;
    }
    return null;
  }, [groups, selectedId]);

  // Land on the newest session so the surface is immediately useful; keep the
  // user's explicit pick as long as that session is still visible. Skipped
  // after an explicit Back (null) and on narrow mounts (list-first drill-in).
  useEffect(() => {
    if (selected) {
      if (pendingNewIdRef.current === selected.id) pendingNewIdRef.current = null;
      return;
    }
    if (selectedId === null) return;
    if (narrowMountRef.current) return;
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
          {/* Mobile drill-in: below md the rail is the landing screen and the
              workbench replaces it once a session is picked (Back returns). */}
          <div
            className={`${selected ? "hidden md:block" : "block"} w-full shrink-0 border-[var(--border-hairline)] md:w-64 md:border-r`}
          >
            <CodeSessionRail
              sessions={sessions}
              selectedId={selectedId ?? null}
              onSelect={(id) => {
                // A manual switch is a context change — drop any pending file
                // focus so it can't replay into the newly picked workbench.
                setWorkbenchTarget(null);
                setSelectedId(id);
              }}
              onNewSession={() => setNewSessionOpen(true)}
            />
          </div>
          <div className={`${selected ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
            {selected ? (
              <>
                <div className="shrink-0 border-b border-[var(--border-hairline)] px-2 py-1 md:hidden">
                  <button
                    type="button"
                    aria-label="Back to sessions"
                    onClick={() => setSelectedId(null)}
                    className="focus-ring inline-flex items-center gap-1 rounded px-1.5 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name="ph:caret-left" width={12} height={12} />
                    Sessions
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <CodeWorkbench
                    key={selected.id}
                    row={selected}
                    initialTab={deepLink?.sessionId === selected.id ? deepLink?.workbenchTab : undefined}
                    openTarget={
                      workbenchTarget && (workbenchTarget.sessionId ?? selected.id) === selected.id
                        ? workbenchTarget.open
                        : undefined
                    }
                    onJumpToSession={onJumpToSession}
                    onRefresh={onTasksRefresh}
                  />
                </div>
              </>
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
