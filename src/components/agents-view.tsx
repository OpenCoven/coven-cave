"use client";

import React, { useEffect, useMemo, useState, type RefObject } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { AgentsMemoryView } from "@/components/agents-memory-view";
import { CovenFloor } from "@/components/coven-floor";
import { InspectorPane } from "@/components/inspector-pane";
import { AgentPanel } from "@/components/agent-panel";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";
import { inferOrigin } from "@/lib/session-origin";
import type { Familiar, SessionRow } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentsScope = "sessions" | "conversation" | "floor" | "memory";

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

/** Only show a pill for meaningful / attention-worthy statuses. */
function statusPill(s: SessionRow): { label: string; cls: string } | null {
  if (s.status === "running") return { label: "running", cls: "border-[color-mix(in_oklch,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]" };
  if (s.status === "failed" || (s.exit_code !== null && s.exit_code !== 0))
    return { label: "failed", cls: "border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] text-[var(--color-danger)]" };
  return null; // orphaned / created / idle = no pill
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
    <aside className="relative hidden h-full min-h-0 w-[320px] shrink-0 border-l border-[var(--border-hairline)] lg:flex lg:flex-col">
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
      <div className="min-h-0 flex-1 overflow-hidden">
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
      </div>
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
  const [groupBy, setGroupBy] = useState<"familiar" | "status" | "date" | "none">("familiar");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startingDaemon, setStartingDaemon] = useState(false);
  const [daemonStartError, setDaemonStartError] = useState<string | null>(null);

  // Right panel — prefer new prop, fall back to legacy bool
  const rightPanel: "inspector" | "chat" | null =
    rightPanelProp !== undefined ? (rightPanelProp ?? null) : inspectorOpen ? "inspector" : null;

  function setRightPanel(next: "inspector" | "chat" | null) {
    if (onSetRightPanel) { onSetRightPanel(next); return; }
    onSetInspectorOpen(next === "inspector");
  }

  const famById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const openCount = useMemo(() => sessions.filter((s) => !isClosed(s)).length, [sessions]);
  const closedCount = sessions.length - openCount;

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
      .filter((s) => (s.origin ?? inferOrigin(s)) === "chat")
      .filter((s) => (showClosed ? isClosed(s) : !isClosed(s)))
      .filter((s) => {
        if (!q) return true;
        const f = s.familiarId ? famById.get(s.familiarId) : null;
        return [s.title, s.status, s.harness, s.project_root, s.origin ?? "", f?.display_name ?? ""]
          .some((v) => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [famById, query, sessions, showClosed]);

  const groupedSessions = useMemo(() => {
    if (groupBy === "none") return [{ label: null, sessions: filteredSessions }];
    const map = new Map<string, typeof filteredSessions>();
    for (const s of filteredSessions) {
      let key: string;
      if (groupBy === "familiar") {
        const f = s.familiarId ? famById.get(s.familiarId) : null;
        key = f ? f.display_name : "Unknown";
      } else if (groupBy === "status") {
        key = s.status ?? "unknown";
      } else {
        const d = new Date(s.updated_at);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
        if (diffDays < 1) key = "Today";
        else if (diffDays < 2) key = "Yesterday";
        else if (diffDays < 7) key = "This week";
        else key = "Older";
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].map(([label, sessions]) => ({ label, sessions }));
  }, [famById, filteredSessions, groupBy]);

  // Clear selection when filter/group changes
  useEffect(() => { setSelectedIds(new Set()); }, [groupBy, showClosed, query]);

  const allVisibleIds = useMemo(
    () => new Set(filteredSessions.map((s) => s.id)),
    [filteredSessions],
  );
  const allSelected = allVisibleIds.size > 0 && [...allVisibleIds].every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allVisibleIds));
  }
  async function bulkArchive() {
    await Promise.all(
      [...selectedIds].map((id) =>
        fetch(`/api/sessions/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archived: true }),
        }),
      ),
    );
    setSelectedIds(new Set());
    onSessionStarted();
  }
  async function bulkDelete() {
    if (!window.confirm(`Sacrifice ${selectedIds.size} session${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    await Promise.all([...selectedIds].map((id) => fetch(`/api/sessions/${id}`, { method: "DELETE" })));
    setSelectedIds(new Set());
    onSessionStarted();
  }

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
            {(["sessions", "floor", "memory"] as const).map((s) => {
              const labels: Record<string, string> = {
                sessions: "Chats",
                floor: "Floor",
                memory: "Memory",
              };
              const icons: Record<string, string> = {
                sessions: "ph:users",
                floor: "ph:users-three",
                memory: "ph:brain-bold",
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
                </button>
              );
            })}
          </div>

          {/* Actions flush right */}
          <div className="flex items-center gap-1.5 py-1.5">
            {(scope === "sessions" || scope === "conversation") && (
              <div className="relative">
                <Icon name="ph:magnifying-glass" width={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chats…"
                  className="h-7 w-[140px] rounded-md border border-[var(--border-hairline)] bg-transparent pl-7 pr-3 text-[12px] outline-none placeholder:text-[var(--text-muted)] focus:border-[oklch(0.65_0.18_280/60%)] focus:w-[200px] transition-all"
                />
              </div>
            )}
            {(scope === "sessions" || scope === "conversation") && (
              <div className="inline-flex rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-0.5" title="Open / Closed">
                <button type="button" onClick={() => setShowClosed(false)} className={softButton(!showClosed)}>
                  Open <span className="opacity-50 font-normal">{openCount}</span>
                </button>
                <button type="button" onClick={() => setShowClosed(true)} className={softButton(showClosed)}>
                  Closed <span className="opacity-50 font-normal">{closedCount}</span>
                </button>
              </div>
            )}
            {(scope === "sessions" || scope === "conversation") && (
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
                className="h-7 cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-2 pr-6 text-[11px] text-[var(--text-muted)] outline-none hover:text-[var(--text-secondary)] focus:border-[oklch(0.65_0.18_280/50%)] appearance-none"
                title="Group by"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23888' d='M2 3.5l3 3 3-3'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
              >
                <option value="familiar">Familiar</option>
                <option value="status">Status</option>
                <option value="date">Date</option>
                <option value="none">None</option>
              </select>
            )}
            <button
              type="button"
              onClick={() => startConversation(activeFamiliarId)}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-[oklch(0.65_0.18_280)] px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-[oklch(0.6_0.18_280)] transition-colors"
            >
              <Icon name="ph:plus-bold" width={11} />
              Chat
            </button>
            <button type="button" title="Configure plugins" onClick={() => onOpenMode("plugins")} className={softButton()}>
              <Icon name="ph:plug" width={12} />
            </button>
          </div>
        </div>

        {scope === "floor" ? (
          <CovenFloor />
        ) : scope === "memory" ? (
          <AgentsMemoryView
            familiars={familiars}
            activeFamiliar={activeFamiliar}
            onOpenMemoryFile={(path) => {
              setRightPanel("inspector");
              window.location.hash = `memory:${encodeURIComponent(path)}`;
            }}
          />
        ) : scope === "conversation" ? (
          <div className="flex min-h-0 min-w-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1">
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
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-4 py-2 text-[11px] text-[var(--color-warning)]">
                <span className="min-w-0 flex-1">
                  Daemon offline — existing sessions visible but new tasks may not start.
                  {daemonStartError && <span className="ml-2 text-[var(--color-danger)]">{daemonStartError}</span>}
                </span>
                <button
                  type="button"
                  onClick={startDaemon}
                  disabled={startingDaemon}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2.5 font-medium text-[var(--color-warning)] hover:bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] disabled:opacity-60"
                  title="coven daemon start"
                >
                  <Icon name="ph:rocket-launch-bold" width={12} />
                  {startingDaemon ? "Starting..." : "Start daemon"}
                </button>
              </div>
            )}

            {/* Chats list */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredSessions.length === 0 ? (
                <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 text-center">
                  <Icon name="ph:chats-circle" width={28} className="text-[var(--text-muted)]" />
                  <p className="text-[13px] text-[var(--text-secondary)]">No chats yet</p>
                  <button
                    type="button"
                    onClick={() => startConversation(activeFamiliarId)}
                    className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                  >
                    Start a chat
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-hairline)]">
                  {groupedSessions.map(({ label, sessions: groupSessions }) => (
                    <React.Fragment key={label ?? "__ungrouped__"}>
                      {label !== null && (
                        <div className="sticky top-0 z-10 bg-[var(--bg-canvas)]/95 backdrop-blur-sm px-5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border-hairline)]">
                          {label}
                          <span className="ml-1.5 font-normal opacity-40">{groupSessions.length}</span>
                        </div>
                      )}
                      {groupSessions.map((session) => {
                        const familiar = session.familiarId ? famById.get(session.familiarId) : undefined;
                        const isActive = session.id === activeSessionId;
                        const pill = statusPill(session);
                        return (
                          <div
                            key={session.id}
                            role="button"
                            tabIndex={0}
                            className={[
                              "group relative flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-raised)]",
                              isActive ? "bg-[var(--bg-raised)]" : "",
                            ].join(" ")}
                            onClick={() => openConversation(session)}
                            onKeyDown={(e) => e.key === "Enter" && openConversation(session)}
                          >
                            {/* Active indicator */}
                            {isActive && <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-[oklch(0.65_0.18_280)]" />}
                            {/* Content */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2">
                                <span className={[
                                  "flex-1 truncate text-[13px] leading-snug",
                                  isActive ? "font-semibold text-[var(--text-primary)]" : "font-medium text-[var(--text-primary)]",
                                ].join(" ")}>
                                  {session.title || "Untitled"}
                                </span>
                                <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">{relTime(session.updated_at ?? session.created_at)}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <span className="truncate text-[11.5px] text-[var(--text-muted)]">
                                  {familiar?.display_name ?? session.familiarId ?? ""}
                                </span>
                                {pill && (
                                  <span className={`shrink-0 inline-block rounded-full border px-1.5 py-px text-[10px] capitalize ${pill.cls}`}>
                                    {pill.label}
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* Hover actions */}
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
                                className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                              >
                                <Icon name="ph:archive" width={14} />
                              </button>
                              <button
                                type="button"
                                title="Delete"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm("Delete this chat? This cannot be undone.")) return;
                                  await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
                                  onSessionStarted();
                                }}
                                className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--color-danger)]"
                              >
                                <Icon name="ph:trash" width={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
