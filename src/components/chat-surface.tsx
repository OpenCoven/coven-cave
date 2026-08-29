"use client";

import "@/styles/cave-chat.css";
import "@/styles/cave-md.css";
import "@/styles/cave-composer.css";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { useSurfaceHistory } from "@/lib/use-surface-history";
import { CHAT_SESSION_LEVEL, registerSurfaceHistoryGate } from "@/lib/surface-history";
import {
  ChatCanvasView,
  ChatFamiliarView,
  GroupChatView,
  ProjectsView,
  WorkspaceRail,
} from "@/components/lazy-surfaces";
import { CHAT_OPEN_PROJECTS_EVENT, CHAT_OPEN_COVEN_EVENT, CHAT_OPEN_CONVERSATION_EVENT, CHAT_OPEN_SKILLS_EVENT, consumeCovenTabPending, consumeProjectsTabPending, consumeSkillsTabPending } from "@/lib/chat-tab-events";
import { requestDebugOpen, useChatDebugSnapshot } from "@/lib/chat-debug-store";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { WorkspaceRailSheet } from "@/components/workspace-rail-sheet";
import { ChatThreadsSheet } from "@/components/chat-threads-sheet";
import { SidebarChatsSection } from "@/components/workspace-sidebar";
import {
  CHAT_RAIL_TOGGLE_EVENT,
  emitChatRailVisibility,
  readChatRailOpen,
  requestChatRailToggle,
  writeChatRailOpen,
} from "@/lib/chat-rail-toggle";
import "@/styles/chat-inner-rail.css";
import { useWorkspaceRailController } from "@/lib/use-workspace-rail-controller";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { FamiliarQuickSwitch } from "@/components/familiar-quick-switch";
import type { Familiar, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";
import { requestSummonFamiliar } from "@/lib/summon-events";
import type { AgentsNewChatRequest } from "@/lib/agents-new-chat";

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
// "canvas" is the gallery of sketches saved from chat artifacts — saves landed
// in the canvas store with no surface after the standalone Canvas page retired.
type FamiliarsScope = "conversation" | "projects" | "coven" | "familiar" | "canvas";

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliar: Familiar | null;
  activeFamiliarId: string | null;
  selectedFamiliarIds: ReadonlySet<string>;
  daemonRunning: boolean;
  localDaemonReady: boolean;
  routerRef: RefObject<ChatRouterHandle | null>;
  sessionsLoaded?: boolean;
  /** Last session-list load failed — chat list shows a can't-load state (cave-x6k5). */
  sessionsError?: boolean;
  familiarsLoaded?: boolean;
  /** Roster-load failure + retry, forwarded to ChatRouter's empty state (cave-atzv). */
  familiarsError?: string | null;
  onRetryFamiliars?: () => void;
  onRequestNewChat?: (request?: AgentsNewChatRequest) => void;
  pendingProjectRoot: string | null;
  pendingChatAction?: PendingChatAction;
  onSetActiveFamiliar: (id: string | null) => void;
  onFamiliarScopeChange: (id: string | null, opts?: { multi?: boolean; preserveSurface?: boolean }) => void;
  onPendingChatActionHandled: () => void;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onSessionsChanged?: () => void;
  onSessionsDeleted: (sessionIds: readonly string[]) => void;
  /** Forwarded to ChatRouter → ChatView so the Task chip in the chat header
   *  routes back to the board with the linked card focused. */
  onOpenTask?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
  onOpenPreview?: (url: string) => void;
  /** Forwarded to ChatRouter: reports the session its chat view is showing so
   *  the Workspace can keep the sidebar highlight in sync as state. */
  onActiveSessionChange?: (sessionId: string | null) => void;
  /** Drop the in-surface project/thread rail. Set when the outer contextual
   *  Shell nav/sidebar already owns the project-grouped chat list, so the
   *  in-surface rail would duplicate it. */
  hideThreadRail?: boolean;
  initialScope?: FamiliarsScope;
  scopeHistoryId?: string;
};

// ── Main view ─────────────────────────────────────────────────────────────────

export function ChatSurface({
  familiars,
  sessions,
  activeFamiliar,
  activeFamiliarId,
  selectedFamiliarIds,
  daemonRunning,
  localDaemonReady,
  routerRef,
  sessionsLoaded,
  sessionsError,
  familiarsLoaded,
  familiarsError,
  onRetryFamiliars,
  onRequestNewChat,
  pendingProjectRoot,
  pendingChatAction,
  onSetActiveFamiliar,
  onFamiliarScopeChange,
  onPendingChatActionHandled,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onSessionsChanged,
  onSessionsDeleted,
  onOpenTask,
  onOpenUrl,
  onOpenPreview,
  onActiveSessionChange,
  hideThreadRail = false,
  initialScope = "conversation",
  scopeHistoryId = "chat:scope",
}: Props) {
  // The rail highlights the open thread. ChatRouter reports it upward already;
  // mirror it locally so the rail can render the active row without ChatSurface
  // reaching into the router for state it is handed anyway.
  const [railActiveSessionId, setRailActiveSessionId] = useState<string | null>(null);

  // Rail collapse. Open is the SSR/first-paint default and the stored
  // preference is applied after mount, so server and client markup match —
  // reading storage during render would mismatch for anyone who collapsed it.
  const [railOpen, setRailOpen] = useState(true);
  // Hydration gate. Without it the persist effect below fires on the first
  // render with the `true` default and overwrites a stored `false` before the
  // read ever happens.
  //
  // ⚠️ It has to be STATE, not a ref. A ref is set during the hydrate effect,
  // and the persist effect runs LATER IN THE SAME COMMIT — where `railOpen` is
  // still the `true` default, because the queued state update has not been
  // applied yet. So the gate reads "hydrated" and immediately writes `true`
  // over the stored `false`. Under StrictMode's mount → unmount → mount that
  // clobber is not merely corrected a render later: the second mount re-reads
  // storage and finds the `true` the first mount just wrote, so the rail comes
  // back OPEN and the collapse is lost. Caught by the reload leg of
  // chat-sidebar-nav.spec.ts.
  //
  // As state, both updates land in one commit and the persist effect first
  // runs on a render where `hydrated` is true AND `railOpen` already holds the
  // stored value — so its first write is a no-op instead of a clobber.
  const [railHydrated, setRailHydrated] = useState(false);
  useEffect(() => {
    setRailOpen(readChatRailOpen());
    setRailHydrated(true);
  }, []);
  // Persist from an EFFECT, not from inside the setState updater. React
  // double-invokes updaters in StrictMode, so a localStorage write in there is
  // an impure side effect that runs twice and can persist the wrong value —
  // measured: collapse, expand, reload came back collapsed.
  useEffect(() => {
    if (!railHydrated) return;
    writeChatRailOpen(railOpen);
  }, [railHydrated, railOpen]);
  useEffect(() => {
    const onToggle = () => setRailOpen((prev) => !prev);
    window.addEventListener(CHAT_RAIL_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(CHAT_RAIL_TOGGLE_EVENT, onToggle);
  }, []);
  // The mobile route to the same list. Deliberately NOT `railOpen`: the rail is
  // a persisted layout preference and this is a transient overlay, so sharing
  // one flag would make dismissing the sheet on a phone collapse the desktop
  // rail on next launch.
  const [threadsSheetOpen, setThreadsSheetOpen] = useState(false);
  const handleActiveSessionChange = useCallback(
    (sessionId: string | null) => {
      setRailActiveSessionId(sessionId);
      onActiveSessionChange?.(sessionId);
    },
    [onActiveSessionChange],
  );

  // The rail deletes one thread and awaits it; ChatSurface's contract upward is
  // the bulk `onSessionsDeleted(ids)` notification. Bridge the two here against
  // the same endpoint the workspace uses rather than widening the rail's props.
  const deleteThreadFromRail = useCallback(
    async (session: SessionRow) => {
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({ ok: false, error: "delete failed" }));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "delete failed");
      onSessionsDeleted([session.id]);
    },
    [onSessionsDeleted],
  );
  // The scope strip is a navigation level, not view state: Back from Canvas
  // should land on Projects, not leave Chat entirely. `select` records an
  // entry (the tab strip itself); `show` lands without one, which is what
  // every cross-surface handoff below wants — those already push an entry on
  // a level the Workspace tracks, so recording a second here would cost the
  // user two Back presses for one action.
  const {
    value: scope,
    select: selectScope,
    show: showScope,
  } = useSurfaceHistory<FamiliarsScope>({
    id: scopeHistoryId,
    initial: initialScope,
  });

  // The rail only exists on the conversation tab; Projects/Canvas/Familiar are
  // full-width surfaces of their own.
  const railAvailable = !hideThreadRail && scope === "conversation";
  // Tell the title-bar button what to render. `available` is what keeps the
  // toggle off surfaces that have no rail, so it must be re-emitted whenever
  // the tab changes — not only when open flips.
  useEffect(() => {
    emitChatRailVisibility({ available: railAvailable, open: railOpen });
  }, [railAvailable, railOpen]);
  // A surface that unmounts (navigating to Home, Tasks, …) must retract the
  // toggle, or it would linger in the title bar controlling nothing.
  useEffect(() => () => emitChatRailVisibility({ available: false, open: false }), []);
  const setScope = showScope;
  // The Workspace traverses its chat-session stack before any registered level.
  // That ordering is right on the Sessions tab, where the session is what the
  // user sees, and wrong everywhere else: from Projects or Familiar the Back
  // press would walk an invisible session trail and leave the strip alone.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(
    () => registerSurfaceHistoryGate(CHAT_SESSION_LEVEL, () => scopeRef.current === "conversation"),
    [],
  );
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
    isMobile,
    paneNarrow,
    showInline: showCodeRail,
    mobileAvailable: mobileRail,
    mobileOpen: mobileRailOpen,
    setMobileOpen: setMobileRailOpen,
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
      const d = (e as CustomEvent<AgentsNewChatRequest>).detail;
      if (onRequestNewChat) {
        setScope("conversation");
        onRequestNewChat(d ?? {});
        return;
      }
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
  }, [onRequestNewChat, onSetActiveFamiliar, routerRef]);

  // The thread rail's advanced-operations launchers reach this surface through
  // window-event bridges (same shape as the cave:agents-* events above).
  // The retired inspector sidepanel's destinations map onto the surviving
  // surfaces: Inspect opens the Familiar chat tab; Git/Changes opens the code
  // rail's Changes tab. (cave:debug-open is owned by ChatView's debug modal.)
  useEffect(() => {
    // Inspect only moves this level, so it records an entry of its own —
    // unlike the handoffs below, which ride a mode or session change.
    const onInspectorOpen = () => selectScope("familiar");
    window.addEventListener("cave:inspector-open", onInspectorOpen);
    return () => {
      window.removeEventListener("cave:inspector-open", onInspectorOpen);
    };
  }, [selectScope]);

  useEffect(() => {
    const open = () => setScope("conversation");
    window.addEventListener(CHAT_OPEN_CONVERSATION_EVENT, open);
    return () => window.removeEventListener(CHAT_OPEN_CONVERSATION_EVENT, open);
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
          pendingChatAction.origin,
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

  function startProjectChat(projectRoot: string) {
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.newChat(projectRoot), 0);
  }

  // Hero "New chat" bridge: land on the conversation tab with a fresh session
  // for this familiar (same latch-then-route shape as the handlers above).
  function startFamiliarHeroChat(familiarId: string) {
    if (onRequestNewChat) {
      onRequestNewChat({ familiarId });
      return;
    }
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

  // Composer "+" menu → "Manage skills" lands on the Familiar scope (Skills
  // section), including from Home where this surface mounts fresh (latch).
  useEffect(() => {
    if (consumeSkillsTabPending()) setScope("familiar");
    // Consume in the live path too: when chat is already mounted the
    // navigate-mode hop doesn't remount this surface, so a latch left set
    // here would hijack a LATER fresh mount onto the Familiar scope.
    const open = () => {
      consumeSkillsTabPending();
      setScope("familiar");
    };
    window.addEventListener(CHAT_OPEN_SKILLS_EVENT, open);
    return () => window.removeEventListener(CHAT_OPEN_SKILLS_EVENT, open);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section ref={surfaceRef} className="chat-surface relative flex h-full min-w-0 bg-[var(--bg-base)]">
      {/* Inner threads rail (cave-fh9so).
          Mounted HERE, at the surface, rather than inside ChatList — ChatList
          only renders for `view.kind === "list"`, so a rail placed there is
          invisible the moment you open a conversation, which is exactly when
          you want to switch threads. At this level it persists beside both the
          list and an open chat, the way the Coding Desk's rail persists beside
          the source.

          It mounts the same rich list the app sidebar used, so nesting costs
          almost nothing: Pinned, Awaiting you, recency buckets, PR badges,
          attention and pin/archive/delete all come along. Search, "Show
          archived" and the Organize menu did not — they were a toolbar on a
          header that is now a single title row, and the list is already
          grouped by attention and recency. */}
      {/* Collapsed: a slim spine that keeps the toggle reachable. The control
          lives INSIDE the rail now, so collapsing it away entirely would leave
          no way to bring it back — the same reason the Coding Desk's review
          rail keeps a spine when closed. */}
      {railAvailable && !railOpen ? (
        <button
          type="button"
          className="chat-inner-rail__spine focus-ring"
          aria-label="Expand chat list"
          aria-expanded={false}
          title="Expand chat list"
          onClick={() => requestChatRailToggle()}
        >
          <Icon name="ph:sidebar-simple" width={15} className="chat-inner-rail__spine-icon" aria-hidden />
          <span className="chat-inner-rail__spine-label" aria-hidden>Sessions</span>
        </button>
      ) : null}
      {railAvailable && railOpen ? (
        <aside className="chat-inner-rail" aria-label="Chat threads">
          <SidebarChatsSection
            sessions={sessions}
            activeFamiliarId={activeFamiliarId}
            activeSessionId={railActiveSessionId}
            onOpenSession={(session: SessionRow) => routerRef.current?.openSession(session.id)}
            onOpenSessionInSplit={(session: SessionRow) => routerRef.current?.openSessionInSplit(session.id)}
            onDeleteSession={deleteThreadFromRail}
            onSessionsChanged={onSessionsChanged}
            onOpenUrl={onOpenUrl}
          />
        </aside>
      ) : null}
      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* ── Header ──────────────────────────────────────────────────────
            Chat keeps Projects discoverable as a first-class tab. The shared
            familiar selector row (cave-3pnnq) sits directly above the section
            tabs so a familiar is established before a scope is chosen. */}
        <div className="chat-familiar-context">
          <FamiliarQuickSwitch
            familiars={resolvedFamiliars}
            activeFamiliarId={activeFamiliarId}
            sessions={sessions}
            onSelectFamiliar={(id) => {
              if (id) onSetActiveFamiliar(id);
            }}
            labeled
            singleRequired
          />
        </div>
        <div className="chat-scope-tabs chat-scope-tabs--minimal flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4">
          {/* Mobile route to the thread list. Rendered on every viewport and
              hidden by CSS above 1024px, where the docked rail and its spine
              take over — one breakpoint, declared in the same stylesheet as
              the rail it stands in for, rather than a second JS media query
              that could drift from it. */}
          {railAvailable && (
            <button
              type="button"
              className="mobile-threads-toggle focus-ring"
              aria-label="Show chat list"
              aria-haspopup="dialog"
              aria-expanded={threadsSheetOpen}
              onClick={() => setThreadsSheetOpen(true)}
            >
              <Icon name="ph:sidebar-simple" width={16} aria-hidden />
            </button>
          )}
          <Tabs<FamiliarsScope>
            bordered={false}
            ariaLabel="Chat sections"
            className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            value={scope}
            onChange={(s) => {
              selectScope(s);
              if (s === "conversation") {
                window.setTimeout(() => routerRef.current?.goToList(), 0);
              }
            }}
            items={[
              { id: "conversation", label: "Sessions" },
              { id: "projects", label: "Projects" },
              { id: "canvas", label: "Canvas" },
              { id: "familiar", label: "Familiar" },
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
              onClick={() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "groupchat" } }))}
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
                localDaemonReady={localDaemonReady}
                onRetryFamiliars={onRetryFamiliars}
                onCreateFamiliar={requestSummonFamiliar}
                onOpenOnboarding={onOpenOnboarding}
                onFamiliarScopeChange={onFamiliarScopeChange}
                onStartChat={startFamiliarHeroChat}
                onRosterChanged={onRetryFamiliars}
              />
            </div>
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
                  activeFamiliarId={activeFamiliarId}
                  sessionsLoaded={sessionsLoaded}
                  sessionsError={sessionsError}
                  familiarsLoaded={familiarsLoaded}
                  familiarsError={familiarsError}
                  onRetryFamiliars={onRetryFamiliars}
                  onRequestNewChat={onRequestNewChat}
                  onSetActiveFamiliar={onSetActiveFamiliar}
                  onSessionsChanged={onSessionsChanged}
                  onSessionsDeleted={onSessionsDeleted}
                  onSlashFromChat={onSlashFromChat}
                  onOpenOnboarding={onOpenOnboarding}
                  pendingProjectRoot={pendingProjectRoot}
                  onOpenTask={onOpenTask}
                  onOpenUrl={onOpenUrl}
                  onOpenPreview={onOpenPreview}
                  onActiveSessionChange={handleActiveSessionChange}
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
                  defaultSize="280px"
                  minSize="220px"
                  maxSize="480px"
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
      {/* Collapsed code rail: a transparent full-height edge target with one
          hover/focus-revealed pull tab. It stays discoverable without leaving
          a labeled chrome column beside the conversation. */}
      {rail.available && !rail.open && !isMobile && !paneNarrow && (
        <button
          type="button"
          aria-label="Show code rail"
          title="Show code rail"
          data-change-count={changeCount ?? "unknown"}
          className="workspace-rail-reopen focus-ring"
          onClick={rail.reopen}
        >
          <span className="workspace-rail-reopen__tab" aria-hidden>
            <Icon name="ph:caret-left" width={10} aria-hidden />
          </span>
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
      {/* Left-edge twin of the sheet above: the thread list, for viewports the
          docked rail does not fit on. */}
      <ChatThreadsSheet
        open={threadsSheetOpen}
        onClose={() => setThreadsSheetOpen(false)}
        sessions={sessions}
        activeFamiliarId={activeFamiliarId}
        activeSessionId={railActiveSessionId}
        onOpenSession={(session: SessionRow) => routerRef.current?.openSession(session.id)}
        onDeleteSession={deleteThreadFromRail}
        onSessionsChanged={onSessionsChanged}
        onOpenUrl={onOpenUrl}
      />
    </section>
  );
}
