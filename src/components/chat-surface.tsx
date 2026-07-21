"use client";

import "@/styles/cave-chat.css";
import "@/styles/cave-md.css";
import "@/styles/cave-composer.css";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import {
  ChatCanvasView,
  ChatFamiliarView,
  ChatSettingsView,
  GroupChatView,
  ProjectsView,
  WorkspaceRail,
} from "@/components/lazy-surfaces";
import { CHAT_OPEN_PROJECTS_EVENT, CHAT_OPEN_COVEN_EVENT, consumeCovenTabPending, consumeProjectsTabPending } from "@/lib/chat-tab-events";
import { requestDebugOpen, useChatDebugSnapshot } from "@/lib/chat-debug-store";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { WorkspaceRailSheet } from "@/components/workspace-rail-sheet";
import { useWorkspaceRailController } from "@/lib/use-workspace-rail-controller";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { Familiar, SessionOrigin, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";
import type { PendingCodeRailOpen } from "@/lib/pending-code-rail-open";
import type { InitialCommandControls } from "@/lib/command-controls";
import { requestSummonFamiliar } from "@/lib/summon-events";

// ── Layout persistence ─────────────────────────────────────────────────────────

// Persists the chat thread / code-rail split width across reloads. Keyed by
// the set of mounted panel ids, so the no-rail layout doesn't clobber the
// with-rail one. localStorage-backed, fails soft under strict privacy modes.
const CHAT_GROUP_ID = "cave.chat.widths.v1";
const chatStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore — strict privacy mode or storage quota */
    }
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

// Memory is deliberately absent: familiar memory lives in the Familiars
// surface and the Grimoire editor, not as a chat scope (cave-liut).
// "familiar" is the active familiar's capability panel, promoted from the
// retired inspector sidepanel to a first-class chat tab.
// "settings" is the consolidated chat-settings tab (auto-archive policy et al).
// "canvas" is the gallery of sketches saved from chat artifacts — saves landed
// in the canvas store with no surface after the standalone Canvas page retired.
type FamiliarsScope = "conversation" | "projects" | "coven" | "familiar" | "settings" | "canvas";

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliar: Familiar | null;
  activeFamiliarId: string | null;
  selectedFamiliarIds: ReadonlySet<string>;
  daemonRunning: boolean;
  routerRef: RefObject<ChatRouterHandle | null>;
  sessionsLoaded?: boolean;
  /** Last session-list load failed — chat list shows a can't-load state (cave-x6k5). */
  sessionsError?: boolean;
  familiarsLoaded?: boolean;
  /** Roster-load failure + retry, forwarded to ChatRouter's empty state (cave-atzv). */
  familiarsError?: string | null;
  onRetryFamiliars?: () => void;
  pendingProjectRoot: string | null;
  pendingChatAction?: PendingChatAction;
  pendingCodeRailOpen?: PendingCodeRailOpen | null;
  onSetActiveFamiliar: (id: string | null) => void;
  onFamiliarScopeChange: (id: string | null, opts?: { multi?: boolean; preserveSurface?: boolean }) => void;
  onClearPendingProjectRoot: () => void;
  onPendingChatActionHandled: () => void;
  onPendingCodeRailOpenHandled: () => void;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onSessionsChanged?: () => void;
  onSessionsDeleted: (sessionIds: readonly string[]) => void;
  /** Forwarded to ChatRouter → ChatView so the Task chip in the chat header
   *  routes back to the board with the linked card focused. */
  onOpenTask?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
  /** Drop the in-surface project/thread rail. Set when the outer
   *  WorkspaceSidebar already owns the project-grouped chat list (desktop list
   *  pane or mobile list drawer), so the in-surface rail would duplicate it. */
  hideThreadRail?: boolean;
};

// ── Main view ─────────────────────────────────────────────────────────────────

export function ChatSurface({
  familiars,
  sessions,
  activeFamiliar,
  activeFamiliarId,
  selectedFamiliarIds,
  daemonRunning,
  routerRef,
  sessionsLoaded,
  sessionsError,
  familiarsLoaded,
  familiarsError,
  onRetryFamiliars,
  pendingProjectRoot,
  pendingChatAction,
  pendingCodeRailOpen,
  onSetActiveFamiliar,
  onFamiliarScopeChange,
  onClearPendingProjectRoot,
  onPendingChatActionHandled,
  onPendingCodeRailOpenHandled,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onSessionsChanged,
  onSessionsDeleted,
  onOpenTask,
  onOpenUrl,
  hideThreadRail = false,
}: Props) {
  // The in-surface project/thread rail is dropped when the outer WorkspaceSidebar
  // already owns chats beside the surface.
  const compactRail = hideThreadRail;
  const [scope, setScope] = useState<FamiliarsScope>("conversation");
  const surfaceRef = useRef<HTMLElement | null>(null);
  const consumedPendingActionNonce = useRef<number | null>(null);
  const snapshot = useChatDebugSnapshot();
  const activeSession = snapshot.session;
  const railProjectRoot = activeSession?.project_root ?? null;
  const sessionRunning = activeSession?.status === "running";
  const activateConversation = useCallback(() => setScope("conversation"), []);
  // Coven "Debug thread": a participant's pinned session is a regular resumable
  // daemon session, so debugging it = opening it as a conversation with the
  // debug modal latched (same S1 latch the rail's Debug action uses). The
  // latch survives until the ChatView mounts, so ordering is forgiving.
  const debugGroupSession = useCallback(
    (sessionId: string, familiarId: string) => {
      onSetActiveFamiliar(familiarId);
      setScope("conversation");
      window.setTimeout(() => {
        routerRef.current?.openSession(sessionId);
        requestDebugOpen();
      }, 0);
    },
    [onSetActiveFamiliar, routerRef],
  );
  const railController = useWorkspaceRailController({
    containerRef: surfaceRef,
    projectRoot: railProjectRoot,
    sessionId: snapshot.sessionId ?? null,
    sessionRunning,
    active: scope === "conversation",
    onActivate: activateConversation,
  });
  const {
    rail,
    changeCount,
    effectiveProjectRoot,
    focus: codeRailFocus,
    reopenChecksFailing,
    isMobile,
    paneNarrow,
    showInline: showCodeRail,
    mobileAvailable: mobileRail,
    mobileOpen: mobileRailOpen,
    setMobileOpen: setMobileRailOpen,
    openTarget: openCodeRailTarget,
    collapse: collapseCodeRail,
  } = railController;

  // Persist the chat / right-area split. panelIds tracks which panels are
  // actually mounted so the with-rail and bare layouts persist separately.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: CHAT_GROUP_ID,
    panelIds: [
      "chat-main",
      ...(showCodeRail ? ["code-rail"] : []),
    ],
    storage: chatStorage,
  });

  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });

  // Window events
  useEffect(() => {
    const onNewChat = (e: Event) => {
      const d = (e as CustomEvent<{ familiarId?: string | null; projectRoot?: string | null; initialPrompt?: string | null; origin?: SessionOrigin; initialControls?: InitialCommandControls | null }>).detail;
      if (d?.familiarId) onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(
        () => routerRef.current?.newChat(
          d?.projectRoot ?? undefined,
          d?.initialPrompt ?? undefined,
          d?.familiarId,
          d?.origin,
          d?.initialControls ?? undefined,
        ),
        0,
      );
    };
    const onOpenSession = (e: Event) => {
      const d = (e as CustomEvent<{ sessionId?: string; familiarId?: string | null }>).detail;
      if (!d?.sessionId) return;
      if (d.familiarId) onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.openSession(d.sessionId!), 0);
    };
    const onFamiliarSelect = (e: Event) => {
      const d = (e as CustomEvent<{ familiarId?: string | null }>).detail;
      if (!d?.familiarId) return;
      onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.goToList(), 0);
    };
    // (cave-nwi8) "cave:agents-list" had zero dispatchers repo-wide — its
    // listener is gone so no future emitter half-works against it.
    window.addEventListener("cave:agents-new-chat", onNewChat);
    window.addEventListener("cave:agents-open-session", onOpenSession);
    window.addEventListener("cave:familiar-select", onFamiliarSelect);
    return () => {
      window.removeEventListener("cave:agents-new-chat", onNewChat);
      window.removeEventListener("cave:agents-open-session", onOpenSession);
      window.removeEventListener("cave:familiar-select", onFamiliarSelect);
    };
  }, [onSetActiveFamiliar, routerRef]);

  // The thread rail's advanced-operations launchers reach this surface through
  // window-event bridges (same shape as the cave:agents-* events above).
  // The retired inspector sidepanel's destinations map onto the surviving
  // surfaces: Inspect opens the Familiar chat tab; Git/Changes opens the code
  // rail's Changes tab. (cave:debug-open is owned by ChatView's debug modal.)
  useEffect(() => {
    const onInspectorOpen = () => setScope("familiar");
    window.addEventListener("cave:inspector-open", onInspectorOpen);
    return () => {
      window.removeEventListener("cave:inspector-open", onInspectorOpen);
    };
  }, []);

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
          undefined,
          pendingChatAction.initialControls ?? undefined,
          pendingChatAction.initialAttachments ?? undefined,
        ),
        0,
      );
      onPendingChatActionHandled();
      return;
    }
    if (pendingChatAction.kind === "open") {
      if (pendingChatAction.familiarId) onSetActiveFamiliar(pendingChatAction.familiarId);
      setScope("conversation");
      const findQuery = pendingChatAction.findQuery;
      const autoVoice = pendingChatAction.autoVoice;
      window.setTimeout(() => routerRef.current?.openSession(pendingChatAction.sessionId, findQuery, autoVoice), 0);
      onPendingChatActionHandled();
      return;
    }
    if (pendingChatAction.kind === "open-split") {
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.openSessionInSplit(pendingChatAction.sessionId), 0);
      onPendingChatActionHandled();
      return;
    }
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.goToList(), 0);
    onPendingChatActionHandled();
  }, [onPendingChatActionHandled, onSetActiveFamiliar, pendingChatAction, routerRef]);

  useEffect(() => {
    if (!pendingCodeRailOpen) return;
    openCodeRailTarget(pendingCodeRailOpen);
    onPendingCodeRailOpenHandled();
  }, [onPendingCodeRailOpenHandled, openCodeRailTarget, pendingCodeRailOpen]);

  function startProjectChat(projectRoot: string) {
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.newChat(projectRoot), 0);
  }

  // Hero "New chat" bridge: land on the conversation tab with a fresh session
  // for this familiar (same latch-then-route shape as the handlers above).
  function startFamiliarHeroChat(familiarId: string) {
    onSetActiveFamiliar(familiarId);
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.newChat(undefined, undefined, familiarId), 0);
  }

  useEffect(() => {
    // Board→Projects handoffs fire the event from a surface where this
    // listener isn't mounted yet — consume the retained latch on mount so the
    // Projects tab opens even when the event loses the race (cave-c2zf; same
    // shape as the coven-tab latch below).
    if (consumeProjectsTabPending()) setScope("projects");
    const open = () => setScope("projects");
    window.addEventListener(CHAT_OPEN_PROJECTS_EVENT, open);
    return () => window.removeEventListener(CHAT_OPEN_PROJECTS_EVENT, open);
  }, []);

  // The retired standalone `groupchat` mode now lands here as a tab: the
  // Workspace redirects it to chat and fires this event so the Group tab opens.
  // On a fresh mount (redirect from another surface) the event can beat this
  // listener, so we also consume a retained latch the Workspace sets first.
  useEffect(() => {
    if (consumeCovenTabPending()) setScope("coven");
    const open = () => setScope("coven");
    window.addEventListener(CHAT_OPEN_COVEN_EVENT, open);
    return () => window.removeEventListener(CHAT_OPEN_COVEN_EVENT, open);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section ref={surfaceRef} className="chat-surface relative flex h-full min-w-0 bg-[var(--bg-base)]">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Header ──────────────────────────────────────────────────────
            Chat keeps Projects discoverable as a first-class tab. */}
        <div className="chat-scope-tabs chat-scope-tabs--minimal flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4">
          <Tabs<FamiliarsScope>
            bordered={false}
            ariaLabel="Chat sections"
            className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            value={scope}
            onChange={(s) => {
              setScope(s);
              if (s === "conversation") {
                window.setTimeout(() => routerRef.current?.goToList(), 0);
              }
            }}
            items={[
              { id: "conversation", label: "Sessions" },
              { id: "projects", label: "Projects" },
              { id: "canvas", label: "Canvas" },
              { id: "familiar", label: "Familiar" },
              { id: "settings", label: "Settings" },
            ]}
          />
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Group demoted from a co-equal tab (cave-xsq.5): the default chat
                surface reads as a conversation (Sessions / Projects), and Group
                — broadcast one prompt to a coven — is a quiet icon here instead.
                Still one click, still activated by CHAT_OPEN_COVEN_EVENT. */}
            <button
              type="button"
              className={`chat-scope-group-btn focus-ring${scope === "coven" ? " is-active" : ""}`}
              aria-label="Group chat — broadcast one prompt to a coven of familiars"
              aria-pressed={scope === "coven"}
              title="Group chat — broadcast one prompt to a coven of familiars"
              onClick={() => setScope("coven")}
            >
              <Icon name="ph:users-three" width={16} aria-hidden />
            </button>
            {/* Mobile / narrow-pane code-rail toggle. On desktop the rail is a
                third column; below the breakpoint there's no room, so it opens
                as a right-edge slide-over sheet (below). Scoped to the
                conversation tab so it doesn't hover over the Projects list. */}
            {mobileRail && scope === "conversation" && (
              <button
                type="button"
                className="mobile-code-rail-toggle focus-ring"
                aria-label={mobileRailOpen ? "Hide code rail" : "Show code rail"}
                aria-haspopup="dialog"
                aria-expanded={mobileRailOpen}
                onClick={() => {
                  setMobileRailOpen((v) => !v);
                }}
              >
                <Icon name="ph:code" width={16} aria-hidden />
                {(changeCount ?? 0) > 0 ? (
                  <span className="mobile-code-rail-toggle__badge">{changeCount}</span>
                ) : null}
              </button>
            )}
          </div>
        </div>

        {scope === "projects" ? (
          <ProjectsView sessions={sessions} familiars={familiars} onNewChat={startProjectChat} onSessionsChanged={onSessionsChanged} onSessionsDeleted={onSessionsDeleted} activeFamiliarId={activeFamiliarId} />
        ) : scope === "canvas" ? (
          // Saved-sketch gallery: everything "Save to Canvas" persisted from
          // inline chat artifacts, browsable/reopenable/deletable in place.
          <div className="flex min-h-0 min-w-0 flex-1">
            <ChatCanvasView familiarId={activeFamiliarId} />
          </div>
        ) : scope === "familiar" ? (
          // The active familiar's identity + capability surface (hero, role,
          // skills, tools) — a purpose-built first-class chat tab, since it
          // describes who you're chatting with.
          <div className="flex min-h-0 min-w-0 flex-1 justify-center">
            <div className="h-full w-full max-w-7xl">
              <ChatFamiliarView
                familiar={activeFamiliar}
                familiars={familiars}
                selectedFamiliarIds={selectedFamiliarIds}
                familiarsLoaded={familiarsLoaded}
                familiarsError={familiarsError}
                daemonRunning={daemonRunning}
                onRetryFamiliars={onRetryFamiliars}
                onCreateFamiliar={requestSummonFamiliar}
                onOpenOnboarding={onOpenOnboarding}
                onFamiliarScopeChange={onFamiliarScopeChange}
                onStartChat={startFamiliarHeroChat}
              />
            </div>
          </div>
        ) : scope === "settings" ? (
          // Consolidated chat settings (cave-wide auto-archive policy, incl.
          // archive-on-reflection) as a first-class chat tab — the knobs govern
          // chat behavior, so they live where chats live.
          <div className="flex min-h-0 min-w-0 flex-1">
            <ChatSettingsView />
          </div>
        ) : scope === "coven" ? (
          // Group Chat ("coven") lives here as a first-class chat tab instead of
          // a standalone surface. It broadcasts one prompt to several familiars,
          // each answering in its own resumable session (see GroupChatView).
          <div className="flex min-h-0 min-w-0 flex-1">
            <GroupChatView
              familiars={resolvedFamiliars}
              onSessionStarted={onSessionStarted}
              onOpenUrl={onOpenUrl}
              onDebugSession={debugGroupSession}
            />
          </div>
        ) : (
          <Group
            className="flex min-h-0 min-w-0 flex-1"
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <Panel id="chat-main" className="flex min-h-0 min-w-0" minSize="45%">
              <div className="min-h-0 min-w-0 flex-1">
                <ChatRouter
                  ref={routerRef}
                  familiar={activeFamiliar}
                  familiars={familiars}
                  sessions={sessions}
                  daemonRunning={daemonRunning}
                  sessionsLoaded={sessionsLoaded}
                  sessionsError={sessionsError}
                  familiarsLoaded={familiarsLoaded}
                  familiarsError={familiarsError}
                  onRetryFamiliars={onRetryFamiliars}
                  hideRail={compactRail}
                  onSetActiveFamiliar={onSetActiveFamiliar}
                  onSessionStarted={onSessionStarted}
                  onSessionsChanged={onSessionsChanged}
                  onSessionsDeleted={onSessionsDeleted}
                  onSlashFromChat={onSlashFromChat}
                  onOpenOnboarding={onOpenOnboarding}
                  pendingProjectRoot={pendingProjectRoot}
                  onOpenTask={onOpenTask}
                  onOpenUrl={onOpenUrl}
                  onOpenProjectsTab={() => setScope("projects")}
                  syncUrlHash
                  enableSplitPanes
                />
              </div>
            </Panel>
            {showCodeRail && (
              <>
                <Separator className="shell-separator hidden lg:flex">
                  <SeparatorHandle orientation="col" />
                </Separator>
                <Panel
                  id="code-rail"
                  className="hidden min-h-0 min-w-0 lg:flex"
                  defaultSize="320px"
                  minSize="240px"
                  maxSize="560px"
                >
                  <WorkspaceRail
                    changeCount={changeCount ?? 0}
                    activeTab={rail.activeTab}
                    pinned={rail.pinned}
                    projectRoot={effectiveProjectRoot}
                    familiarId={snapshot.familiar?.id ?? null}
                    sessionId={snapshot.sessionId ?? null}
                    focus={codeRailFocus}
                    onSelectTab={rail.setActiveTab}
                    onTogglePin={rail.togglePin}
                    onCollapse={collapseCodeRail}
                  />
                </Panel>
              </>
            )}
          </Group>
        )}
      </div>
      {/* Collapsed code rail: a full-height reopen rail on the right edge that
          mirrors the left nav's collapsed "Chats" rail (same width, icon over a
          vertical label — here "Code"). Shown when the rail is available for
          the active repo session but has been collapsed (or auto-hidden
          between edit batches). Same desktop-only / wide-enough gate as the
          mounted rail. */}
      {rail.available && !rail.open && !isMobile && !paneNarrow && (
        <button
          type="button"
          aria-label={reopenChecksFailing ? "Show code rail — PR checks failing" : "Show code rail"}
          title={reopenChecksFailing ? "PR checks failing" : "Show code rail"}
          className="workspace-rail-reopen focus-ring"
          onClick={rail.reopen}
        >
          <Icon name="ph:sidebar-simple" width={15} aria-hidden />
          <span className="workspace-rail-reopen__label">Code</span>
          {reopenChecksFailing ? <span className="workspace-rail__badge workspace-rail__badge--alert" aria-hidden /> : null}
        </button>
      )}
      {/* Mobile / narrow code rail: same WorkspaceRail as desktop, but hosted in
          a full-height right-edge slide-over sheet over the full-screen chat
          instead of a third-column Panel. Opened by the toggle button in the
          scope-tabs header; dismissed by backdrop tap, Escape (via useFocusTrap),
          or the rail's own collapse control (which here means "close the
          overlay"). The pin control is hidden — pinning a transient sheet open
          is meaningless. */}
      <WorkspaceRailSheet
        controller={railController}
        familiar={snapshot.familiar}
        sessionId={snapshot.sessionId ?? null}
      />
    </section>
  );
}
