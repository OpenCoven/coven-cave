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
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useIsMobile } from "@/lib/use-viewport";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";

// ── Layout persistence ─────────────────────────────────────────────────────────

// Persists the chat thread / right-sidebar split width across reloads. Keyed by
// the set of mounted panel ids, so the no-sidebar layout doesn't clobber the
// with-sidebar one. localStorage-backed, fails soft under strict privacy modes.
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
}: Props) {
  const [scope, setScope] = useState<FamiliarsScope>("conversation");
  const [rightExpanded, setRightExpanded] = useState(false);
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

  // Persist the chat / right-sidebar split. panelIds tracks which panels are
  // actually mounted so the with-sidebar and no-sidebar layouts persist separately.
  const showRightSidebar = rightPanel !== null && !isMobile;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: CHAT_GROUP_ID,
    panelIds: showRightSidebar ? ["chat-main", "right-sidebar"] : ["chat-main"],
    storage: chatStorage,
  });

  const scopedFamiliars = useMemo(() => activeFamiliar ? [activeFamiliar] : familiars, [activeFamiliar, familiars]);
  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });

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

  // The expand affordance lives in the shell's floating toggle cluster
  // (.shell-panel-float--expand), a different subtree, so it reaches the expand
  // state through a window event — the same bridge pattern as cave:inspector-open.
  // The reset effect above clears rightExpanded if the panel closes, so this is
  // safe to fire unconditionally.
  useEffect(() => {
    const onExpand = () => setRightExpanded(true);
    window.addEventListener("cave:right-panel-expand", onExpand);
    return () => window.removeEventListener("cave:right-panel-expand", onExpand);
  }, []);

  // Flag right-panel-open on the document root so the shell's floating expand
  // toggle (in shell.tsx, outside this subtree) shows only when there's actually
  // a panel to expand. Mirrors the desktop placement: conversation scope only.
  useEffect(() => {
    const root = document.documentElement;
    const open = rightPanel !== null && !isMobile && scope === "conversation";
    if (open) root.setAttribute("data-right-panel-open", "");
    else root.removeAttribute("data-right-panel-open");
    return () => root.removeAttribute("data-right-panel-open");
  }, [rightPanel, isMobile, scope]);

  // Keep the shell's floating toggles (left nav, expand, side-panel trigger)
  // vertically centered on the LIVE side-panel header. Its top can shift while
  // the layout settles after load (e.g. transient chrome above the panel), so a
  // fixed CSS offset flashes out of alignment. Publish the header's centered top
  // as a root CSS var the floats consume (--shell-float-top), and track it via a
  // short rAF loop that runs only until the value holds steady, plus a resize
  // re-arm. Falls back to the CSS default when there's no panel to align to.
  useEffect(() => {
    if (isMobile || scope !== "conversation" || rightPanel === null || rightExpanded) return;
    const root = document.documentElement;
    const FLOAT_H = 28;
    let raf = 0;
    let steady = 0;
    let last = Number.NaN;
    const measure = () => {
      const header = document.querySelector(".right-panel-tabs");
      if (header) {
        const r = header.getBoundingClientRect();
        const top = Math.round(r.top + (r.height - FLOAT_H) / 2);
        if (top !== last) {
          root.style.setProperty("--shell-float-top", `${top}px`);
          last = top;
          steady = 0;
        } else {
          steady += 1;
        }
      }
    };
    const loop = () => {
      measure();
      // Stop once the measurement holds for ~6 frames — covers the post-load
      // settle without polling forever.
      if (steady < 6) raf = requestAnimationFrame(loop);
    };
    loop();
    const rearm = () => {
      steady = 0;
      last = Number.NaN;
      cancelAnimationFrame(raf);
      loop();
    };
    window.addEventListener("resize", rearm);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", rearm);
      root.style.removeProperty("--shell-float-top");
    };
  }, [isMobile, scope, rightPanel, rightExpanded]);

  // While the right panel is expanded it covers the chat surface, but the
  // shell's right edge-rail float (.shell-panel-float--right, z-40) sits above
  // the overlay's trapped z-index and intercepts clicks on the panel's
  // top-right Close button. Flag the expanded state on the document root so CSS
  // can hide that float while expanded (it's redundant under a full-surface
  // panel anyway). Restore/Esc clear it; the cleanup guards against unmount.
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
            <div className="chat-surface__familiar-scope flex w-[min(220px,34vw)] min-w-0 shrink-0 py-1.5 max-sm:w-[min(168px,42vw)]">
              <FamiliarSwitcher
                familiars={resolvedFamiliars}
                activeFamiliarId={activeFamiliarId}
                sessions={sessions}
                onSelectFamiliar={(id) => {
                  onSetActiveFamiliar(id);
                  setScope("conversation");
                  window.setTimeout(() => routerRef.current?.goToList(), 0);
                }}
                placement="bottom-start"
                labeled
              />
            </div>
            <span aria-hidden className="h-5 w-px shrink-0 bg-[var(--border-hairline)]" />
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
                { id: "conversation", label: "Sessions" },
                { id: "memory", label: "Memory" },
                { id: "projects", label: "Projects" },
              ]}
            />
          </div>

          {/* Actions flush right — chromeless */}
          <div className="flex items-center gap-2 py-1.5">
            <button
              type="button"
              onClick={() => startConversation(activeFamiliarId)}
              title="New session"
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
          <ProjectsView sessions={sessions} onNewChat={startProjectChat} onSessionsChanged={onSessionsChanged} />
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
            {rightPanel !== null && !isMobile && (
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
