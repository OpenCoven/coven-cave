"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { CallsView } from "@/components/calls-view";
import { CovenFloor } from "@/components/coven-floor";
import { InspectorPane } from "@/components/inspector-pane";
import { Icon } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar, SessionRow } from "@/lib/types";

type AgentsScope = "created" | "all" | "conversation" | "floor" | "delegations";

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliar: Familiar | null;
  activeFamiliarId: string | null;
  activeSessionId?: string | null;
  daemonRunning: boolean;
  routerRef: RefObject<ChatRouterHandle | null>;
  inboxItems: InboxItem[];
  inspectorOpen: boolean;
  pendingProjectRoot: string | null;
  onSetInspectorOpen: (open: boolean) => void;
  onSetActiveFamiliar: (id: string) => void;
  onClearPendingProjectRoot: () => void;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onOpenInbox: () => void;
  onOpenMode: (mode: string) => void;
};

const STARTERS = [
  {
    title: "Explain repository",
    body: "Ask an agent to map the codebase and identify the important entry points.",
    icon: "ph:git-pull-request" as const,
  },
  {
    title: "Improve my workflow",
    body: "Review recent sessions and suggest a sharper next operating loop.",
    icon: "ph:rocket-launch-bold" as const,
  },
  {
    title: "Create a plan",
    body: "Turn an idea into a scoped implementation plan before editing files.",
    icon: "ph:clipboard-text" as const,
  },
];

function relTime(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isClosed(session: SessionRow): boolean {
  if (session.archived_at) return true;
  if (session.exit_code !== null) return true;
  return ["complete", "completed", "done", "exited", "failed", "cancelled"].includes(session.status);
}

function statusTone(session: SessionRow): string {
  if (session.status === "running") return "border-emerald-500/25 bg-emerald-500/15 text-emerald-300";
  if (session.status === "failed" || (session.exit_code !== null && session.exit_code !== 0)) return "border-rose-500/25 bg-rose-500/15 text-rose-200";
  if (isClosed(session)) return "border-[var(--border-hairline)] bg-[var(--bg-raised)] text-[var(--text-muted)]";
  return "border-sky-500/25 bg-sky-500/15 text-sky-200";
}

export function AgentsView({
  familiars,
  sessions,
  activeFamiliar,
  activeFamiliarId,
  activeSessionId,
  daemonRunning,
  routerRef,
  inboxItems,
  inspectorOpen,
  pendingProjectRoot,
  onSetInspectorOpen,
  onSetActiveFamiliar,
  onClearPendingProjectRoot,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onOpenInbox,
  onOpenMode,
}: Props) {
  const [scope, setScope] = useState<AgentsScope>("created");
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const famById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const openCount = useMemo(() => sessions.filter((s) => !isClosed(s)).length, [sessions]);
  const closedCount = sessions.length - openCount;

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sessions]
      .filter((session) => (showClosed ? isClosed(session) : !isClosed(session)))
      .filter((session) => {
        if (!q) return true;
        const familiar = session.familiarId ? famById.get(session.familiarId) : null;
        return [
          session.title,
          session.status,
          session.harness,
          session.project_root,
          session.origin ?? "",
          familiar?.display_name ?? "",
        ].some((value) => value.toLowerCase().includes(q));
      })
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [famById, query, sessions, showClosed]);

  const startConversation = (familiarId?: string | null) => {
    if (familiarId) onSetActiveFamiliar(familiarId);
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.newChat(), 0);
  };

  const openConversation = (session: SessionRow) => {
    if (session.familiarId) onSetActiveFamiliar(session.familiarId);
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.openSession(session.id), 0);
  };

  useEffect(() => {
    const onNewChat = (event: Event) => {
      const detail = (event as CustomEvent<{ familiarId?: string | null; projectRoot?: string | null }>).detail;
      if (detail?.familiarId) onSetActiveFamiliar(detail.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.newChat(detail?.projectRoot ?? undefined), 0);
    };
    const onOpenSession = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; familiarId?: string | null }>).detail;
      if (!detail?.sessionId) return;
      if (detail.familiarId) onSetActiveFamiliar(detail.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.openSession(detail.sessionId!), 0);
    };
    const onShowList = () => {
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.goToList(), 0);
    };
    window.addEventListener("cave:agents-new-chat", onNewChat);
    window.addEventListener("cave:agents-open-session", onOpenSession);
    window.addEventListener("cave:agents-list", onShowList);
    return () => {
      window.removeEventListener("cave:agents-new-chat", onNewChat);
      window.removeEventListener("cave:agents-open-session", onOpenSession);
      window.removeEventListener("cave:agents-list", onShowList);
    };
  }, [onSetActiveFamiliar, routerRef]);

  const scopeButton = (
    id: AgentsScope,
    label: string,
    icon: Parameters<typeof Icon>[0]["name"],
    count?: number,
  ) => (
    <button
      key={id}
      type="button"
      onClick={() => setScope(id)}
      className={[
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors",
        scope === id
          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
      ].join(" ")}
    >
      <Icon name={icon} width={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="text-[10px] text-[var(--text-muted)]">{count}</span> : null}
    </button>
  );

  return (
    <section className="flex h-full min-w-0 bg-[var(--bg-base)]">
      <aside className="hidden w-[218px] shrink-0 flex-col border-r border-[var(--border-hairline)] bg-[var(--bg-panel)]/70 p-3 md:flex">
        <div className="mb-3 px-1">
          <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">Agents</h1>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Sessions, floor, and delegation traces.</p>
        </div>
        <div className="space-y-1">
          {scopeButton("created", "Created by me", "ph:user", openCount)}
          {scopeButton("all", "All sessions", "ph:squares-four", sessions.length)}
        </div>
        <div className="my-3 h-px bg-[var(--border-hairline)]" />
        <div className="space-y-1">
          {scopeButton("conversation", "Live chat", "ph:chat-circle-dots")}
          {scopeButton("floor", "The Floor", "ph:users-three")}
          {scopeButton("delegations", "Delegations", "ph:graph")}
        </div>
        <div className="mt-auto space-y-1 border-t border-[var(--border-hairline)] pt-3">
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]" onClick={() => onOpenMode("plugins")}>
            <Icon name="ph:plug" width={14} />
            Configure
          </button>
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]" onClick={() => onOpenMode("library")}>
            <Icon name="ph:brain-bold" width={14} />
            Memories
          </button>
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]" onClick={() => onOpenMode("projects")}>
            <Icon name="ph:terminal-window" width={14} />
            Customize environment
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {scope === "floor" ? (
          <CovenFloor />
        ) : scope === "delegations" ? (
          <CallsView
            familiars={familiars}
            sessions={sessions}
            embedded
            initialTab="delegations"
            onOpenSession={(sessionId, familiarId) => {
              if (familiarId) onSetActiveFamiliar(familiarId);
              setScope("conversation");
              window.setTimeout(() => routerRef.current?.openSession(sessionId), 0);
            }}
          />
        ) : scope === "conversation" ? (
          <div className="flex h-full min-w-0">
            <div className="min-w-0 flex-1">
              <ChatRouter
                ref={routerRef}
                familiar={activeFamiliar}
                familiars={familiars}
                sessions={sessions}
                daemonRunning={daemonRunning}
                onSessionStarted={onSessionStarted}
                onSlashFromChat={onSlashFromChat}
                onOpenOnboarding={onOpenOnboarding}
                onFamiliarSelect={(id) => {
                  onSetActiveFamiliar(id);
                  if (pendingProjectRoot) {
                    const projectRoot = pendingProjectRoot;
                    onClearPendingProjectRoot();
                    window.setTimeout(() => routerRef.current?.newChat(projectRoot), 0);
                  } else {
                    window.setTimeout(() => routerRef.current?.goToList(), 0);
                  }
                }}
                pendingProjectRoot={pendingProjectRoot}
              />
            </div>
            {inspectorOpen ? (
              <aside className="relative hidden h-full w-[340px] shrink-0 lg:block">
                <button
                  type="button"
                  onClick={() => onSetInspectorOpen(false)}
                  className="absolute right-2 top-2 z-10 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] p-1.5 text-[var(--text-muted)] shadow-sm transition-colors hover:text-[var(--text-primary)]"
                  title="Close inspector"
                  aria-label="Close inspector"
                >
                  <Icon name="ph:x-bold" width={12} />
                </button>
                <InspectorPane familiar={activeFamiliar} inboxItems={inboxItems} onOpenInbox={onOpenInbox} />
              </aside>
            ) : (
              <button
                type="button"
                onClick={() => onSetInspectorOpen(true)}
                className="hidden h-full w-9 shrink-0 items-start justify-center border-l border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pt-3 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] lg:flex"
                title="Open inspector"
                aria-label="Open inspector"
              >
                <Icon name="ph:brain-bold" width={15} />
              </button>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {!daemonRunning ? (
              <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-2 text-[12px] text-amber-200">
                The daemon is offline. Existing sessions are visible, but new agent tasks may not start until it is running.
              </div>
            ) : null}

            <header className="shrink-0 border-b border-[var(--border-hairline)] px-5 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">Sessions</h2>
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">Start work, inspect live chats, and trace agent delegation from one place.</p>
                </div>
                <button
                  type="button"
                  onClick={() => startConversation(activeFamiliarId)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-white hover:opacity-90"
                >
                  <Icon name="ph:plus-bold" width={12} />
                  New task
                </button>
              </div>

              <button
                type="button"
                onClick={() => startConversation(activeFamiliarId)}
                className="mt-4 flex min-h-[86px] w-full flex-col rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/45 p-3 text-left transition-colors hover:border-[var(--border-strong)]"
              >
                <span className="text-[13px] text-[var(--text-secondary)]">Give an agent a background task to work on.</span>
                <span className="mt-auto flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-2">
                    <Icon name="ph:file" width={13} />
                    <Icon name="ph:wrench-bold" width={13} />
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-md border border-[var(--border-hairline)] px-2 py-1">Auto</span>
                    <Icon name="ph:arrow-up-bold" width={13} />
                  </span>
                </span>
              </button>
            </header>

            <div className="shrink-0 border-b border-[var(--border-hairline)] px-5 py-4">
              <div className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">Get started with agents</div>
              <div className="grid gap-2 md:grid-cols-3">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.title}
                    type="button"
                    onClick={() => startConversation(activeFamiliarId)}
                    className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]"
                  >
                    <Icon name={starter.icon} width={16} className="mb-2 text-[var(--text-muted)]" />
                    <div className="text-[12px] font-medium text-[var(--text-primary)]">{starter.title}</div>
                    <div className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{starter.body}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-5 py-3">
              <div className="relative min-w-[240px] flex-1">
                <Icon name="ph:magnifying-glass" width={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="is:open author:@me"
                  className="h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-8 pr-3 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
                />
              </div>
              <button type="button" className={`h-8 rounded-md px-3 text-[12px] ${!showClosed ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`} onClick={() => setShowClosed(false)}>
                Open {openCount}
              </button>
              <button type="button" className={`h-8 rounded-md px-3 text-[12px] ${showClosed ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`} onClick={() => setShowClosed(true)}>
                Closed {closedCount}
              </button>
              <span className="hidden h-8 items-center rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-muted)] md:inline-flex">Status</span>
              <span className="hidden h-8 items-center rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-muted)] md:inline-flex">Type</span>
              <span className="hidden h-8 items-center rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-muted)] md:inline-flex">Agent</span>
              <span className="hidden h-8 items-center rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-muted)] md:inline-flex">Newest</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {filteredSessions.length === 0 ? (
                <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
                  <Icon name="ph:robot" width={24} className="text-[var(--text-muted)]" />
                  <p className="mt-3 text-[13px] font-medium text-[var(--text-secondary)]">No matching sessions</p>
                  <button type="button" className="mt-3 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]" onClick={() => startConversation(activeFamiliarId)}>
                    Start an agent task
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)]/35">
                  {filteredSessions.map((session) => {
                    const familiar = session.familiarId ? famById.get(session.familiarId) : null;
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => openConversation(session)}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--bg-raised)] ${session.id === activeSessionId ? "bg-[var(--bg-raised)]" : ""}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{session.title || "Untitled session"}</div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                            <span>{familiar?.display_name ?? session.familiarId ?? "Unassigned"}</span>
                            <span>·</span>
                            <span>{session.harness}</span>
                            {session.origin ? <span className="rounded border border-[var(--border-hairline)] px-1.5 py-0.5">{session.origin}</span> : null}
                            {session.project_root ? <span className="max-w-[320px] truncate">{session.project_root}</span> : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] capitalize ${statusTone(session)}`}>{session.status}</span>
                          <span className="w-12 text-right text-[11px] text-[var(--text-muted)]">{relTime(session.updated_at || session.created_at)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
