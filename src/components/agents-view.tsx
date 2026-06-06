"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { CallsView } from "@/components/calls-view";
import { CovenFloor } from "@/components/coven-floor";
import { InspectorPane } from "@/components/inspector-pane";
import { AgentPanel } from "@/components/agent-panel";
import type { Card } from "@/lib/cave-board-types";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";
import {
  buildDelegationGraph,
  inferDelegationTraces,
  type CovenCall,
  type DelegationGraph,
  type DelegationTrace,
} from "@/lib/coven-calls-types";
import type { Familiar, SessionRow } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentsScope = "sessions" | "conversation" | "floor" | "delegations";

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
  rightPanel?: "inspector" | "chat" | null;
  pendingProjectRoot: string | null;
  onSetInspectorOpen: (open: boolean) => void;
  onSetRightPanel?: (panel: "inspector" | "chat" | null) => void;
  onSetActiveFamiliar: (id: string) => void;
  onClearPendingProjectRoot: () => void;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onOpenInbox: () => void;
  onOpenMode: (mode: string) => void;
};

type CallsResponse = { ok: true; calls: CovenCall[] } | { ok: false; error?: string };
type BoardResponse = { ok: true; cards: Card[] } | { ok: false; error?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function isClosed(s: SessionRow): boolean {
  if (s.archived_at) return true;
  if (s.exit_code !== null) return true;
  return ["complete", "completed", "done", "exited", "failed", "cancelled"].includes(s.status);
}

function statusTone(s: SessionRow): string {
  if (s.status === "running") return "border-emerald-500/25 bg-emerald-500/15 text-emerald-300";
  if (s.status === "failed" || (s.exit_code !== null && s.exit_code !== 0))
    return "border-rose-500/25 bg-rose-500/15 text-rose-200";
  if (isClosed(s)) return "border-[var(--border-hairline)] bg-[var(--bg-raised)] text-[var(--text-muted)]";
  return "border-sky-500/25 bg-sky-500/15 text-sky-200";
}

// ── Agents command bar ────────────────────────────────────────────────────────

function softButton(active = false): string {
  return [
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors",
    active
      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
      : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
  ].join(" ");
}

// ── Origin icon map ───────────────────────────────────────────────────────────

const ORIGIN_ICONS: Record<string, string> = {
  chat: "ph:chat-circle",
  board: "ph:kanban",
  cron: "ph:clock",
  heartbeat: "ph:pulse",
  call: "ph:phone",
  mention: "ph:at",
};

// ── Right panel (inspector / chat) ────────────────────────────────────────────

function RightPanel({
  panel,
  activeFamiliar,
  activeFamiliarId,
  familiars,
  sessions,
  daemonRunning,
  inboxItems,
  onSetPanel,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onSetActiveFamiliar,
  onOpenInbox,
}: {
  panel: "inspector" | "chat";
  activeFamiliar: Familiar | null;
  activeFamiliarId: string | null;
  familiars: Familiar[];
  sessions: SessionRow[];
  daemonRunning: boolean;
  inboxItems: InboxItem[];
  onSetPanel: (p: "inspector" | "chat" | null) => void;
  onSessionStarted: () => void;
  onSlashFromChat: (cmd: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onSetActiveFamiliar: (id: string) => void;
  onOpenInbox: () => void;
}) {
  return (
    <aside className="relative hidden h-full w-[320px] shrink-0 border-l border-[var(--border-hairline)] lg:flex lg:flex-col">
      <div className="right-panel-tabs">
        <button
          type="button"
          className={`right-panel-tab${panel === "chat" ? " right-panel-tab--active" : ""}`}
          onClick={() => onSetPanel("chat")}
        >
          <Icon name="ph:chats" width={13} />
          Chat
        </button>
        <button
          type="button"
          className={`right-panel-tab${panel === "inspector" ? " right-panel-tab--active" : ""}`}
          onClick={() => onSetPanel("inspector")}
        >
          <Icon name="ph:brain-bold" width={13} />
          Inspector
        </button>
        <button type="button" className="right-panel-close" onClick={() => onSetPanel(null)}>
          <Icon name="ph:x-bold" width={11} />
        </button>
      </div>
      {panel === "inspector" && (
        <InspectorPane familiar={activeFamiliar} inboxItems={inboxItems} onOpenInbox={onOpenInbox} />
      )}
      {panel === "chat" && (
        <AgentPanel
          ref={null}
          familiar={activeFamiliar}
          familiars={familiars}
          activeId={activeFamiliarId}
          sessions={sessions}
          daemonRunning={daemonRunning}
          onSessionStarted={onSessionStarted}
          onSlashFromChat={onSlashFromChat}
          onOpenOnboarding={onOpenOnboarding}
          onFamiliarSelect={onSetActiveFamiliar}
        />
      )}
    </aside>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

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
  rightPanel: rightPanelProp,
  pendingProjectRoot,
  onSetInspectorOpen,
  onSetRightPanel,
  onSetActiveFamiliar,
  onClearPendingProjectRoot,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onOpenInbox,
  onOpenMode,
}: Props) {
  const [scope, setScope] = useState<AgentsScope>("sessions");
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [startingDaemon, setStartingDaemon] = useState(false);
  const [daemonStartError, setDaemonStartError] = useState<string | null>(null);

  // Right panel — prefer new prop, fall back to legacy bool
  const rightPanel: "inspector" | "chat" | null =
    rightPanelProp !== undefined ? (rightPanelProp ?? null) : inspectorOpen ? "inspector" : null;

  function setRightPanel(next: "inspector" | "chat" | null) {
    if (onSetRightPanel) { onSetRightPanel(next); return; }
    onSetInspectorOpen(next === "inspector");
  }

  // Delegation data
  const [delegationCalls, setDelegationCalls] = useState<CovenCall[]>([]);
  const [delegationCards, setDelegationCards] = useState<Card[]>([]);
  const [delegationError, setDelegationError] = useState<string | null>(null);

  const famById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const openCount = useMemo(() => sessions.filter((s) => !isClosed(s)).length, [sessions]);
  const closedCount = sessions.length - openCount;

  const delegationGraph = useMemo(
    () =>
      buildDelegationGraph({
        explicitCalls: delegationCalls,
        inferredTraces: inferDelegationTraces({ cards: delegationCards, sessions }),
        includeInferred: true,
      }),
    [delegationCalls, delegationCards, sessions],
  );
  const runningTraceCount = delegationGraph.traces.filter((t) => t.status === "running").length;
  const failedTraceCount = delegationGraph.traces.filter((t) => t.status === "failed").length;

  const loadDelegations = useCallback(async () => {
    try {
      const [cr, br] = await Promise.all([
        fetch("/api/coven-calls", { cache: "no-store" }),
        fetch("/api/board", { cache: "no-store" }),
      ]);
      const cj = (await cr.json()) as CallsResponse;
      const bj = (await br.json()) as BoardResponse;
      if (cj.ok) setDelegationCalls(cj.calls);
      if (bj.ok) setDelegationCards(bj.cards);
      setDelegationError(null);
    } catch {
      setDelegationError("trace unavailable");
    }
  }, []);

  useEffect(() => {
    void loadDelegations();
    const t = setInterval(loadDelegations, 10_000);
    return () => clearInterval(t);
  }, [loadDelegations]);

  // Window events
  useEffect(() => {
    const onNewChat = (e: Event) => {
      const d = (e as CustomEvent<{ familiarId?: string | null; projectRoot?: string | null }>).detail;
      if (d?.familiarId) onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.newChat(d?.projectRoot ?? undefined), 0);
    };
    const onOpenSession = (e: Event) => {
      const d = (e as CustomEvent<{ sessionId?: string; familiarId?: string | null }>).detail;
      if (!d?.sessionId) return;
      if (d.familiarId) onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.openSession(d.sessionId!), 0);
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

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sessions]
      .filter((s) => (showClosed ? isClosed(s) : !isClosed(s)))
      .filter((s) => {
        if (!q) return true;
        const f = s.familiarId ? famById.get(s.familiarId) : null;
        return [s.title, s.status, s.harness, s.project_root, s.origin ?? "", f?.display_name ?? ""]
          .some((v) => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [famById, query, sessions, showClosed]);

  function startConversation(familiarId?: string | null) {
    if (familiarId) onSetActiveFamiliar(familiarId);
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.newChat(), 0);
  }

  function openConversation(session: SessionRow) {
    if (session.familiarId) onSetActiveFamiliar(session.familiarId);
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.openSession(session.id), 0);
  }

  async function startDaemon() {
    setStartingDaemon(true);
    setDaemonStartError(null);
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not start");
      }
      onSessionStarted();
    } catch (err) {
      setDaemonStartError(err instanceof Error ? err.message : "daemon did not start");
    } finally {
      setStartingDaemon(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className="flex h-full min-w-0 bg-[var(--bg-base)]">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Tab bar — underline style matching roles/plugins view ─────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-hairline)] px-4">
          {/* Tabs flush left */}
          <div className="flex items-end gap-0">
            {(["sessions", "floor", "delegations"] as const).map((s) => {
              const labels: Record<string, string> = {
                sessions: "Sessions",
                floor: "Floor",
                delegations: "Traces",
              };
              const icons: Record<string, string> = {
                sessions: "ph:users",
                floor: "ph:users-three",
                delegations: "ph:graph",
              };
              const isActive = scope === s || (s === "sessions" && scope === "conversation");
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={[
                    "relative flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition-colors",
                    isActive
                      ? "text-[var(--text-primary)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-t after:bg-[oklch(0.65_0.18_280)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                  ].join(" ")}
                >
                  <Icon name={icons[s] as IconName} width={12} />
                  {labels[s]}
                  {s === "delegations" && delegationGraph.traces.length > 0 && (
                    <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 text-[10px] text-[var(--text-secondary)]">
                      {delegationGraph.traces.length}
                    </span>
                  )}
                  {s === "delegations" && runningTraceCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                  {s === "delegations" && failedTraceCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />}
                </button>
              );
            })}
          </div>

          {/* Actions flush right */}
          <div className="flex items-center gap-2 py-1.5">
            {(scope === "sessions" || scope === "conversation") && (
              <div className="relative">
                <Icon name="ph:magnifying-glass" width={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search agents..."
                  className="h-7 w-[160px] rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-3 text-[12px] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] focus:w-[220px] transition-all"
                />
              </div>
            )}
            {(scope === "sessions" || scope === "conversation") && (
              <div className="inline-flex rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-0.5">
                <button type="button" onClick={() => setShowClosed(false)} className={softButton(!showClosed)}>
                  Open <span className="opacity-60">{openCount}</span>
                </button>
                <button type="button" onClick={() => setShowClosed(true)} className={softButton(showClosed)}>
                  Closed <span className="opacity-60">{closedCount}</span>
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => startConversation(activeFamiliarId)}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-presence)] px-2.5 text-[11px] font-medium text-white hover:opacity-90"
            >
              <Icon name="ph:plus-bold" width={11} />
              Chat
            </button>
            <button type="button" title="Configure plugins" onClick={() => onOpenMode("plugins")} className={softButton()}>
              <Icon name="ph:plug" width={12} />
            </button>
            {delegationError && (
              <span className="text-[10px] text-amber-400">{delegationError}</span>
            )}
          </div>
        </div>

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
                    const root = pendingProjectRoot;
                    onClearPendingProjectRoot();
                    window.setTimeout(() => routerRef.current?.newChat(root), 0);
                  } else {
                    window.setTimeout(() => routerRef.current?.goToList(), 0);
                  }
                }}
                pendingProjectRoot={pendingProjectRoot}
              />
            </div>
            {rightPanel !== null && (
              <RightPanel
                panel={rightPanel}
                activeFamiliar={activeFamiliar}
                activeFamiliarId={activeFamiliarId}
                familiars={familiars}
                sessions={sessions}
                daemonRunning={daemonRunning}
                inboxItems={inboxItems}
                onSetPanel={setRightPanel}
                onSessionStarted={onSessionStarted}
                onSlashFromChat={onSlashFromChat}
                onOpenOnboarding={onOpenOnboarding}
                onSetActiveFamiliar={onSetActiveFamiliar}
                onOpenInbox={onOpenInbox}
              />
            )}
          </div>
        ) : (
          /* Sessions list */
          <div className="flex min-h-0 flex-1 flex-col">
            {!daemonRunning && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-700/40 bg-amber-900/20 px-4 py-2 text-[11px] text-amber-200">
                <span className="min-w-0 flex-1">
                  Daemon offline — existing sessions visible but new tasks may not start.
                  {daemonStartError && <span className="ml-2 text-rose-300">{daemonStartError}</span>}
                </span>
                <button
                  type="button"
                  onClick={startDaemon}
                  disabled={startingDaemon}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-400/30 bg-amber-300/10 px-2.5 font-medium text-amber-100 hover:bg-amber-300/20 disabled:opacity-60"
                  title="coven daemon start"
                >
                  <Icon name="ph:rocket-launch-bold" width={12} />
                  {startingDaemon ? "Starting..." : "Start daemon"}
                </button>
              </div>
            )}

            {/* Sessions table */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredSessions.length === 0 ? (
                <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 text-center">
                  <Icon name="ph:robot" width={22} className="text-[var(--text-muted)]" />
                  <p className="text-[12px] text-[var(--text-secondary)]">No sessions yet</p>
                  <button
                    type="button"
                    onClick={() => startConversation(activeFamiliarId)}
                    className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                  >
                    Start a task
                  </button>
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium w-[120px]">Familiar</th>
                      <th className="px-3 py-1.5 text-left font-medium">Title</th>
                      <th className="px-3 py-1.5 text-left font-medium w-[80px]">Status</th>
                      <th className="px-3 py-1.5 text-left font-medium w-[80px]">Harness</th>
                      <th className="px-3 py-1.5 text-left font-medium w-[36px]">Origin</th>
                      <th className="px-3 py-1.5 text-right font-medium w-20">Started</th>
                      <th className="px-3 py-1.5 text-right font-medium w-[72px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)]">
                    {filteredSessions.map((session) => {
                      const familiar = session.familiarId ? famById.get(session.familiarId) : undefined;
                      const isActive = session.id === activeSessionId;
                      const originIcon = (session.origin && ORIGIN_ICONS[session.origin]) ?? "ph:question";
                      return (
                        <tr
                          key={session.id}
                          className={[
                            "group cursor-pointer transition-colors hover:bg-[var(--bg-raised)]",
                            isActive ? "relative bg-[var(--bg-raised)] border-l-2 border-[var(--accent-presence)]" : "",
                          ].join(" ")}
                          onClick={() => openConversation(session)}
                        >
                          {/* Familiar */}
                          <td className="px-3 py-2 w-[120px] max-w-[120px]">
                            <div className="flex items-center gap-1.5 truncate">
                              {familiar?.emoji
                                ? <span className="text-[14px] leading-none">{familiar.emoji}</span>
                                : <Icon name="ph:robot" width={14} className="shrink-0 text-[var(--text-muted)]" />
                              }
                              <span className="truncate text-[var(--text-secondary)]">
                                {familiar?.display_name ?? session.familiarId ?? "—"}
                              </span>
                            </div>
                          </td>
                          {/* Title */}
                          <td className="px-3 py-2">
                            <span className="truncate font-medium text-[var(--text-primary)]">
                              {session.title || "Untitled"}
                            </span>
                          </td>
                          {/* Status */}
                          <td className="px-3 py-2 w-[80px]">
                            <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] capitalize ${statusTone(session)}`}>
                              {session.status}
                            </span>
                          </td>
                          {/* Harness */}
                          <td className="px-3 py-2 w-[80px] truncate text-[var(--text-muted)]">
                            {session.harness}
                          </td>
                          {/* Origin */}
                          <td className="px-3 py-2 w-[36px]">
                            <Icon
                              name={originIcon as IconName}
                              width={13}
                              className="text-[var(--text-muted)]"
                              title={session.origin ?? "unknown"}
                            />
                          </td>
                          {/* Started */}
                          <td className="px-3 py-2 w-20 text-right text-[var(--text-muted)]">
                            {relTime(session.created_at)}
                          </td>
                          {/* Actions */}
                          <td className="px-3 py-2 w-[72px]">
                            <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                title="Open conversation"
                                onClick={(e) => { e.stopPropagation(); openConversation(session); }}
                                className="rounded p-0.5 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              >
                                <Icon name="ph:arrow-square-out" width={13} />
                              </button>
                              <button
                                type="button"
                                title="Archive"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await fetch(`/api/sessions/${session.id}`, {
                                    method: "PATCH",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ archived: true }),
                                  });
                                  onSessionStarted();
                                }}
                                className="rounded p-0.5 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              >
                                <Icon name="ph:archive" width={13} />
                              </button>
                              <button
                                type="button"
                                title="Sacrifice (delete)"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm("Sacrifice this session? This cannot be undone.")) return;
                                  await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
                                  onSessionStarted();
                                }}
                                className="rounded p-0.5 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-rose-400"
                              >
                                <Icon name="ph:trash" width={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
