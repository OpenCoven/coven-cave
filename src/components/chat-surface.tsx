"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { FamiliarsMemoryView } from "@/components/familiars-memory-view";
import { ProjectsView } from "@/components/projects-view";
import { InspectorPane } from "@/components/inspector-pane";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import { DebugPane } from "@/components/debug-pane";
import { SessionChangesPanel } from "@/components/session-changes-panel";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useIsMobile } from "@/lib/use-viewport";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";

// ── Types ─────────────────────────────────────────────────────────────────────

type FamiliarsScope = "conversation" | "memory" | "projects";

export type RightPanelKind = "inspector" | "changes" | "debug";

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliar: Familiar | null;
  activeFamiliarId: string | null;
  daemonRunning: boolean;
  routerRef: RefObject<ChatRouterHandle | null>;
  sessionsLoaded?: boolean;
  inboxItems: InboxItem[];
  inspectorOpen: boolean;
  rightPanel?: RightPanelKind | null;
  pendingProjectRoot: string | null;
  pendingChatAction?: PendingChatAction;
  onSetInspectorOpen: (open: boolean) => void;
  onSetRightPanel?: (panel: RightPanelKind | null) => void;
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
  onSessionsChanged?: () => void;
  /** Forwarded to ChatRouter → ChatView so the Task chip in the chat header
   *  routes back to the board with the linked card focused. */
  onOpenTask?: (cardId: string) => void;
};

// ── Right panel (inspector / chat) ────────────────────────────────────────────

function RightPanel({
  panel,
  activeFamiliar,
  inboxItems,
  onSetPanel,
  onOpenInbox,
  onCreateReminder,
  onOpenInboxItem,
  onInboxItemChanged,
}: {
  panel: RightPanelKind;
  activeFamiliar: Familiar | null;
  inboxItems: InboxItem[];
  onSetPanel: (p: RightPanelKind | null) => void;
  onOpenInbox: () => void;
  onCreateReminder: (familiarId: string) => void;
  onOpenInboxItem: (item: InboxItem) => void;
  onInboxItemChanged: () => void | Promise<void>;
}) {
  const primaryPanel: Exclude<RightPanelKind, "changes"> = panel === "debug" ? "debug" : "inspector";

  return (
    // CHAT-D13-05: this panel renders inside the shell's <main>, where a
    // complementary landmark is invalid (axe landmark-complementary-is-top-level)
    // — expose it as a named region instead.
    <aside role="region" aria-label="Session panels" className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--border-hairline)]">
      <Group className="right-panel-split" orientation="vertical">
        <Panel id="right-panel-primary" className="right-panel-pane min-h-0" defaultSize="50%" minSize="25%">
          <div className="right-panel-tabs">
            <button
              type="button"
              className={`right-panel-tab${primaryPanel === "inspector" ? " right-panel-tab--active" : ""}`}
              onClick={() => onSetPanel("inspector")}
            >
              <Icon name="ph:brain-bold" width={13} />
              Inspector
            </button>
            <button
              type="button"
              className={`right-panel-tab${primaryPanel === "debug" ? " right-panel-tab--active" : ""}`}
              onClick={() => onSetPanel("debug")}
            >
              <Icon name="ph:bug-bold" width={13} />
              Debug
            </button>
            <button type="button" className="right-panel-close" onClick={() => onSetPanel(null)}>
              <Icon name="ph:x-bold" width={11} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {primaryPanel === "inspector" && (
              <InspectorPane
                familiar={activeFamiliar}
                inboxItems={inboxItems}
                onOpenInbox={onOpenInbox}
                onCreateReminder={onCreateReminder}
                onOpenInboxItem={onOpenInboxItem}
                onInboxItemChanged={onInboxItemChanged}
              />
            )}
            {primaryPanel === "debug" && <DebugPane />}
          </div>
        </Panel>
        <Separator className="shell-separator-h right-panel-splitter">
          <SeparatorHandle orientation="row" />
        </Separator>
        <Panel id="right-panel-changes" className="right-panel-pane min-h-0" defaultSize="50%" minSize="25%">
          <div className="right-panel-changes-header">
            <span className="right-panel-changes-title">
              <Icon name="ph:git-diff" width={13} />
              Changes
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <SessionChangesPanel />
          </div>
        </Panel>
      </Group>
    </aside>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ChatSurface({
  familiars,
  sessions,
  activeFamiliar,
  activeFamiliarId,
  daemonRunning,
  routerRef,
  sessionsLoaded,
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
  onSessionsChanged,
  onOpenTask,
}: Props) {
  const [scope, setScope] = useState<FamiliarsScope>("conversation");
  // Below the desktop shell breakpoint the inline 230px right sidebar is hidden
  // (no room beside the chat thread), so the Inspector/Debug/Changes panels would
  // be unreachable. On mobile we render them in a right-edge sheet overlay instead.
  const isMobile = useIsMobile();
  const consumedPendingActionNonce = useRef<number | null>(null);

  // Right panel — prefer new prop, fall back to legacy bool
  const rightPanel: RightPanelKind | null =
    rightPanelProp !== undefined ? (rightPanelProp ?? null) : inspectorOpen ? "inspector" : null;

  function setRightPanel(next: RightPanelKind | null) {
    if (onSetRightPanel) { onSetRightPanel(next); return; }
    onSetInspectorOpen(next === "inspector");
  }

  const scopedFamiliars = useMemo(() => activeFamiliar ? [activeFamiliar] : familiars, [activeFamiliar, familiars]);

  // Window events
  useEffect(() => {
    const onNewChat = (e: Event) => {
      const d = (e as CustomEvent<{ familiarId?: string | null; projectRoot?: string | null }>).detail;
      if (d?.familiarId) onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.newChat(d?.projectRoot ?? undefined, undefined, d?.familiarId), 0);
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

  // ChatView's MetaLine bug button opens the Debug tab from a different
  // subtree — same window-event bridge as the cave:agents-* events above.
  // The thread rail's advanced-operations launchers (Git/Inspector/Debug)
  // reach the right panel through the same bridge.
  useEffect(() => {
    if (!onSetRightPanel) return;
    const onDebugOpen = () => onSetRightPanel("debug");
    const onInspectorOpen = () => onSetRightPanel("inspector");
    const onChangesOpen = () => onSetRightPanel("changes");
    window.addEventListener("cave:debug-open", onDebugOpen);
    window.addEventListener("cave:inspector-open", onInspectorOpen);
    window.addEventListener("cave:changes-open", onChangesOpen);
    return () => {
      window.removeEventListener("cave:debug-open", onDebugOpen);
      window.removeEventListener("cave:inspector-open", onInspectorOpen);
      window.removeEventListener("cave:changes-open", onChangesOpen);
    };
  }, [onSetRightPanel]);

  useEffect(() => {
    if (!pendingChatAction) return;
    if (consumedPendingActionNonce.current === pendingChatAction.nonce) return;
    consumedPendingActionNonce.current = pendingChatAction.nonce;
    if (pendingChatAction.kind === "new") {
      if (pendingChatAction.familiarId) onSetActiveFamiliar(pendingChatAction.familiarId);
      setScope("conversation");
      window.setTimeout(
        () => routerRef.current?.newChat(
          pendingChatAction.projectRoot ?? undefined,
          pendingChatAction.initialPrompt ?? undefined,
          pendingChatAction.familiarId,
        ),
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
    window.setTimeout(() => routerRef.current?.newChat(undefined, undefined, familiarId), 0);
  }

  function startProjectChat(projectRoot: string) {
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.newChat(projectRoot), 0);
  }

  useEffect(() => {
    const open = () => setScope("projects");
    window.addEventListener(CHAT_OPEN_PROJECTS_EVENT, open);
    return () => window.removeEventListener(CHAT_OPEN_PROJECTS_EVENT, open);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className="chat-surface flex h-full min-w-0 bg-[var(--bg-base)]">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Ultra-minimalist header ────────────────────────────────────── */}
        <div className="chat-scope-tabs chat-scope-tabs--minimal flex shrink-0 items-center justify-between border-b border-[var(--border-hairline)] px-4">
          {/* Tabs flush left — Vercel-style underline tabs. The header row
              already draws the divider, so the tablist itself is borderless. */}
          <Tabs<FamiliarsScope>
            bordered={false}
            value={scope}
            onChange={(s) => {
              setScope(s);
              if (s === "conversation") {
                window.setTimeout(() => routerRef.current?.goToList(), 0);
              }
            }}
            items={[
              { id: "conversation", label: "Chats" },
              { id: "memory", label: "Memory" },
              { id: "projects", label: "Projects" },
            ]}
          />

          {/* Actions flush right — chromeless */}
          <div className="flex items-center gap-2 py-1.5">
            <button
              type="button"
              onClick={() => startConversation(activeFamiliarId)}
              title="New chat"
              className="chat-scope-tabs__new inline-flex h-7 items-center gap-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:plus-bold" width={11} />
              New
            </button>
          </div>
        </div>

        {scope === "memory" ? (
          <FamiliarsMemoryView
            familiars={scopedFamiliars}
            activeFamiliar={activeFamiliar}
            lockToFamiliar
            onOpenMemoryFile={(path) => {
              setRightPanel("inspector");
              window.location.hash = `memory:${encodeURIComponent(path)}`;
            }}
          />
        ) : scope === "projects" ? (
          <ProjectsView sessions={sessions} onNewChat={startProjectChat} />
        ) : (
          <Group className="flex min-h-0 min-w-0 flex-1" orientation="horizontal">
            <Panel id="chat-main" className="flex min-h-0 min-w-0" minSize="45%">
              <div className="min-h-0 min-w-0 flex-1">
                <ChatRouter
                  ref={routerRef}
                  familiar={activeFamiliar}
                  familiars={familiars}
                  sessions={sessions}
                  daemonRunning={daemonRunning}
                  sessionsLoaded={sessionsLoaded}
                  onSetActiveFamiliar={onSetActiveFamiliar}
                  onSessionStarted={onSessionStarted}
                  onSessionsChanged={onSessionsChanged}
                  onSlashFromChat={onSlashFromChat}
                  onOpenOnboarding={onOpenOnboarding}
                  pendingProjectRoot={pendingProjectRoot}
                  onOpenTask={onOpenTask}
                  syncUrlHash
                />
              </div>
            </Panel>
            {rightPanel !== null && !isMobile && (
              <>
                {/* Fixed-width mirror of the internal left rail (chat-thread-rail
                    is w-[230px]). No resize handle — the panel's own border-l is
                    the divider, matching the left rail's border-r. */}
                <Panel
                  id="right-sidebar"
                  className="hidden min-h-0 min-w-0 lg:flex"
                  defaultSize="230px"
                  minSize="230px"
                  maxSize="230px"
                >
                  <RightPanel
                    panel={rightPanel}
                    activeFamiliar={activeFamiliar}
                    inboxItems={inboxItems}
                    onSetPanel={setRightPanel}
                    onOpenInbox={onOpenInbox}
                    onCreateReminder={onCreateReminder}
                    onOpenInboxItem={onOpenInboxItem}
                    onInboxItemChanged={onInboxItemChanged}
                  />
                </Panel>
              </>
            )}
          </Group>
        )}
      </div>
      {/* Mobile: the inline 230px right sidebar can't fit beside the chat thread,
          so the Inspector/Debug/Changes panels open in a right-edge sheet over a
          dismissible scrim. Gated on isMobile so only one RightPanel mounts per
          breakpoint — the InspectorPane won't double-fetch or duplicate DOM ids.
          Scoped to the conversation tab to mirror the desktop placement. */}
      {scope === "conversation" && rightPanel !== null && isMobile && (
        <div
          className="chat-right-sheet fixed inset-0 z-[200] flex justify-end lg:hidden"
          role="presentation"
          onKeyDown={(e) => {
            if (e.key === "Escape") setRightPanel(null);
          }}
        >
          <button
            type="button"
            aria-label="Close session panels"
            className="absolute inset-0 bg-[var(--backdrop-scrim)]"
            onClick={() => setRightPanel(null)}
          />
          <div className="relative flex h-full w-[min(92vw,420px)] flex-col bg-[var(--bg-raised)] shadow-[-8px_0_32px_rgba(0,0,0,0.2)] [padding-bottom:var(--sai-bottom)] [padding-top:var(--sai-top)]">
            <RightPanel
              panel={rightPanel}
              activeFamiliar={activeFamiliar}
              inboxItems={inboxItems}
              onSetPanel={setRightPanel}
              onOpenInbox={onOpenInbox}
              onCreateReminder={onCreateReminder}
              onOpenInboxItem={onOpenInboxItem}
              onInboxItemChanged={onInboxItemChanged}
            />
          </div>
        </div>
      )}
    </section>
  );
}
