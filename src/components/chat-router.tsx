"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChatList } from "@/components/chat-list";
import { ChatProjectSidebar } from "@/components/chat-project-sidebar";
import { ChatView } from "@/components/chat-view";
import { ChatSplitHost, CHAT_SPLIT_PANE_ATTR, type ChatSplitTile } from "@/components/chat-split-host";
import { NewChatLaunch } from "@/components/new-chat-launch";
import { FamiliarChatoutCodexSurface } from "@/components/familiar-chatout-codex";
import { caveChatoutCodex } from "@/lib/feature-flags";
import { useIsMobile } from "@/lib/use-viewport";
import {
  deriveChatProjectGroups,
  filterVisibleChatSessions,
  normalizeChatProjectRoot,
} from "@/lib/chat-projects";
import { applyProjectOverrides } from "@/lib/chat-project-overrides";
import type { ChatAttachment } from "@/lib/chat-attachments";
import {
  CHAT_SPLIT_PRIMARY,
  CHAT_SPLIT_STORAGE_KEY,
  chatDropZoneLabel,
  chatSplitFocusAfterClose,
  chatSplitFocusTarget,
  chatSplitKeyboardZone,
  dropSessionIntoChatSplit,
  emptyChatSplitLayout,
  hasChatSplit,
  moveChatSplitPane,
  parsePersistedChatSplit,
  pruneChatSplitPanes,
  removeChatSplitPane,
  resolveChatSplitFocus,
  serializeChatSplit,
  type ChatDropZone,
  type ChatSplitSizes,
} from "@/lib/chat-split";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { useAnnouncer } from "@/components/ui/live-region";
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { useArchivedFamiliars } from "@/lib/cave-familiar-archive";
import { useProjects } from "@/lib/use-projects";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import { requestSummonFamiliar } from "@/lib/summon-events";
import {
  normalizeSelection,
  projectSelectionKeys,
  readPersisted,
  PROJECT_SIDEBAR_KEYS,
  selectionKey,
  type ProjectSelection,
} from "@/lib/chat-project-selection";
import type { InitialCommandControls } from "@/lib/command-controls";
import type { Familiar, SessionOrigin, SessionRow } from "@/lib/types";

type View =
  | { kind: "list" }
  | { kind: "chat"; sessionId: string | null; projectRoot?: string; initialPrompt?: string; initialAttachments?: ChatAttachment[]; initialControls?: InitialCommandControls; familiarId?: string | null; origin?: SessionOrigin };

type Props = {
  familiar: Familiar | null;
  familiars?: Familiar[];
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onSetActiveFamiliar?: (id: string) => void;
  onSessionStarted?: () => void;
  onSessionsChanged?: () => void;
  sessionsLoaded?: boolean;
  /** Last session-list load failed — forwarded to ChatList (cave-x6k5). */
  sessionsError?: boolean;
  familiarsLoaded?: boolean;
  /** Last roster-load failure. With an empty roster this swaps the "summon
   *  your first familiar" empty state for a can't-reach + Retry state — the
   *  familiars may exist but be unreadable right now (cave-atzv). */
  familiarsError?: string | null;
  /** Retry a failed roster load. */
  onRetryFamiliars?: () => void;
  onSlashFromChat?: (command: string, args: string) => boolean;
  onOpenOnboarding?: () => void;
  pendingProjectRoot?: string | null;
  /** Route back to the linked board task from the chat header. */
  onOpenTask?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
  /** Mirror the open chat into the URL hash (`#chat-<sessionId>`) so chats are
   *  deep-linkable and browser Back/Forward navigates list ↔ chat. Only the
   *  main chat surface opts in — the companion-rail ChatRouter must not fight
   *  it for the hash. Workspace owns mount-time restore + popstate handling. */
  syncUrlHash?: boolean;
  /** Compact mode for the narrow companion sidepanel (FamiliarPanel). Hides the
   *  project sidebar in both list and chat views to reclaim the limited width. */
  compact?: boolean;
  /** Jump from the in-chat project rail to the dedicated Projects tab. */
  onOpenProjectsTab?: () => void;
  /** Allow split panes (drag/keyboard multi-pane) on this mount. Only the
   *  full-width main chat surface opts in — the compact companion rail has no
   *  room, and two mounts must not fight over the persisted layout. */
  enableSplitPanes?: boolean;
};

export type ChatRouterHandle = {
  goToList: () => void;
  newChat: (projectRoot?: string, initialPrompt?: string, familiarId?: string | null, origin?: SessionOrigin, initialControls?: InitialCommandControls, initialAttachments?: ChatAttachment[]) => void;
  openSession: (sessionId: string, findQuery?: string) => void;
  /** Open a conversation in a split pane beside the current chat; falls back
   *  to a plain open when splits are unavailable (mobile, companion rail). */
  openSessionInSplit: (sessionId: string) => void;
  currentSessionId: () => string | null;
  clearTranscript: () => void;
  runSlash: (command: string) => void;
};


type ChatViewHandle = {
  clearTranscript: () => void;
  runSlash: (command: string) => void;
};

function selectionForProjectRoot(projectRoot: string | null | undefined, groups: ReturnType<typeof deriveChatProjectGroups>): ProjectSelection {
  if (!projectRoot?.trim()) return "all";
  const normalized = normalizeChatProjectRoot(projectRoot);
  const group = groups.find((entry) => entry.projectRoot && normalizeChatProjectRoot(entry.projectRoot) === normalized);
  return group ? selectionKey(group.projectId, group.projectRoot) : "all";
}

export const ChatRouter = forwardRef<ChatRouterHandle, Props>(function ChatRouter(
  {
    familiar,
    familiars = [],
    sessions,
    daemonRunning,
    onSetActiveFamiliar,
    onSessionStarted,
    onSessionsChanged,
    sessionsLoaded,
    sessionsError,
    familiarsLoaded,
    familiarsError,
    onRetryFamiliars,
    onSlashFromChat,
    onOpenOnboarding,
    pendingProjectRoot,
    onOpenTask,
    onOpenUrl,
    syncUrlHash,
    compact = false,
    onOpenProjectsTab,
    enableSplitPanes = false,
  },
  ref,
) {
  const [view, setView] = useState<View>({ kind: "list" });
  // ── Multi-pane split (drag a convo from the thread rail onto the chat) ────
  // The primary chat is one pane; dropped conversations open beside/above/
  // below it. Pure layout rules live in @/lib/chat-split; panes for deleted
  // sessions are filtered at render (the id simply stops resolving).
  const [split, setSplit] = useState(() => emptyChatSplitLayout());
  // Persisted pane sizes (RRP flex weights by pane id). Restored alongside
  // the layout; {} means "even split".
  const [splitSizes, setSplitSizes] = useState<ChatSplitSizes>({});
  // The pane holding logical focus — keyboard target + visible affordance.
  // Reconciled through resolveChatSplitFocus so a closed/promoted pane's
  // focus falls back to the always-present primary.
  const [focusedPane, setFocusedPane] = useState<string | null>(null);
  const splitHydratedRef = useRef(false);
  const { announce } = useAnnouncer();
  // Set when a conversation-search hit asks the opened chat to jump to a query;
  // handed to ChatView (nonce-keyed) so it opens in-thread find on the match.
  const [pendingFind, setPendingFind] = useState<{ query: string; nonce: number } | null>(null);
  const viewHandle = useRef<ChatViewHandle | null>(null);
  const previousFamiliarIdRef = useRef<string | null | undefined>(undefined);
  const openProjectsTab = useCallback(() => {
    if (onOpenProjectsTab) {
      onOpenProjectsTab();
      return;
    }
    window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT));
  }, [onOpenProjectsTab]);
  const sidebarPrefsLoadedRef = useRef(false);
  const sidebarDefaultExpandedRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selection, setSelection] = useState<ProjectSelection>("all");
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
  const isMobile = useIsMobile();
  // Splits belong to the full-width desktop chat: the opted-in main surface
  // only (enableSplitPanes), never mobile, never the Codex surface.
  const enableSplit = enableSplitPanes && !isMobile && !caveChatoutCodex();
  const activeSession = view.kind === "chat" && view.sessionId
    ? sessions.find((s) => s.id === view.sessionId) ?? null
    : null;
  // Archived familiars stay reachable from Familiar Studio Lifecycle so users
  // can unarchive, but they must NOT be the fallback default when the user is
  // starting a new session — silently dropping them into an archived agent is
  // a footgun. The active familiar ("familiar" prop) is left alone here —
  // it's the user's explicit current selection.
  const archivedFamiliars = useArchivedFamiliars();
  const visibleFamiliars = useMemo(
    () => familiars.filter((entry) => !(entry.id in archivedFamiliars)),
    [familiars, archivedFamiliars],
  );
  const fallbackFamiliar = visibleFamiliars[0] ?? null;
  const selectedViewFamiliar = view.kind === "chat" && view.familiarId
    ? familiars.find((entry) => entry.id === view.familiarId) ?? null
    : null;
  const sessionFamiliar = activeSession?.familiarId
    ? familiars.find((entry) => entry.id === activeSession.familiarId) ?? null
    : null;
  const chatFamiliar = selectedViewFamiliar ?? sessionFamiliar ?? familiar ?? null;
  const fallbackFamiliarId = familiar?.id ?? visibleFamiliars[0]?.id ?? null;
  const { projects } = useProjects();
  const projectOverrides = useProjectOverrides();

  const sidebarSessions = useMemo(
    () => filterVisibleChatSessions(sessions, familiar?.id ?? null),
    [familiar?.id, sessions],
  );
  const sidebarGroups = useMemo(
    () => deriveChatProjectGroups(applyProjectOverrides(sidebarSessions, projectOverrides), projects),
    [sidebarSessions, projects, projectOverrides],
  );
  const effectiveSelection = useMemo(
    () => normalizeSelection(isMobile ? "all" : selection, sidebarGroups),
    [isMobile, selection, sidebarGroups],
  );
  const syncSidebarProjectRoot = useCallback((nextProjectRoot: string | null) => {
    const nextSelection = selectionForProjectRoot(nextProjectRoot, sidebarGroups);
    setSelection(nextSelection);
    if (nextSelection !== "all") {
      setExpandedKeys((prev) => (prev.includes(nextSelection) ? prev : [...prev, nextSelection]));
    }
  }, [sidebarGroups]);

  useEffect(() => {
    if (sidebarPrefsLoadedRef.current) return;
    if (sessionsLoaded === false) return;
    sidebarPrefsLoadedRef.current = true;
    setSidebarOpen(readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.open, true) !== false);
    const hasStoredExpanded =
      typeof window !== "undefined" && window.localStorage.getItem(PROJECT_SIDEBAR_KEYS.expanded) !== null;
    sidebarDefaultExpandedRef.current = !hasStoredExpanded;
    const storedExpanded = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.expanded, null);
    setExpandedKeys(
      Array.isArray(storedExpanded)
        ? storedExpanded.filter((k): k is string => typeof k === "string")
        : projectSelectionKeys(sidebarGroups),
    );
    const storedSelection = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.selected, "all");
    setSelection(typeof storedSelection === "string" ? storedSelection : "all");
    setSidebarHydrated(true);
  }, [sessionsLoaded, sidebarGroups]);
  useEffect(() => {
    if (!sidebarHydrated || !sidebarDefaultExpandedRef.current) return;
    setExpandedKeys(projectSelectionKeys(sidebarGroups));
  }, [sidebarHydrated, sidebarGroups]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.open, JSON.stringify(sidebarOpen));
  }, [sidebarHydrated, sidebarOpen]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.expanded, JSON.stringify(expandedKeys));
  }, [sidebarHydrated, expandedKeys]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.selected, JSON.stringify(selection));
  }, [sidebarHydrated, selection]);

  // ── URL hash sync (CHAT-D9-01) ────────────────────────────────────────────
  // Follows the existing in-app hash idiom (`#card-<id>`):
  // an open chat is reflected as `#chat-<sessionId>`, so reloads and shared
  // links can re-enter the thread (workspace.tsx owns mount-time restore and
  // the popstate listener). History semantics: opening a chat *pushes* an
  // entry — browser Back returns to the list; switching chats and session
  // promotion are view changes through this same effect. Returning to the
  // list *replaces* — the hash is cleared without growing the stack, so a
  // direct deep-link entry isn't trapped behind a synthetic entry.
  const hashSyncedOnceRef = useRef(false);
  useEffect(() => {
    if (!syncUrlHash || typeof window === "undefined") return;
    const isFirstRun = !hashSyncedOnceRef.current;
    hashSyncedOnceRef.current = true;
    const hash = window.location.hash;
    if (view.kind === "chat" && view.sessionId) {
      const next = `#chat-${encodeURIComponent(view.sessionId)}`;
      if (hash !== next) window.history.pushState(null, "", next);
      return;
    }
    // Mount always lands on the list view; never clear a deep-link hash here
    // before workspace's restore effect has had a chance to open the session.
    if (isFirstRun) return;
    if (hash.startsWith("#chat-")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [syncUrlHash, view]);

  function selectFamiliarForChat(familiarId?: string | null): Familiar | null {
    const next = familiarId
      ? familiars.find((entry) => entry.id === familiarId) ?? null
      : familiar ?? fallbackFamiliar;
    if (next) onSetActiveFamiliar?.(next.id);
    return next;
  }

  // A conversation opened as the primary chat leaves the split — the same
  // thread twice would stream twice. (Also how "open as main" collapses the
  // promoted pane: promotion just opens it as primary.)
  const primarySessionId = view.kind === "chat" ? view.sessionId : null;
  useEffect(() => {
    if (!primarySessionId) return;
    setSplit((prev) => removeChatSplitPane(prev, primarySessionId));
  }, [primarySessionId]);

  // ── Split persistence (cave-e3dj) ──────────────────────────────────────────
  // The split survives reloads: layout + pane sizes hydrate from localStorage
  // once, then every change writes back. Only the opted-in main chat surface
  // participates — other mounts (companion rail) must not fight it over the
  // same key.
  useEffect(() => {
    if (!enableSplitPanes || splitHydratedRef.current || typeof window === "undefined") return;
    splitHydratedRef.current = true;
    const restored = parsePersistedChatSplit(window.localStorage.getItem(CHAT_SPLIT_STORAGE_KEY));
    if (!restored || !hasChatSplit(restored.layout)) return;
    setSplit(restored.layout);
    setSplitSizes(restored.sizes);
  }, [enableSplitPanes]);
  useEffect(() => {
    if (!enableSplitPanes || !splitHydratedRef.current || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CHAT_SPLIT_STORAGE_KEY, serializeChatSplit(split, splitSizes));
    } catch {
      /* storage full/blocked — the split just won't survive this reload */
    }
  }, [enableSplitPanes, split, splitSizes]);
  // Once the session list is authoritative, drop restored panes whose session
  // was deleted while we were away (render already hides them; this stops the
  // dead ids from persisting forever).
  useEffect(() => {
    if (sessionsLoaded !== true) return;
    setSplit((prev) => pruneChatSplitPanes(prev, (id) => sessions.some((entry) => entry.id === id)));
  }, [sessionsLoaded, sessions]);

  // The pane that actually holds focus, after closes/promotions/deletes.
  const effectiveFocusedPane = resolveChatSplitFocus(split, focusedPane);

  const paneTitle = useCallback(
    (paneId: string): string => {
      if (paneId === CHAT_SPLIT_PRIMARY) return "current chat";
      const session = sessions.find((entry) => entry.id === paneId);
      return session ? sessionRailTitle(session) : "chat";
    },
    [sessions],
  );

  // Land real DOM focus on a pane container (double rAF: pane-set changes
  // remount the RRP group, so the node may not exist until after re-render).
  const focusPaneElement = useCallback((paneId: string) => {
    if (typeof document === "undefined") return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[${CHAT_SPLIT_PANE_ATTR}="${CSS.escape(paneId)}"]`)
          ?.focus({ preventScroll: true });
      }),
    );
  }, []);

  function handleDropSession(sessionId: string, zone: ChatDropZone) {
    if (sessionId === primarySessionId) return; // already the open chat
    if (!sessions.some((entry) => entry.id === sessionId)) return;
    // A session already open in a pane is MOVED to the drop edge (the pure
    // layout dedupes) — header drags land here, so announce them honestly.
    // Dropping a pane back onto its current edge changes nothing: bail before
    // any state churn or a misleading "moved" announcement.
    const repositioning = split.panes.includes(sessionId);
    const next = dropSessionIntoChatSplit(split, sessionId, zone);
    const unchanged =
      next.axis === split.axis &&
      next.panes.length === split.panes.length &&
      next.panes.every((id, index) => id === split.panes[index]);
    if (unchanged) return;
    setSplit(next);
    setFocusedPane(sessionId);
    announce(`${paneTitle(sessionId)} ${repositioning ? `pane moved ${chatDropZoneLabel(zone)}` : "opened in a split pane"}`);
  }

  // Open a thread-rail conversation in a split pane from the keyboard (⌥↵ on
  // the row) — the keyboard twin of drag-to-split. Lands at the end of the
  // strip on the current axis and moves focus into the new pane.
  function handleOpenSessionInSplit(session: SessionRow) {
    if (!enableSplit) return;
    handleDropSession(session.id, chatSplitKeyboardZone(split));
    focusPaneElement(session.id);
  }

  function handleClosePane(paneId: string) {
    const next = removeChatSplitPane(split, paneId);
    if (next === split) return;
    setFocusedPane(chatSplitFocusAfterClose(split, paneId));
    setSplit(next);
    announce(`${paneTitle(paneId)} split pane closed`);
  }

  function handlePromotePane(sessionId: string) {
    const session = sessions.find((entry) => entry.id === sessionId);
    const next = selectFamiliarForChat(session?.familiarId ?? null);
    setView({ kind: "chat", sessionId, familiarId: next?.id ?? session?.familiarId ?? null });
    setFocusedPane(CHAT_SPLIT_PRIMARY);
    announce(`${paneTitle(sessionId)} opened as main chat`);
  }

  // ── Split keyboard control (cave-e3dj) ─────────────────────────────────────
  // ⌥⌘←/↑ and ⌥⌘→/↓ move pane focus along the strip (wrapping), ⌥⌘W closes
  // the focused secondary pane. Composer-safe: ⌥⌘ combos never type text, so
  // the handler runs regardless of where focus sits — but not under a modal,
  // which owns the keyboard while open. Letters match on e.code ("KeyW"):
  // on macOS ⌥ composes e.key into symbols (⌥W → "∑").
  useEffect(() => {
    if (!enableSplit || !hasChatSplit(split)) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.('[aria-modal="true"]')) return;
      const delta =
        e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (-1 as const)
          : e.key === "ArrowRight" || e.key === "ArrowDown"
            ? (1 as const)
            : null;
      if (delta !== null && e.shiftKey) {
        // ⌥⌘⇧←/→ (or ↑/↓): move the focused pane one step along the strip —
        // keyboard parity for dragging a pane by its header.
        const moving = resolveChatSplitFocus(split, focusedPane);
        const next = moveChatSplitPane(split, moving, delta);
        if (next === split) return; // edge — clamped, nothing to announce
        e.preventDefault();
        setSplit(next);
        setFocusedPane(moving);
        focusPaneElement(moving);
        announce(`${paneTitle(moving)} pane moved ${delta === -1 ? "back" : "forward"}`);
        return;
      }
      if (delta !== null) {
        const target = chatSplitFocusTarget(split, focusedPane, delta);
        if (!target) return;
        e.preventDefault();
        setFocusedPane(target);
        focusPaneElement(target);
        announce(`${paneTitle(target)} pane focused`);
        return;
      }
      if (e.code === "KeyW") {
        const closing = resolveChatSplitFocus(split, focusedPane);
        if (closing === CHAT_SPLIT_PRIMARY) return; // primary can't close
        e.preventDefault();
        const nextFocus = chatSplitFocusAfterClose(split, closing);
        handleClosePane(closing);
        focusPaneElement(nextFocus);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const nextFamiliarId = familiar?.id ?? null;
    if (previousFamiliarIdRef.current === undefined) {
      previousFamiliarIdRef.current = nextFamiliarId;
      return;
    }
    if (previousFamiliarIdRef.current === nextFamiliarId) return;
    previousFamiliarIdRef.current = nextFamiliarId;
    setView((prev) =>
      nextFamiliarId === null
        ? { kind: "list" }
        : prev.kind === "chat"
          ? prev.familiarId === nextFamiliarId
            // The router itself activated this familiar while opening a
            // session (openSession/onOpen/newChat) — keep the view, or the
            // reset below would wipe the just-opened sessionId and land the
            // user in an empty new chat instead of the transcript.
            ? prev
            : {
                kind: "chat",
                sessionId: null,
                projectRoot: prev.projectRoot,
                initialPrompt: prev.initialPrompt,
                initialAttachments: prev.initialAttachments,
                initialControls: prev.initialControls,
                familiarId: nextFamiliarId,
                origin: prev.origin,
              }
        : { kind: "list" },
    );
  }, [familiar?.id]);

  // ── Chat-first IA (cave-hsa6): boot into a fresh compose view ──────────────
  // Booting into chat mode should read like ChatGPT — an empty conversation with
  // the composer ready and the thread list in the left sidebar — not the session
  // list/hub. Fire once, from the initial list view, and only when there's no
  // `#chat-<id>` deep link (workspace.tsx restores that session itself). No server
  // session is created: the compose view holds sessionId=null until the first
  // send. Returning to the list later sticks — the ref guards against re-entry.
  // Deliberately independent of the sessions fetch (cave-qvwu): a zero-session
  // compose view needs only a familiar, and /api/sessions/list can take many
  // seconds cold — waiting on it left users staring at the list skeletons. The
  // `#chat-` latch below is synchronous, so deep links are unaffected.
  const bootComposeRef = useRef(false);
  useEffect(() => {
    if (bootComposeRef.current) return;
    if (typeof window !== "undefined") {
      if (window.location.hash.startsWith("#chat-")) {
        bootComposeRef.current = true; // a deep link owns the boot view
        return;
      }
      // Compose-first boot is a desktop affordance. On mobile the thread list is
      // the natural chat home (a messages-app pattern, and the full pane the
      // narrow shell expects) — a new chat stays one tap away. Read matchMedia
      // synchronously so this doesn't race useIsMobile's post-mount flip.
      if (window.matchMedia("(max-width: 1023px)").matches) {
        bootComposeRef.current = true;
        return;
      }
    }
    const bootFamiliarId = familiar?.id ?? fallbackFamiliar?.id ?? null;
    if (!bootFamiliarId) return; // wait until a familiar is available
    bootComposeRef.current = true;
    setView((prev) =>
      prev.kind === "list" ? { kind: "chat", sessionId: null, familiarId: bootFamiliarId } : prev,
    );
  }, [familiar?.id, fallbackFamiliar?.id]);

  useImperativeHandle(
    ref,
    () => ({
      goToList: () => setView({ kind: "list" }),
      newChat: (projectRoot?: string, initialPrompt?: string, familiarId?: string | null, origin?: SessionOrigin, initialControls?: InitialCommandControls, initialAttachments?: ChatAttachment[]) => {
        const next = selectFamiliarForChat(familiarId);
        setView({
          kind: "chat",
          sessionId: null,
          projectRoot,
          initialPrompt,
          initialAttachments,
          initialControls,
          familiarId: next?.id ?? familiarId ?? null,
          origin,
        });
      },
      openSession: (sessionId: string, findQuery?: string) => {
        const session = sessions.find((entry) => entry.id === sessionId);
        const next = selectFamiliarForChat(session?.familiarId ?? null);
        setView({ kind: "chat", sessionId, familiarId: next?.id ?? session?.familiarId ?? null });
        const fq = findQuery?.trim();
        if (fq) setPendingFind({ query: fq, nonce: Date.now() });
      },
      openSessionInSplit: (sessionId: string) => {
        const session = sessions.find((entry) => entry.id === sessionId);
        if (!session) return;
        // Splitting needs an open chat to sit beside; from the list view (or
        // when splits are unavailable) fall back to a plain open.
        if (!enableSplit || view.kind !== "chat") {
          const next = selectFamiliarForChat(session.familiarId ?? null);
          setView({ kind: "chat", sessionId, familiarId: next?.id ?? session.familiarId ?? null });
          return;
        }
        handleOpenSessionInSplit(session);
      },
      currentSessionId: () => (view.kind === "chat" ? view.sessionId : null),
      clearTranscript: () => viewHandle.current?.clearTranscript(),
      runSlash: (command: string) => viewHandle.current?.runSlash(command),
    }),
    [fallbackFamiliar, familiar, familiars, onSetActiveFamiliar, sessions, view, enableSplit, split],
  );

  if (familiars.length === 0 && !familiar) {
    // While the roster fetch is still in flight, hold a quiet frame — the
    // "choose a familiar" copy below is wrong for a loading beat, and
    // skeletons would just be another wall. Loaded-and-empty falls through.
    if (familiarsLoaded === false) {
      return (
        <section
          className="h-full bg-[var(--bg-base)]"
          role="status"
          aria-label="Loading familiars"
        />
      );
    }
    // Roster failed to load: the familiars may exist but be unreadable right
    // now (daemon flap, auth). First-run "summon" copy here would read as
    // "your familiars were deleted" — offer Retry instead (cave-atzv).
    if (familiarsError) {
      return (
        <section className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-base)] px-6 text-center text-sm text-[var(--text-muted)]">
          <div>
            <p className="text-[15px] font-medium text-[var(--text-secondary)]">
              Can&apos;t reach your familiars
            </p>
            <p className="mt-1 text-[12px]">
              {daemonRunning === false
                ? "The daemon is offline, so the roster can't be read. Your familiars are safe."
                : "The roster didn't load. Your familiars are safe — retrying automatically."}
            </p>
          </div>
          {onRetryFamiliars ? (
            <button
              onClick={onRetryFamiliars}
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
            >
              Retry
            </button>
          ) : null}
        </section>
      );
    }
    // Loaded-and-empty: there is nothing to "choose" yet — the first familiar
    // has to be summoned. Lead with the Summoning Circle (the wizard stops at
    // infrastructure and cannot create familiars, cave-3em5); keep setup as
    // the quieter escape hatch for genuinely unconfigured machines.
    const subline = pendingProjectRoot
      ? "Summoning one will let this chat start in the pending project."
      : "A familiar is an AI agent with its own identity and memory. Summon your first to start chatting.";
    return (
      <section className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-base)] px-6 text-center text-sm text-[var(--text-muted)]">
        <div>
          <p className="text-[15px] font-medium text-[var(--text-secondary)]">
            Summon your first familiar
          </p>
          <p className="mt-1 text-[12px]">
            {subline}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => requestSummonFamiliar()}
            className="rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg-base)] hover:opacity-90"
          >
            Summon a familiar
          </button>
          {onOpenOnboarding ? (
            <button
              onClick={onOpenOnboarding}
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
            >
              Open setup
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (view.kind === "list") {
    return (
      <ChatList
        familiar={familiar}
        familiars={familiars}
        sessions={sessions}
        daemonRunning={daemonRunning}
        sessionsLoaded={sessionsLoaded}
        sessionsError={sessionsError}
        compact={compact}
        onSessionsChanged={onSessionsChanged}
        onOpenUrl={onOpenUrl}
        onOpen={(sessionId, familiarId, findQuery) => {
          const next = selectFamiliarForChat(familiarId);
          setView({ kind: "chat", sessionId, familiarId: next?.id ?? familiarId ?? null });
          const fq = findQuery?.trim();
          if (fq) setPendingFind({ query: fq, nonce: Date.now() });
        }}
        onNewChat={(projectRoot, familiarId) => {
          const next = selectFamiliarForChat(familiarId);
          setView({ kind: "chat", sessionId: null, projectRoot, familiarId: next?.id ?? familiarId ?? null });
        }}
      />
    );
  }

  if (!chatFamiliar) {
    return (
      <NewChatLaunch
        familiars={familiars}
        sessions={sessions}
        pendingProjectRoot={pendingProjectRoot}
        onPick={(familiarId) => {
          const next = selectFamiliarForChat(familiarId);
          setView({
            kind: "chat",
            sessionId: null,
            projectRoot: view.kind === "chat" ? view.projectRoot : undefined,
            initialPrompt: view.kind === "chat" ? view.initialPrompt : undefined,
            initialAttachments: view.kind === "chat" ? view.initialAttachments : undefined,
            initialControls: view.kind === "chat" ? view.initialControls : undefined,
            origin: view.kind === "chat" ? view.origin : undefined,
            familiarId: next?.id ?? familiarId,
          });
        }}
        onResume={(sessionId) => {
          const session = sessions.find((entry) => entry.id === sessionId);
          const next = selectFamiliarForChat(session?.familiarId ?? null);
          setView({ kind: "chat", sessionId, familiarId: next?.id ?? session?.familiarId ?? null });
        }}
      />
    );
  }

  const primaryChat = caveChatoutCodex() ? (
    <FamiliarChatoutCodexSurface />
  ) : (
    <ChatView
      ref={viewHandle}
      familiar={chatFamiliar}
      sessionId={view.sessionId}
      session={activeSession}
      projectRoot={view.kind === "chat" ? view.projectRoot : undefined}
      initialPrompt={view.kind === "chat" ? view.initialPrompt : undefined}
      initialAttachments={view.kind === "chat" ? view.initialAttachments : undefined}
      initialControls={view.kind === "chat" ? view.initialControls : undefined}
      origin={view.kind === "chat" ? view.origin : undefined}
      openFindQuery={pendingFind?.query}
      openFindNonce={pendingFind?.nonce}
      daemonRunning={daemonRunning}
      sessions={sessions}
      onSessionsChanged={onSessionsChanged}
      onBack={() => setView({ kind: "list" })}
      onSessionStarted={(sid) => {
        // Only promote the sessionId in the view state when the current chat
        // has no session yet (null). If a session is already set, leave the
        // view alone — updating it would re-mount ChatView and lose the live
        // currentSessionRef, breaking follow-up messages.
        setView((prev) =>
          prev.kind === "chat" && prev.sessionId === null
            ? { kind: "chat", sessionId: sid, projectRoot: prev.projectRoot, familiarId: prev.familiarId }
            : prev,
        );
        onSessionStarted?.();
      }}
      onSlashCommand={onSlashFromChat}
      onOpenOnboarding={onOpenOnboarding}
      onOpenTask={onOpenTask}
      onOpenUrl={onOpenUrl}
      onProjectRootChange={syncSidebarProjectRoot}
    />
  );

  // Split panes only render on the full-width desktop chat (enableSplit,
  // declared with the split state above). Panes whose session vanished
  // (deleted) resolve to nothing here — the layout state simply stops
  // matching and the strip collapses.
  const splitPaneTiles: ChatSplitTile[] = (enableSplit ? split.panes : [CHAT_SPLIT_PRIMARY]).flatMap(
    (paneId): ChatSplitTile[] => {
      if (paneId === CHAT_SPLIT_PRIMARY) {
        return [{ id: paneId, title: "Current chat", content: primaryChat }];
      }
      const paneSession = sessions.find((entry) => entry.id === paneId);
      if (!paneSession) return [];
      const paneFamiliar = familiars.find((entry) => entry.id === paneSession.familiarId) ?? chatFamiliar;
      return [
        {
          id: paneId,
          title: sessionRailTitle(paneSession),
          content: (
            <ChatView
              familiar={paneFamiliar}
              sessionId={paneId}
              session={paneSession}
              daemonRunning={daemonRunning}
              sessions={sessions}
              onSessionsChanged={onSessionsChanged}
              onOpenTask={onOpenTask}
              onOpenUrl={onOpenUrl}
            />
          ),
        },
      ];
    },
  );

  return (
    <div className="flex h-full min-w-0">
      {!compact && (
      <ChatProjectSidebar
        groups={sidebarGroups}
        selection={effectiveSelection}
        expandedKeys={expandedKeys}
        open={sidebarOpen}
        activeSessionId={view.kind === "chat" ? view.sessionId : null}
        onSetOpen={setSidebarOpen}
        onSelect={setSelection}
        onToggleExpanded={(key) => {
          sidebarDefaultExpandedRef.current = false;
          setExpandedKeys((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
          );
        }}
        onOpenSession={(s) => {
          const next = selectFamiliarForChat(s.familiarId);
          setView({ kind: "chat", sessionId: s.id, familiarId: next?.id ?? s.familiarId ?? null });
        }}
        onOpenSessionInSplit={enableSplit ? handleOpenSessionInSplit : undefined}
        onNewChat={(root) => {
          const group = sidebarGroups.find((g) => g.projectRoot === root);
          const nextFamiliarId = group?.defaultFamiliarId ?? fallbackFamiliarId;
          const next = selectFamiliarForChat(nextFamiliarId);
          setView({
            kind: "chat",
            sessionId: null,
            projectRoot: root ?? undefined,
            familiarId: next?.id ?? nextFamiliarId ?? null,
          });
        }}
        onOpenProjectsTab={openProjectsTab}
      />
      )}
      <div className="relative min-h-0 min-w-0 flex-1">
        <ChatSplitHost
          panes={splitPaneTiles}
          axis={split.axis}
          enableDrop={enableSplit}
          onDropSession={handleDropSession}
          onClosePane={handleClosePane}
          onPromotePane={handlePromotePane}
          focusedPaneId={effectiveFocusedPane}
          onFocusPane={setFocusedPane}
          sizes={splitSizes}
          onSizesChange={setSplitSizes}
        />
      </div>
    </div>
  );
});
