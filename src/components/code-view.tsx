"use client";

/**
 * Coding familiar Room: a familiar-scoped session rail beside a terminal-first
 * workbench. GitHub, diffs, files, pull requests, inspector, and Browser stay in
 * the workbench's right context dock instead of replacing the Room.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  codeSessionWorkRoot,
  groupCodeRailSessions,
  isCodeGithubTab,
  parseCodeDeepLink,
  type CodeWorkbenchTab,
} from "@/lib/code-surface";
import { CodeSessionRail } from "@/components/code-session-rail";
import { CodeWorkbench } from "@/components/code-workbench";
import { CodeNewSession } from "@/components/code-new-session";
import { CodeRoomGithub, type CodeContextTab } from "@/components/code-context-dock";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { PendingCodeGithubOpen } from "@/lib/pending-code-github";
import type { SessionRow } from "@/lib/types";

export type CodeViewProps = {
  sessions: SessionRow[];
  onJumpToSession: (sessionId: string, familiarId?: string | null) => void;
  onFocusCard: (cardId: string) => void;
  pendingOpen?: PendingCodeOpen | null;
  onPendingOpenHandled?: () => void;
  pendingGithubOpen?: PendingCodeGithubOpen | null;
  onPendingGithubOpenHandled?: () => void;
  onTasksRefresh: () => void;
};

function deepLinkedContextTab(workbenchTab: CodeWorkbenchTab | undefined): CodeContextTab | undefined {
  return workbenchTab === "diff" ? "changes"
    : workbenchTab === "files" ? "files"
      : workbenchTab === "pr" ? "pr"
        : undefined;
}

export function CodeView({
  sessions,
  onJumpToSession,
  onFocusCard,
  pendingOpen,
  onPendingOpenHandled,
  pendingGithubOpen,
  onPendingGithubOpenHandled,
  onTasksRefresh,
}: CodeViewProps) {
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

  const [selectedId, setSelectedId] = useState<string | null | undefined>(
    deepLink?.sessionId ?? undefined,
  );
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const pendingNewIdRef = useRef<string | null>(null);
  const narrowMountRef = useRef(
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const groups = useMemo(() => groupCodeRailSessions(sessions), [sessions]);
  const [githubOpen, setGithubOpen] = useState<PendingCodeGithubOpen | null>(() => {
    const tab = deepLink?.topTab;
    return tab && isCodeGithubTab(tab) ? { tab, nonce: 0 } : null;
  });

  useEffect(() => {
    if (!pendingGithubOpen) return;
    setGithubOpen(pendingGithubOpen);
    const first = groups[0]?.sessions[0];
    if (first) setSelectedId(first.id);
    onPendingGithubOpenHandled?.();
  }, [groups, onPendingGithubOpenHandled, pendingGithubOpen]);

  const [workbenchTarget, setWorkbenchTarget] = useState<{
    open: PendingCodeOpen;
    sessionId: string | null;
  } | null>(null);
  useEffect(() => {
    if (!pendingOpen) return;
    const byId = pendingOpen.sessionId
      ? groups.flatMap((group) => group.sessions).find((row) => row.id === pendingOpen.sessionId)
      : undefined;
    const root = pendingOpen.kind === "files" ? pendingOpen.root : undefined;
    const trim = (path: string) => path.replace(/\/+$/, "");
    const byRoot =
      !byId && root
        ? groups.flatMap((group) => group.sessions).find((row) => trim(codeSessionWorkRoot(row)) === trim(root))
        : undefined;
    const target = byId ?? byRoot;
    if (target) setSelectedId(target.id);
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

  const initialContextTab = deepLinkedContextTab(deepLink?.workbenchTab);
  const showWorkbench = Boolean(selected || githubOpen);

  return (
    <div className="flex h-full min-h-0">
      <div
        className={`${showWorkbench ? "hidden md:block" : "block"} w-full shrink-0 border-[var(--border-hairline)] md:w-64 md:border-r`}
      >
        <CodeSessionRail
          sessions={sessions}
          selectedId={selectedId ?? null}
          onSelect={(id) => {
            setWorkbenchTarget(null);
            setGithubOpen(null);
            setSelectedId(id);
          }}
          onNewSession={() => setNewSessionOpen(true)}
          onOpenGithub={() => setGithubOpen({ tab: "prs", nonce: Date.now() })}
        />
      </div>
      <div className={`${showWorkbench ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {showWorkbench ? (
          <div className="shrink-0 border-b border-[var(--border-hairline)] px-2 py-1 md:hidden">
            <button
              type="button"
              aria-label="Back to sessions"
              onClick={() => {
                setSelectedId(null);
                setGithubOpen(null);
              }}
              className="focus-ring inline-flex items-center gap-1 rounded px-1.5 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:caret-left" width={12} height={12} />
              Sessions
            </button>
          </div>
        ) : null}
        {selected ? (
          <div className="min-h-0 flex-1">
            <CodeWorkbench
              key={selected.id}
              row={selected}
              initialContextTab={deepLink?.sessionId === selected.id ? initialContextTab : undefined}
              openTarget={
                workbenchTarget && (workbenchTarget.sessionId ?? selected.id) === selected.id
                  ? workbenchTarget.open
                  : undefined
              }
              pendingGithubOpen={githubOpen}
              onJumpToSession={onJumpToSession}
              onFocusCard={onFocusCard}
              onRefresh={onTasksRefresh}
            />
          </div>
        ) : githubOpen ? (
          <section aria-label="Coding Room GitHub" className="min-h-0 flex-1">
            <CodeRoomGithub
              pendingGithubOpen={githubOpen}
              onJumpToSession={onJumpToSession}
              onFocusCard={onFocusCard}
              onRefresh={onTasksRefresh}
            />
          </section>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            Select a session to open terminals, changes, files, GitHub, and Browser.
          </div>
        )}
      </div>
      <CodeNewSession
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onCreated={(sessionId) => {
          pendingNewIdRef.current = sessionId;
          setGithubOpen(null);
          setSelectedId(sessionId);
          setNewSessionOpen(false);
        }}
      />
    </div>
  );
}
