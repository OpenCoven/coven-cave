"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { killPtyBridge } from "@/lib/pty-ws-bridge";
import { ProjectsView } from "@/components/projects-view";
import { ChatSettingsView } from "@/components/chat-settings-view";
import { ChatCanvasView } from "@/components/chat-canvas-view";
import { GroupChatView } from "@/components/group-chat-view";
import { ChatFamiliarView } from "@/components/chat-familiar-view";
import { CHAT_OPEN_PROJECTS_EVENT, CHAT_OPEN_COVEN_EVENT, consumeCovenTabPending, consumeProjectsTabPending } from "@/lib/chat-tab-events";
import { WorkspaceRail } from "@/components/workspace-rail";
import { useCodeRail } from "@/lib/use-code-rail";
import { useChatDebugSnapshot } from "@/lib/chat-debug-store";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useIsMobile } from "@/lib/use-viewport";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { Familiar, SessionOrigin, SessionRow } from "@/lib/types";
import type { PendingChatAction } from "@/lib/pending-chat-action";
import type { PendingCodeRailOpen } from "@/lib/pending-code-rail-open";
import type { InitialCommandControls } from "@/lib/command-controls";

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
  onClearPendingProjectRoot: () => void;
  onPendingChatActionHandled: () => void;
  onPendingCodeRailOpenHandled: () => void;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onSessionsChanged?: () => void;
  /** Forwarded to ChatRouter → ChatView so the Task chip in the chat header
   *  routes back to the board with the linked card focused. */
  onOpenTask?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
  /** Drop the in-surface project/thread rail. Set when the left nav has been
   *  swapped for the ChatSidebar (chat mode), which already owns the
   *  project-grouped thread list — so the in-surface rail would duplicate it. */
  hideThreadRail?: boolean;
};

// ── Main view ─────────────────────────────────────────────────────────────────

export function ChatSurface({
  familiars,
  sessions,
  activeFamiliar,
  activeFamiliarId,
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
  onClearPendingProjectRoot,
  onPendingChatActionHandled,
  onPendingCodeRailOpenHandled,
  onSessionStarted,
  onSlashFromChat,
  onOpenOnboarding,
  onSessionsChanged,
  onOpenTask,
  onOpenUrl,
  hideThreadRail = false,
}: Props) {
  // The in-surface project/thread rail is dropped in chat mode (the ChatSidebar
  // left nav owns it).
  const compactRail = hideThreadRail;
  const [scope, setScope] = useState<FamiliarsScope>("conversation");
  // Below the desktop shell breakpoint there's no room for the code rail
  // beside the chat thread, so it opens as a right-edge sheet overlay instead.
  const isMobile = useIsMobile();
  // A drag-to-split pane can be far narrower than the viewport, so the
  // inline-vs-sheet decision also tracks the surface's own measured width —
  // below ~680px the inline code rail would crush the chat thread's
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

  // ── Code rail (PR 1) ────────────────────────────────────────────────────────
  // The active session's project_root + running status are the signals the code
  // rail needs. Read them from the reactive chat debug store — the single
  // publisher ChatView already feeds and that the rail's Changes tab
  // consumes — rather than tracking the `#chat-<id>` URL hash and resolving it
  // against the sessions list.
  const snapshot = useChatDebugSnapshot();
  const activeSession = snapshot.session;
  const railProjectRoot = activeSession?.project_root ?? null;
  const sessionRunning = activeSession?.status === "running";

  // "Browse at root" override (cave-z44): the Projects hub drills into an
  // arbitrary project's files by asking the rail to browse THAT root instead of
  // the active session's. A bounded peek — every rail signal (availability,
  // change count, the Files/Changes tabs) follows the override while it's set,
  // so the rail stays internally coherent, and it clears on session change or a
  // manual collapse (see below) so the rail snaps back to the session.
  const [browseRootOverride, setBrowseRootOverride] = useState<string | null>(null);
  const effectiveRailRoot = browseRootOverride ?? railProjectRoot;

  // changeCount = number of pending working-tree files for the rail's effective
  // project root. Mirrors session-changes-panel's /api/changes fetch (files
  // length), re-polled on the `cave:changes-refresh` edit signal and, while the
  // session is running, a light 5s interval gated on document visibility.
  // null = not yet loaded for this root. The distinction matters (cave-xsq.7):
  // only a genuinely observed 0→N transition auto-reveals the closed-by-default
  // rail, so pre-existing repo dirt arriving with the first load must come in
  // over a null (unknown), not a fake zero.
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const changeCountRootRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveRailRoot) { setChangeCount(null); changeCountRootRef.current = null; return; }
    const root = effectiveRailRoot;
    // On a root switch, drop to unknown while this root's count loads —
    // otherwise the badge lingers on the old project's number. (Only on a real
    // root change, so a sessionRunning toggle on the same root doesn't flash.)
    if (changeCountRootRef.current !== root) {
      setChangeCount(null);
      changeCountRootRef.current = root;
    }
    let cancelled = false;
    // Coalesce the initial load with refresh-event / interval loads for THIS
    // root only. A previous cross-run ref wrongly blocked the new root's first
    // load when the old root's fetch was still in flight, leaving a stale count.
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/changes?projectRoot=${encodeURIComponent(root)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; files?: unknown[] };
        if (cancelled) return;
        // Failures stay `null` (unknown), never a fake zero — a transient
        // error followed by a successful load must not read as a fresh 0→N
        // edit batch and pop the closed-by-default rail open (cave-xsq.7).
        setChangeCount(res.ok && json.ok ? (json.files?.length ?? 0) : null);
      } catch {
        if (!cancelled) setChangeCount(null);
      } finally {
        inFlight = false;
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
  }, [effectiveRailRoot, sessionRunning]);

  // Once the Terminal tab has been opened, keep the rail available (terminalActive)
  // even if the session has no repo and no edits — otherwise switching away would
  // yank the running pty. Flips false→true once; never resets → no render loop.
  const [terminalOpened, setTerminalOpened] = useState(false);
  const rail = useCodeRail({
    projectRoot: effectiveRailRoot,
    changeCount,
    terminalActive: terminalOpened,
    browseActive: browseRootOverride !== null,
  });
  const [codeRailFocus, setCodeRailFocus] = useState<PendingCodeRailOpen | null>(null);
  useEffect(() => {
    if (rail.activeTab === "terminal" && rail.open) setTerminalOpened(true);
  }, [rail.activeTab, rail.open]);
  // When the active session changes, stop the rail shell that was started for
  // the previous session and drop the terminal-held-open latch. The rail's pty
  // uses a per-session thread id (`cave.rail.<id>`), and BottomTerminal never
  // stops the shell on unmount (keepalive) — so without this, a session switch
  // strands the old shell (desktop PTYs have no idle reaper). This is the
  // app's deliberate PTY kill site (cave-c3yt: the retired ComuxView held the
  // original; its sources are deleted).
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
      // WS transport (browser / iOS): the desktop pty_stop above only reaps
      // native-IPC shells. Without the explicit kill frame the old session's
      // shell (and its foreground job) leaks for the full detach grace
      // (~5 min). No-op when no WS bridge is registered for the threadId.
      killPtyBridge(`cave.rail.${prev}`);
    }
    setTerminalOpened(false);
    // Engaging a different session ends any "browse at root" peek — the rail
    // follows the session again (cave-z44).
    setBrowseRootOverride(null);
  }, [snapshot.sessionId, terminalOpened]);
  const showCodeRail = rail.available && rail.open && !isMobile && !paneNarrow;

  // ── Mobile code rail (PR 3, Task 3) ─────────────────────────────────────────
  // Below the mobile/narrow breakpoint there's no room for the third-column
  // Panel, so the rail is presented as a right-edge slide-over sheet over the
  // full-screen chat, opened by an explicit toggle button. Default closed —
  // auto-opening an overlay on mobile is intrusive, so we do NOT mirror
  // rail.open here.
  const mobileRail = (isMobile || paneNarrow) && rail.available;
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

  const openCodeRailTarget = useCallback((target: PendingCodeRailOpen) => {
    setScope("conversation");
    // A "files" target may carry a browse root (Projects hub drill-through);
    // any other open (a session file, a diff) returns the rail to the session.
    setBrowseRootOverride(target.kind === "files" ? (target.root ?? null) : null);
    rail.reopen();
    rail.setActiveTab(target.kind === "changes" ? "changes" : "files");
    setCodeRailFocus(target);
    if (isMobile || paneNarrow) {
      setMobileRailOpen(true);
    }
  }, [isMobile, paneNarrow, rail]);

  useEffect(() => {
    const onOpenProjectFile = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail;
      if (!detail?.path) return;
      openCodeRailTarget({ kind: "files", path: detail.path, line: detail.line, nonce: Date.now() });
    };
    const onOpenFileDiff = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (!detail?.path) return;
      openCodeRailTarget({ kind: "changes", path: detail.path, nonce: Date.now() });
    };
    // Projects hub → "Browse files": drill into a project's tree with no file
    // selected. workspace.tsx bridges this event to chat mode from other
    // surfaces; this listener handles it when the chat surface is already up.
    const onBrowseProjectFiles = (event: Event) => {
      const detail = (event as CustomEvent<{ root?: string }>).detail;
      if (!detail?.root) return;
      openCodeRailTarget({ kind: "files", root: detail.root, nonce: Date.now() });
    };
    window.addEventListener("cave:open-project-file", onOpenProjectFile as EventListener);
    window.addEventListener("cave:open-file-diff", onOpenFileDiff as EventListener);
    window.addEventListener("cave:browse-project-files", onBrowseProjectFiles as EventListener);
    return () => {
      window.removeEventListener("cave:open-project-file", onOpenProjectFile as EventListener);
      window.removeEventListener("cave:open-file-diff", onOpenFileDiff as EventListener);
      window.removeEventListener("cave:browse-project-files", onBrowseProjectFiles as EventListener);
    };
  }, [openCodeRailTarget]);

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
    const onChangesOpen = () => {
      setScope("conversation");
      rail.reopen();
      rail.setActiveTab("changes");
      if (isMobile || paneNarrow) setMobileRailOpen(true);
    };
    window.addEventListener("cave:inspector-open", onInspectorOpen);
    window.addEventListener("cave:changes-open", onChangesOpen);
    return () => {
      window.removeEventListener("cave:inspector-open", onInspectorOpen);
      window.removeEventListener("cave:changes-open", onChangesOpen);
    };
  }, [isMobile, paneNarrow, rail]);

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
          <div className="flex items-center gap-1.5">
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
          <ProjectsView sessions={sessions} familiars={familiars} onNewChat={startProjectChat} onSessionsChanged={onSessionsChanged} activeFamiliarId={activeFamiliarId} />
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
              <ChatFamiliarView familiar={activeFamiliar} daemonRunning={daemonRunning} onStartChat={startFamiliarHeroChat} />
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
                    projectRoot={effectiveRailRoot}
                    familiarId={snapshot.familiar?.id ?? null}
                    sessionId={snapshot.sessionId ?? null}
                    focus={codeRailFocus}
                    onSelectTab={rail.setActiveTab}
                    onTogglePin={rail.togglePin}
                    onCollapse={() => { setBrowseRootOverride(null); rail.collapse(); }}
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
          aria-label="Show code rail"
          title="Show code rail"
          className="workspace-rail-reopen focus-ring"
          onClick={rail.reopen}
        >
          <Icon name="ph:sidebar-simple" width={15} aria-hidden />
          <span className="workspace-rail-reopen__label">Code</span>
        </button>
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
              changeCount={changeCount ?? 0}
              activeTab={rail.activeTab}
              pinned={rail.pinned}
              projectRoot={effectiveRailRoot}
              familiarId={snapshot.familiar?.id ?? null}
              sessionId={snapshot.sessionId ?? null}
              focus={codeRailFocus}
              hidePin
              onSelectTab={rail.setActiveTab}
              onTogglePin={rail.togglePin}
              onCollapse={() => { setBrowseRootOverride(null); setMobileRailOpen(false); }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
