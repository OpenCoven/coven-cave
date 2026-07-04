"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { FamiliarsMemoryView } from "@/components/familiars-memory-view";
import { ProjectsView } from "@/components/projects-view";
import { InspectorPane } from "@/components/inspector-pane";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import { DebugPane } from "@/components/debug-pane";
import { SessionChangesPanel } from "@/components/session-changes-panel";
import { WorkspaceRail } from "@/components/workspace-rail";
import { useCodeRail } from "@/lib/use-code-rail";
import { useChatDebugSnapshot } from "@/lib/chat-debug-store";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useIsMobile } from "@/lib/use-viewport";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { CodeInlineToolbar } from "@/components/code-inline-toolbar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar, SessionOrigin, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";
import type { InitialCommandControls } from "@/lib/command-controls";

// ── Layout persistence ─────────────────────────────────────────────────────────

// Persists the chat thread / right-sidebar split width across reloads. Keyed by
// the set of mounted panel ids, so the no-sidebar layout doesn't clobber the
// with-sidebar one. localStorage-backed, fails soft under strict privacy modes.
const CHAT_GROUP_ID = "cave.chat.widths.v1";
// Power mode = the standalone chat transforms its side area into an inline
// chat↔code split (the comux coding surface beside the conversation). Toggle
// state and the split width persist independently of the inspector layout.
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
  onSetActiveFamiliar: (id: string | null) => void;
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
  onOpenUrl?: (url: string) => void;
  /** Which surface embeds this ChatSurface. In "code" mode the chat pane is
   *  transcript-only (the comux pane owns project/file/session navigation), so
   *  the in-chat project sidebar is dropped and the transcript gets a readable
   *  measure. Defaults to the standalone "chat" surface, which keeps the
   *  sidebar + the two-way Chat/Code toggle. */
  surface?: "chat" | "code";
  /** Drop the in-surface project/thread rail even on the standalone "chat"
   *  surface. Set when the left nav has been swapped for the ChatSidebar
   *  (chat mode), which already owns the project-grouped thread list — so the
   *  in-surface rail would duplicate it. Mirrors what `surface="code"` does. */
  hideThreadRail?: boolean;
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
                hideMemory
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
  onOpenUrl,
  surface = "chat",
  hideThreadRail = false,
}: Props) {
  const isCodeSurface = surface === "code";
  // The in-surface project/thread rail is dropped in code mode (comux owns
  // navigation) and in chat mode (the ChatSidebar left nav owns it).
  const compactRail = isCodeSurface || hideThreadRail;
  const [scope, setScope] = useState<FamiliarsScope>("conversation");
  // Below the desktop shell breakpoint the inline 230px right sidebar is hidden
  // (no room beside the chat thread), so the Inspector/Debug/Changes panels would
  // be unreachable. On mobile we render them in a right-edge sheet overlay instead.
  const isMobile = useIsMobile();
  // A drag-to-split pane can be far narrower than the viewport, so the
  // inline-vs-sheet decision also tracks the surface's own measured width —
  // below ~680px the inline sidebar (200px min) would crush the chat thread's
  // 45% minSize. Until the first measurement lands, fall back to the viewport
  // heuristic so SSR and first paint agree with the CSS.
  const surfaceRef = useRef<HTMLElement | null>(null);
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      setPaneWidth((prev) => (prev === width ? prev : width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const paneNarrow = paneWidth === null ? isMobile : paneWidth < 680;
  const consumedPendingActionNonce = useRef<number | null>(null);

  // Right panel — prefer new prop, fall back to legacy bool
  const rightPanel: RightPanelKind | null =
    rightPanelProp !== undefined ? (rightPanelProp ?? null) : inspectorOpen ? "inspector" : null;

  function setRightPanel(next: RightPanelKind | null) {
    if (onSetRightPanel) { onSetRightPanel(next); return; }
    onSetInspectorOpen(next === "inspector");
  }

  // The inspector/debug/changes sidebar shares the chat thread's row on desktop
  // — only when the pane itself is wide enough to host both.
  const showRightSidebar = rightPanel !== null && !isMobile && !paneNarrow;

  // ── Code rail (PR 1) ────────────────────────────────────────────────────────
  // The active session's project_root + running status are the signals the code
  // rail needs. Read them from the reactive chat debug store — the single
  // publisher ChatView already feeds and that the sibling SessionChangesPanel
  // consumes — rather than tracking the `#chat-<id>` URL hash and resolving it
  // against the sessions list. Standalone chat surface only; code mode (comux)
  // owns its own file/changes navigation.
  const snapshot = useChatDebugSnapshot();
  const activeSession = isCodeSurface ? null : snapshot.session;
  const railProjectRoot = activeSession?.project_root ?? null;
  const sessionRunning = activeSession?.status === "running";

  // changeCount = number of pending working-tree files for the active session's
  // project root. Mirrors session-changes-panel's /api/changes fetch (files
  // length), re-polled on the `cave:changes-refresh` edit signal and, while the
  // session is running, a light 5s interval gated on document visibility.
  const [changeCount, setChangeCount] = useState(0);
  const changeFetchInFlight = useRef(false);
  useEffect(() => {
    if (isCodeSurface || !railProjectRoot) { setChangeCount(0); return; }
    const root = railProjectRoot;
    let cancelled = false;
    const load = async () => {
      if (changeFetchInFlight.current) return;
      changeFetchInFlight.current = true;
      try {
        const res = await fetch(`/api/changes?projectRoot=${encodeURIComponent(root)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; files?: unknown[] };
        if (cancelled) return;
        setChangeCount(res.ok && json.ok ? (json.files?.length ?? 0) : 0);
      } catch {
        if (!cancelled) setChangeCount(0);
      } finally {
        changeFetchInFlight.current = false;
      }
    };
    void load();
    const onRefresh = () => { void load(); };
    window.addEventListener("cave:changes-refresh", onRefresh);
    let intervalId: number | undefined;
    if (sessionRunning) {
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") void load();
      }, 5000);
    }
    return () => {
      cancelled = true;
      window.removeEventListener("cave:changes-refresh", onRefresh);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [isCodeSurface, railProjectRoot, sessionRunning]);

  // Once the Terminal tab has been opened, keep the rail available (terminalActive)
  // even if the session has no repo and no edits — otherwise switching away would
  // yank the running pty. Flips false→true once; never resets → no render loop.
  const [terminalOpened, setTerminalOpened] = useState(false);
  const rail = useCodeRail({ projectRoot: railProjectRoot, changeCount, terminalActive: terminalOpened });
  useEffect(() => {
    if (rail.activeTab === "terminal" && rail.open) setTerminalOpened(true);
  }, [rail.activeTab, rail.open]);
  // When the active session changes, stop the rail shell that was started for
  // the previous session and drop the terminal-held-open latch. The rail's pty
  // uses a per-session thread id (`cave.rail.<id>`), and BottomTerminal never
  // stops the shell on unmount (keepalive) — so without this, a session switch
  // strands the old shell (desktop PTYs have no idle reaper; the WS bridge
  // self-reaps) and keeps the rail forced-open on an unrelated session. Mirrors
  // ComuxView.removeSession's desktop teardown.
  const railTermSessionRef = useRef<string | null>(snapshot.sessionId ?? null);
  useEffect(() => {
    const id = snapshot.sessionId ?? null;
    const prev = railTermSessionRef.current;
    railTermSessionRef.current = id;
    if (prev === id) return;
    if (prev && terminalOpened) {
      const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      if (internals) {
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("pty_stop", { threadId: `cave.rail.${prev}` }))
          .catch(() => {});
      }
    }
    setTerminalOpened(false);
  }, [snapshot.sessionId, terminalOpened]);
  const showCodeRail = !isCodeSurface && rail.available && rail.open && !isMobile && !paneNarrow;

  // ── Mobile code rail (PR 3, Task 3) ─────────────────────────────────────────
  // Below the mobile/narrow breakpoint there's no room for the third-column
  // Panel, so the rail is presented as a right-edge slide-over sheet over the
  // full-screen chat, opened by an explicit toggle button. Default closed —
  // auto-opening an overlay on mobile is intrusive, so we do NOT mirror
  // rail.open here.
  const mobileRail = !isCodeSurface && (isMobile || paneNarrow) && rail.available;
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const mobileRailSheetRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(mobileRailOpen, mobileRailSheetRef, {
    onEscape: () => setMobileRailOpen(false),
  });
  // Can't get stuck open: close if there's nothing to show (rail no longer
  // available), when the layout leaves mobile/narrow (the desktop Panel path
  // owns the rail there, so the overlay must not linger behind it), or when the
  // side area switches away from the conversation scope (the toggle is
  // conversation-scoped, so the sheet must not linger over the Projects list).
  useEffect(() => {
    if (!rail.available || (!isMobile && !paneNarrow) || scope !== "conversation")
      setMobileRailOpen(false);
  }, [rail.available, isMobile, paneNarrow, scope]);
  // Reverse of the toggle's forward guard: if the right-panel sheet opens while
  // the code-rail sheet is up, close the rail sheet so two z-[200] aria-modal
  // overlays never coexist on the same edge (mutual exclusivity, both ways).
  useEffect(() => {
    if (rightPanel !== null) setMobileRailOpen(false);
  }, [rightPanel]);

  // Announce code-rail visibility to the shell so it can soft-collapse the left
  // nav to its icon rail while the rail is open (keeps chat centered). Directional
  // event — the shell owns the nav state and decides how to react. Runs on mount
  // too, so a late-mounting shell listener still gets the initial state.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("cave:code-rail-visibility", { detail: { open: showCodeRail } }),
    );
  }, [showCodeRail]);

  // Persist the chat / right-area split. panelIds tracks which panels are
  // actually mounted so the with-sidebar and bare layouts persist separately.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: CHAT_GROUP_ID,
    panelIds: [
      "chat-main",
      ...(showRightSidebar ? ["right-sidebar"] : []),
      ...(showCodeRail ? ["code-rail"] : []),
    ],
    storage: chatStorage,
  });

  const scopedFamiliars = useMemo(() => activeFamiliar ? [activeFamiliar] : familiars, [activeFamiliar, familiars]);
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
    const onShowList = () => {
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.goToList(), 0);
    };
    const onFamiliarSelect = (e: Event) => {
      const d = (e as CustomEvent<{ familiarId?: string | null }>).detail;
      if (!d?.familiarId) return;
      onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.goToList(), 0);
    };
    window.addEventListener("cave:agents-new-chat", onNewChat);
    window.addEventListener("cave:agents-open-session", onOpenSession);
    window.addEventListener("cave:agents-list", onShowList);
    window.addEventListener("cave:familiar-select", onFamiliarSelect);
    return () => {
      window.removeEventListener("cave:agents-new-chat", onNewChat);
      window.removeEventListener("cave:agents-open-session", onOpenSession);
      window.removeEventListener("cave:agents-list", onShowList);
      window.removeEventListener("cave:familiar-select", onFamiliarSelect);
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
      window.setTimeout(() => routerRef.current?.openSession(pendingChatAction.sessionId, findQuery), 0);
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

  useEffect(() => {
    const open = () => setScope("projects");
    window.addEventListener(CHAT_OPEN_PROJECTS_EVENT, open);
    return () => window.removeEventListener(CHAT_OPEN_PROJECTS_EVENT, open);
  }, []);

  // The Code surface hosts the companion-panel toggle inline (CodeInlineToolbar
  // on the tab row), so flag the root to hide the shell's top-bar right toggle
  // while this surface is mounted — otherwise there'd be two of them.
  useEffect(() => {
    if (!isCodeSurface) return;
    const root = document.documentElement;
    root.setAttribute("data-code-inline-toolbar", "");
    return () => root.removeAttribute("data-code-inline-toolbar");
  }, [isCodeSurface]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section ref={surfaceRef} className="chat-surface relative flex h-full min-w-0 bg-[var(--bg-base)]">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Header ──────────────────────────────────────────────────────
            Standalone Chat keeps Projects discoverable as a first-class tab.
            Code keeps its Sessions/Memory pair because the comux pane owns
            project/file navigation there. */}
        {isCodeSurface ? (
          <div className="chat-scope-tabs chat-scope-tabs--minimal flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4">
            <div className="flex min-w-0 items-center gap-3">
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
                  { id: "conversation", label: "Sessions" },
                  { id: "memory", label: "Memory" },
                ]}
              />
            </div>
            <CodeInlineToolbar />
          </div>
        ) : !isCodeSurface ? (
          <div className="chat-scope-tabs chat-scope-tabs--minimal flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4">
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
                { id: "conversation", label: "Sessions" },
                { id: "projects", label: "Projects" },
              ]}
            />
            {/* Mobile / narrow-pane code-rail toggle. On desktop the rail is a
                third column; below the breakpoint there's no room, so it opens
                as a right-edge slide-over sheet (below). Mirrors the mobile
                right-sheet affordance placement. Scoped to the conversation tab
                so it doesn't hover over the Projects list. */}
            {mobileRail && scope === "conversation" && (
              <button
                type="button"
                className="mobile-code-rail-toggle focus-ring"
                aria-label={mobileRailOpen ? "Hide code rail" : "Show code rail"}
                aria-haspopup="dialog"
                aria-expanded={mobileRailOpen}
                onClick={() => {
                  // Mutually exclusive with the right-panel sheet: two z-[200]
                  // aria-modal overlays on the same edge would stack and confuse
                  // AT. Opening the code rail dismisses the other sheet.
                  if (!mobileRailOpen) onSetRightPanel?.(null);
                  setMobileRailOpen((v) => !v);
                }}
              >
                <Icon name="ph:code" width={16} aria-hidden />
                {changeCount > 0 ? (
                  <span className="mobile-code-rail-toggle__badge">{changeCount}</span>
                ) : null}
              </button>
            )}
          </div>
        ) : null}

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
        ) : scope === "projects" && !isCodeSurface ? (
          <ProjectsView sessions={sessions} onNewChat={startProjectChat} onSessionsChanged={onSessionsChanged} activeFamiliarId={activeFamiliarId} />
        ) : (
          <Group
            className="flex min-h-0 min-w-0 flex-1"
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <Panel id="chat-main" className="flex min-h-0 min-w-0" minSize="45%">
              <div className="min-h-0 min-w-0 flex-1" data-surface={surface}>
                <ChatRouter
                  ref={routerRef}
                  surface={surface}
                  familiar={activeFamiliar}
                  familiars={familiars}
                  sessions={sessions}
                  daemonRunning={daemonRunning}
                  sessionsLoaded={sessionsLoaded}
                  compact={compactRail}
                  onSetActiveFamiliar={onSetActiveFamiliar}
                  onSessionStarted={onSessionStarted}
                  onSessionsChanged={onSessionsChanged}
                  onSlashFromChat={onSlashFromChat}
                  onOpenOnboarding={onOpenOnboarding}
                  pendingProjectRoot={pendingProjectRoot}
                  onOpenTask={onOpenTask}
                  onOpenUrl={onOpenUrl}
                  onOpenProjectsTab={() => setScope("projects")}
                  syncUrlHash
                />
              </div>
            </Panel>
            {showRightSidebar && (
              <>
                {/* Defaults to 230px (mirrors the internal left rail, chat-thread-rail
                    is w-[230px]) but is drag-resizable via the handle below, clamped
                    to a sane band so the chat thread keeps its 45% minSize. */}
                <Separator className="shell-separator hidden lg:flex">
                  <SeparatorHandle orientation="col" />
                </Separator>
                <Panel
                  id="right-sidebar"
                  className="hidden min-h-0 min-w-0 lg:flex"
                  defaultSize="230px"
                  minSize="200px"
                  maxSize="480px"
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
                  {/* TODO: reconcile the duplicate Changes UI with RightPanel's SessionChangesPanel in a later PR of this arc */}
                  <WorkspaceRail
                    changeCount={changeCount}
                    activeTab={rail.activeTab}
                    pinned={rail.pinned}
                    projectRoot={railProjectRoot}
                    familiarId={snapshot.familiar?.id ?? null}
                    sessionId={snapshot.sessionId ?? null}
                    onSelectTab={rail.setActiveTab}
                    onTogglePin={rail.togglePin}
                    onCollapse={rail.collapse}
                  />
                </Panel>
              </>
            )}
          </Group>
        )}
      </div>
      {/* Collapsed code rail: a slim reopen strip on the right edge. Shown when
          the rail is available for the active repo session but has been
          collapsed (or auto-hidden between edit batches). Same desktop-only /
          wide-enough gate as the mounted rail. */}
      {!isCodeSurface && rail.available && !rail.open && !isMobile && !paneNarrow && (
        <button
          type="button"
          aria-label="Show code rail"
          className="workspace-rail-reopen"
          onClick={rail.reopen}
        >
          <Icon name="ph:caret-left" width={13} aria-hidden />
        </button>
      )}
      {/* Narrow: the inline 230px right sidebar can't fit beside the chat thread
          (phone viewport OR a narrow drag-to-split pane on a wide screen), so the
          Inspector/Debug/Changes panels open in a right-edge sheet over a
          dismissible scrim. The gate is the exact complement of showRightSidebar
          so only one RightPanel mounts at a time — the InspectorPane won't
          double-fetch or duplicate DOM ids. Scoped to the conversation tab to
          mirror the desktop placement. */}
      {scope === "conversation" && rightPanel !== null && (isMobile || paneNarrow) && (
        <div
          className="chat-right-sheet fixed inset-0 z-[200] flex justify-end"
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
      {/* Mobile / narrow code rail: same WorkspaceRail as desktop, but hosted in
          a full-height right-edge slide-over sheet over the full-screen chat
          instead of a third-column Panel. Opened by the toggle button in the
          scope-tabs header; dismissed by backdrop tap, Escape (via useFocusTrap),
          or the rail's own collapse control (which here means "close the
          overlay"). The pin control is hidden — pinning a transient sheet open
          is meaningless. */}
      {mobileRail && mobileRailOpen && (
        <div
          className="mobile-code-rail-sheet fixed inset-0 z-[200] flex justify-end"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Close code rail"
            className="absolute inset-0 bg-[var(--backdrop-scrim)]"
            onClick={() => setMobileRailOpen(false)}
          />
          <div
            ref={mobileRailSheetRef}
            className="mobile-code-rail-sheet__panel relative flex h-full w-[min(92vw,420px)] flex-col bg-[var(--bg-raised)] shadow-[-8px_0_32px_rgba(0,0,0,0.2)] [padding-bottom:var(--sai-bottom)] [padding-top:var(--sai-top)]"
            role="dialog"
            aria-modal="true"
            aria-label="Code rail"
          >
            <WorkspaceRail
              changeCount={changeCount}
              activeTab={rail.activeTab}
              pinned={rail.pinned}
              projectRoot={railProjectRoot}
              familiarId={snapshot.familiar?.id ?? null}
              sessionId={snapshot.sessionId ?? null}
              hidePin
              onSelectTab={rail.setActiveTab}
              onTogglePin={rail.togglePin}
              onCollapse={() => setMobileRailOpen(false)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
