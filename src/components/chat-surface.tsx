"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { FamiliarsMemoryView } from "@/components/familiars-memory-view";
import { ProjectsView } from "@/components/projects-view";
import { ComuxView } from "@/components/comux-view";
import { InspectorPane } from "@/components/inspector-pane";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import { DebugPane } from "@/components/debug-pane";
import { SessionChangesPanel } from "@/components/session-changes-panel";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useIsMobile } from "@/lib/use-viewport";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { CodeInlineToolbar } from "@/components/code-inline-toolbar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";

// ── Layout persistence ─────────────────────────────────────────────────────────

// Persists the chat thread / right-sidebar split width across reloads. Keyed by
// the set of mounted panel ids, so the no-sidebar layout doesn't clobber the
// with-sidebar one. localStorage-backed, fails soft under strict privacy modes.
const CHAT_GROUP_ID = "cave.chat.widths.v1";
// Power mode = the standalone chat transforms its side area into an inline
// chat↔code split (the comux coding surface beside the conversation). Toggle
// state and the split width persist independently of the inspector layout.
const POWER_MODE_KEY = "cave:chat-power-mode:v1";
const POWER_GROUP_ID = "cave.chat.power.widths.v1";
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

// The standalone chat's mode switch locks the surface into one of three
// layouts: the conversation alone ("convo"), the Projects browser, or the
// inline chat↔code split ("code"). It folds the old Sessions/Projects scope
// tabs and the binary Power toggle into a single segmented selector. Text-only
// (no icons) so it stays a compact pill — matching the slim GitHub-style filter
// segments elsewhere rather than reading as a chunky toolbar.
type ChatMode = "convo" | "projects" | "code";

const CHAT_MODE_ITEMS: { id: ChatMode; label: string }[] = [
  { id: "convo", label: "Convo" },
  { id: "projects", label: "Projects" },
  { id: "code", label: "Code" },
];

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
   *  the in-chat project sidebar and the duplicate Projects tab are dropped and
   *  the transcript gets a readable measure. Defaults to the standalone
   *  "chat" surface, which keeps the sidebar + all three scope tabs. */
  surface?: "chat" | "code";
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
  expanded = false,
  allowExpand = false,
  onToggleExpand,
}: {
  panel: RightPanelKind;
  activeFamiliar: Familiar | null;
  inboxItems: InboxItem[];
  onSetPanel: (p: RightPanelKind | null) => void;
  onOpenInbox: () => void;
  onCreateReminder: (familiarId: string) => void;
  onOpenInboxItem: (item: InboxItem) => void;
  onInboxItemChanged: () => void | Promise<void>;
  expanded?: boolean;
  allowExpand?: boolean;
  onToggleExpand?: () => void;
}) {
  const primaryPanel: Exclude<RightPanelKind, "changes"> = panel === "debug" ? "debug" : "inspector";

  if (expanded) {
    const active = panel; // "inspector" | "debug" | "changes"
    return (
      <aside
        role="region"
        aria-label="Session panels"
        className="right-panel--expanded relative flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-base)]"
      >
        <div className="right-panel-tabs">
          <button
            type="button"
            className={`right-panel-tab${active === "inspector" ? " right-panel-tab--active" : ""}`}
            onClick={() => onSetPanel("inspector")}
          >
            <Icon name="ph:brain-bold" width={13} />
            Inspector
          </button>
          <button
            type="button"
            className={`right-panel-tab${active === "debug" ? " right-panel-tab--active" : ""}`}
            onClick={() => onSetPanel("debug")}
          >
            <Icon name="ph:bug-bold" width={13} />
            Debug
          </button>
          <button
            type="button"
            className={`right-panel-tab${active === "changes" ? " right-panel-tab--active" : ""}`}
            onClick={() => onSetPanel("changes")}
          >
            <Icon name="ph:git-diff" width={13} />
            Changes
          </button>
          <button
            type="button"
            className="right-panel-close"
            aria-label="Restore panel"
            aria-pressed={true}
            onClick={() => onToggleExpand?.()}
          >
            <Icon name="ph:arrows-in-simple" width={12} />
          </button>
          <button type="button" className="right-panel-close" aria-label="Close panel" onClick={() => onSetPanel(null)}>
            <Icon name="ph:x-bold" width={11} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {active === "inspector" && (
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
          {active === "debug" && <DebugPane />}
          {active === "changes" && <SessionChangesPanel />}
        </div>
      </aside>
    );
  }

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
            {allowExpand ? (
              <button
                type="button"
                className="right-panel-close"
                aria-label="Expand panel"
                aria-pressed={false}
                onClick={() => onToggleExpand?.()}
              >
                <Icon name="ph:arrows-out-simple" width={12} />
              </button>
            ) : null}
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
}: Props) {
  const isCodeSurface = surface === "code";
  const [scope, setScope] = useState<FamiliarsScope>("conversation");
  const [rightExpanded, setRightExpanded] = useState(false);
  // Power mode applies only to the standalone chat surface (the Code workspace
  // already *is* a chat↔code split). Hydrated from localStorage after mount to
  // stay SSR-safe.
  const [powerMode, setPowerMode] = useState(false);
  useEffect(() => {
    if (isCodeSurface) return;
    try {
      setPowerMode(window.localStorage.getItem(POWER_MODE_KEY) === "1");
    } catch {
      /* ignore — strict privacy mode */
    }
  }, [isCodeSurface]);
  function persistPowerMode(next: boolean) {
    setPowerMode(next);
    try {
      window.localStorage.setItem(POWER_MODE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  // Current selection for the standalone chat's three-way mode switch, derived
  // from the existing scope + power-mode state so the rendering below is
  // unchanged. Projects wins (it owns the whole surface); otherwise power mode
  // means "code", and a plain conversation means "convo".
  const chatMode: ChatMode = scope === "projects" ? "projects" : powerMode ? "code" : "convo";
  function selectChatMode(next: ChatMode) {
    if (next === "code") {
      // Keep whatever thread is open; just bring the code split up beside it.
      setScope("conversation");
      persistPowerMode(true);
      return;
    }
    persistPowerMode(false);
    if (next === "projects") {
      setScope("projects");
      return;
    }
    setScope("conversation");
    window.setTimeout(() => routerRef.current?.goToList(), 0);
  }
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

  // Power mode owns the side area when on (standalone, desktop); otherwise the
  // inspector/debug/changes sidebar does. They are mutually exclusive so the
  // chat thread never has to share its row with both.
  const showPowerPanel = powerMode && !isCodeSurface && !isMobile;
  const showRightSidebar = !showPowerPanel && rightPanel !== null && !isMobile;

  // Persist the chat / right-area split. panelIds tracks which panels are
  // actually mounted so the power-split, with-sidebar, and bare layouts persist
  // separately (the power split is much wider than the 230px inspector rail).
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: showPowerPanel ? POWER_GROUP_ID : CHAT_GROUP_ID,
    panelIds: showPowerPanel
      ? ["chat-main", "code-power"]
      : showRightSidebar
        ? ["chat-main", "right-sidebar"]
        : ["chat-main"],
    storage: chatStorage,
  });

  const scopedFamiliars = useMemo(() => activeFamiliar ? [activeFamiliar] : familiars, [activeFamiliar, familiars]);
  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });

  // Window events
  useEffect(() => {
    const onNewChat = (e: Event) => {
      const d = (e as CustomEvent<{ familiarId?: string | null; projectRoot?: string | null; initialPrompt?: string | null }>).detail;
      if (d?.familiarId) onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(() => routerRef.current?.newChat(d?.projectRoot ?? undefined, d?.initialPrompt ?? undefined, d?.familiarId), 0);
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

  useEffect(() => {
    if (rightPanel === null && rightExpanded) setRightExpanded(false);
  }, [rightPanel, rightExpanded]);

  useEffect(() => {
    if (!rightExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRightExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rightExpanded]);

  // The expand affordance lives in the shell's top-bar toggle cluster
  // (.shell-top-toggle--expand), a different subtree, so it reaches the expand
  // state through a window event — the same bridge pattern as cave:inspector-open.
  // The reset effect above clears rightExpanded if the panel closes, so this is
  // safe to fire unconditionally.
  useEffect(() => {
    const onExpand = () => setRightExpanded(true);
    window.addEventListener("cave:right-panel-expand", onExpand);
    return () => window.removeEventListener("cave:right-panel-expand", onExpand);
  }, []);

  // Flag right-panel-open on the document root so the shell's top-bar expand
  // toggle (in shell.tsx, outside this subtree) shows only when there's actually
  // a panel to expand. Mirrors the desktop placement: conversation scope only.
  useEffect(() => {
    const root = document.documentElement;
    const open = rightPanel !== null && !isMobile && scope === "conversation";
    if (open) root.setAttribute("data-right-panel-open", "");
    else root.removeAttribute("data-right-panel-open");
    return () => root.removeAttribute("data-right-panel-open");
  }, [rightPanel, isMobile, scope]);

  // The Code surface hosts the companion-panel toggle inline (CodeInlineToolbar
  // on the tab row), so flag the root to hide the shell's top-bar right toggle
  // while this surface is mounted — otherwise there'd be two of them.
  useEffect(() => {
    if (!isCodeSurface) return;
    const root = document.documentElement;
    root.setAttribute("data-code-inline-toolbar", "");
    return () => root.removeAttribute("data-code-inline-toolbar");
  }, [isCodeSurface]);

  // While the right panel is expanded it covers the chat surface; flag the
  // expanded state on the document root so CSS can hide the top-bar side-panel
  // toggle while expanded (it's redundant under a full-surface panel anyway).
  // Restore/Esc clear it; the cleanup guards against unmount.
  useEffect(() => {
    const root = document.documentElement;
    if (rightExpanded) root.setAttribute("data-right-panel-expanded", "");
    else root.removeAttribute("data-right-panel-expanded");
    return () => root.removeAttribute("data-right-panel-expanded");
  }, [rightExpanded]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section className="chat-surface relative flex h-full min-w-0 bg-[var(--bg-base)]">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Ultra-minimalist header ────────────────────────────────────── */}
        <div className="chat-scope-tabs chat-scope-tabs--minimal flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* The active familiar is selected from the global top menu bar /
                switcher now. In Code mode the comux pane owns project/file
                navigation, so that surface keeps a Sessions + Memory underline
                tab pair flush left. The standalone chat instead drives all three
                of its modes from the segmented switch on the right. */}
            {isCodeSurface ? (
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
            ) : null}
          </div>
          {/* Code workspace: layout presets + companion-panel toggle ride on
              this row so the Code surface needs no separate toolbar row.
              Standalone chat gets the mode switch instead — a segmented selector
              that locks the surface into Convo, Projects, or the inline
              chat↔code split. */}
          {isCodeSurface ? (
            <CodeInlineToolbar />
          ) : (
            <Tabs<ChatMode>
              variant="segment"
              size="sm"
              bordered={false}
              ariaLabel="Chat mode"
              value={chatMode}
              onChange={selectChatMode}
              items={CHAT_MODE_ITEMS}
            />
          )}
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
        ) : scope === "projects" && !isCodeSurface ? (
          <ProjectsView sessions={sessions} onNewChat={startProjectChat} onSessionsChanged={onSessionsChanged} activeFamiliarId={activeFamiliarId} />
        ) : (
          <Group
            className="flex min-h-0 min-w-0 flex-1"
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <Panel id="chat-main" className="flex min-h-0 min-w-0" minSize={showPowerPanel ? "32%" : "45%"}>
              <div className="min-h-0 min-w-0 flex-1" data-surface={surface}>
                <ChatRouter
                  ref={routerRef}
                  familiar={activeFamiliar}
                  familiars={familiars}
                  sessions={sessions}
                  daemonRunning={daemonRunning}
                  sessionsLoaded={sessionsLoaded}
                  compact={isCodeSurface || showPowerPanel}
                  onSetActiveFamiliar={onSetActiveFamiliar}
                  onSessionStarted={onSessionStarted}
                  onSessionsChanged={onSessionsChanged}
                  onSlashFromChat={onSlashFromChat}
                  onOpenOnboarding={onOpenOnboarding}
                  pendingProjectRoot={pendingProjectRoot}
                  onOpenTask={onOpenTask}
                  onOpenUrl={onOpenUrl}
                  syncUrlHash
                />
              </div>
            </Panel>
            {/* Power mode: the side area becomes the comux coding surface — file
                tree + editable preview + terminal — beside the conversation, a
                single resizable split. Same component the Code workspace uses,
                with its own isolated terminal/layout namespace. */}
            {showPowerPanel && (
              <>
                <Separator className="shell-separator hidden lg:flex">
                  <SeparatorHandle orientation="col" />
                </Separator>
                <Panel
                  id="code-power"
                  className="hidden min-h-0 min-w-0 lg:flex"
                  defaultSize="50%"
                  minSize="35%"
                >
                  <div className="chat-power-pane flex min-h-0 min-w-0 flex-1 flex-col">
                    <ComuxView
                      view="projects"
                      active={powerMode}
                      storageNamespace=":chat-power"
                      sessions={sessions}
                      onOpenSession={(sessionId, familiarId) => {
                        if (familiarId) onSetActiveFamiliar(familiarId);
                        window.setTimeout(() => routerRef.current?.openSession(sessionId), 0);
                      }}
                      onNewChat={startProjectChat}
                    />
                  </div>
                </Panel>
              </>
            )}
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
                  {!rightExpanded && (
                    <RightPanel
                      panel={rightPanel}
                      activeFamiliar={activeFamiliar}
                      inboxItems={inboxItems}
                      onSetPanel={setRightPanel}
                      onOpenInbox={onOpenInbox}
                      onCreateReminder={onCreateReminder}
                      onOpenInboxItem={onOpenInboxItem}
                      onInboxItemChanged={onInboxItemChanged}
                      expanded={false}
                    />
                  )}
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
      {scope === "conversation" && rightPanel !== null && rightExpanded && !isMobile && (
        <div className="chat-right-expanded absolute inset-0 z-[60] hidden lg:flex">
          <RightPanel
            panel={rightPanel}
            activeFamiliar={activeFamiliar}
            inboxItems={inboxItems}
            onSetPanel={(p) => {
              if (p === null) {
                setRightPanel(null);
                setRightExpanded(false);
              } else {
                setRightPanel(p);
              }
            }}
            onOpenInbox={onOpenInbox}
            onCreateReminder={onCreateReminder}
            onOpenInboxItem={onOpenInboxItem}
            onInboxItemChanged={onInboxItemChanged}
            allowExpand
            expanded
            onToggleExpand={() => setRightExpanded(false)}
          />
        </div>
      )}
    </section>
  );
}
