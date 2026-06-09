"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { AgentsMemoryView } from "@/components/agents-memory-view";
import { SessionsView } from "@/components/sessions-view";
import { InspectorPane } from "@/components/inspector-pane";
import { AgentPanel } from "@/components/agent-panel";
import { Icon } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentsScope = "sessions" | "conversation" | "memory";

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
  pendingChatAction?: PendingChatAction;
  onSetInspectorOpen: (open: boolean) => void;
  onSetRightPanel?: (panel: "inspector" | "chat" | null) => void;
  onSetActiveFamiliar: (id: string) => void;
  onClearPendingProjectRoot: () => void;
  onPendingChatActionHandled: () => void;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onOpenInbox: () => void;
  onCreateReminder: (familiarId: string) => void;
  onOpenInboxItem: (item: InboxItem) => void;
  onInboxItemChanged: () => void | Promise<void>;
  onOpenSession?: (sessionId: string, familiarId?: string) => void;
  onNewChat?: (familiarId?: string) => void;
  onSessionsChanged?: () => void;
};

// ── Right panel (inspector / chat) ────────────────────────────────────────────

function RightPanel({
  panel,
  activeFamiliar,
  sessions,
  daemonRunning,
  inboxItems,
  onSetPanel,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onOpenInbox,
  onCreateReminder,
  onOpenInboxItem,
  onInboxItemChanged,
}: {
  panel: "inspector" | "chat";
  activeFamiliar: Familiar | null;
  sessions: SessionRow[];
  daemonRunning: boolean;
  inboxItems: InboxItem[];
  onSetPanel: (p: "inspector" | "chat" | null) => void;
  onSessionStarted: () => void;
  onSlashFromChat: (cmd: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onOpenInbox: () => void;
  onCreateReminder: (familiarId: string) => void;
  onOpenInboxItem: (item: InboxItem) => void;
  onInboxItemChanged: () => void | Promise<void>;
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
          <InspectorPane
            familiar={activeFamiliar}
            inboxItems={inboxItems}
            onOpenInbox={onOpenInbox}
            onCreateReminder={onCreateReminder}
            onOpenInboxItem={onOpenInboxItem}
            onInboxItemChanged={onInboxItemChanged}
          />
        )}
        {panel === "chat" && (
          <AgentPanel
            ref={null}
            familiar={activeFamiliar}
            sessions={sessions}
            daemonRunning={daemonRunning}
            onSessionStarted={onSessionStarted}
            onSlashFromChat={onSlashFromChat}
            onOpenOnboarding={onOpenOnboarding}
          />
        )}
      </div>
    </aside>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ChatSurface({
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
  pendingChatAction,
  onSetInspectorOpen,
  onSetRightPanel,
  onSetActiveFamiliar,
  onClearPendingProjectRoot,
  onPendingChatActionHandled,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onOpenInbox,
  onCreateReminder,
  onOpenInboxItem,
  onInboxItemChanged,
  onOpenSession,
  onNewChat,
  onSessionsChanged,
}: Props) {
  const [scope, setScope] = useState<AgentsScope>("sessions");
  const consumedPendingActionNonce = useRef<number | null>(null);

  // Right panel — prefer new prop, fall back to legacy bool
  const rightPanel: "inspector" | "chat" | null =
    rightPanelProp !== undefined ? (rightPanelProp ?? null) : inspectorOpen ? "inspector" : null;

  function setRightPanel(next: "inspector" | "chat" | null) {
    if (onSetRightPanel) { onSetRightPanel(next); return; }
    onSetInspectorOpen(next === "inspector");
  }

  const scopedFamiliars = useMemo(() => activeFamiliar ? [activeFamiliar] : [], [activeFamiliar]);

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

  useEffect(() => {
    if (!pendingChatAction) return;
    if (consumedPendingActionNonce.current === pendingChatAction.nonce) return;
    consumedPendingActionNonce.current = pendingChatAction.nonce;
    if (pendingChatAction.kind === "new") {
      if (pendingChatAction.familiarId) onSetActiveFamiliar(pendingChatAction.familiarId);
      setScope("conversation");
      window.setTimeout(
        () => routerRef.current?.newChat(pendingChatAction.projectRoot ?? undefined),
        0,
      );
      onPendingChatActionHandled();
      return;
    }
    if (pendingChatAction.kind === "open") {
      if (pendingChatAction.familiarId) onSetActiveFamiliar(pendingChatAction.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.openSession(pendingChatAction.sessionId), 0);
      onPendingChatActionHandled();
      return;
    }
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.goToList(), 0);
    onPendingChatActionHandled();
  }, [onPendingChatActionHandled, onSetActiveFamiliar, pendingChatAction, routerRef]);

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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className="flex h-full min-w-0 bg-[var(--bg-base)]">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Ultra-minimalist header ────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-hairline)] px-4">
          {/* Tabs flush left */}
          <div className="flex items-end gap-0">
            {(["sessions", "memory"] as const).map((s) => {
              const labels: Record<string, string> = {
                sessions: "Chats",
                memory: "Memory",
              };
              const isActive = scope === s || (s === "sessions" && scope === "conversation");
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={[
                    "relative px-2 py-2.5 text-[12px] transition-colors",
                    isActive
                      ? "text-[var(--text-primary)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[1px] after:bg-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                  ].join(" ")}
                >
                  {labels[s]}
                </button>
              );
            })}
          </div>

          {/* Actions flush right — chromeless */}
          <div className="flex items-center gap-2 py-1.5">
            <button
              type="button"
              onClick={() => startConversation(activeFamiliarId)}
              title="New chat"
              className="inline-flex h-7 items-center gap-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:plus-bold" width={11} />
              New
            </button>
          </div>
        </div>

        {scope === "memory" ? (
          <AgentsMemoryView
            familiars={scopedFamiliars}
            activeFamiliar={activeFamiliar}
            lockToFamiliar
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
                sessions={sessions}
                daemonRunning={daemonRunning}
                onSessionStarted={onSessionStarted}
                onSlashFromChat={onSlashFromChat}
                onOpenOnboarding={onOpenOnboarding}
                pendingProjectRoot={pendingProjectRoot}
              />
            </div>
            {rightPanel !== null && (
              <RightPanel
                panel={rightPanel}
                activeFamiliar={activeFamiliar}
                sessions={sessions}
                daemonRunning={daemonRunning}
                inboxItems={inboxItems}
                onSetPanel={setRightPanel}
                onSessionStarted={onSessionStarted}
                onSlashFromChat={onSlashFromChat}
                onOpenOnboarding={onOpenOnboarding}
                onOpenInbox={onOpenInbox}
                onCreateReminder={onCreateReminder}
                onOpenInboxItem={onOpenInboxItem}
                onInboxItemChanged={onInboxItemChanged}
              />
            )}
          </div>
        ) : (
          /* History fallback — SessionsView when no thread is open */
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SessionsView
                familiars={scopedFamiliars}
                sessions={sessions}
                activeFamiliarId={activeFamiliarId}
                activeSessionId={activeSessionId ?? null}
                hideFamiliarFilter
                onOpenSession={(sessionId, familiarId) => {
                  if (onOpenSession) {
                    onOpenSession(sessionId, familiarId);
                  } else {
                    const session = sessions.find((s) => s.id === sessionId);
                    if (session) openConversation(session);
                  }
                }}
                onNewChat={(familiarId) => {
                  if (onNewChat) {
                    onNewChat(familiarId);
                  } else {
                    startConversation(familiarId ?? activeFamiliarId);
                  }
                }}
                onSessionsChanged={onSessionsChanged ?? onSessionStarted}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
