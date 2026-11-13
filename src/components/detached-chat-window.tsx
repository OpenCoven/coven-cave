"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import "@/styles/detached-chat-window.css";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { FirstUseProvider } from "@/components/first-use-provider";
import { RightChatPanel, type RightChatPanelController } from "@/components/right-chat-panel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { SearchInput } from "@/components/ui/search-input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { groupChatRowsByActivity } from "@/lib/chat-session-activity";
import {
  CHAT_WINDOW_DRAFT_KEY_PREFIX,
  CHAT_WINDOW_FAMILIAR_KEY,
  CHAT_WINDOW_LIST_COLLAPSED_KEY,
  CHAT_WINDOW_TARGET_EVENT,
  chatWindowActivityLabel,
  chatWindowChatState,
  chatWindowTargetFromEvent,
  focusMainWindow,
  openChatInMainWindow,
  readChatWindowTarget,
  resolveChatWindowFamiliarId,
  summarizeChatWindowActivity,
  type ChatWindowActivity,
} from "@/lib/chat-window";
import { classifyDaemonStatusPoll } from "@/lib/daemon-status-classification";
import { FamiliarStudioProvider } from "@/lib/familiar-studio-context";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { replaceHistoryUrl } from "@/lib/history-url";
import { openSystemBrowserUrl, routeExternalUrlsToSystemBrowser } from "@/lib/open-external";
import { platformizeHint, useKeySymbols } from "@/lib/platform-keys";
import { relativeTime } from "@/lib/relative-time";
import { eligibleRightChatSessions } from "@/lib/right-chat-session";
import { sessionLifecycleLabel } from "@/lib/session-lifecycle";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { WorkspaceSurfacePreferencesProvider } from "@/lib/surface-preferences";
import { useChatSessionList } from "@/lib/use-chat-session-list";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { Familiar, SessionRow } from "@/lib/types";

/**
 * The detached Chat window (`/quick-chat?view=window`): the main window's
 * right Chat panel, popped out into a window of its own.
 *
 * Familiars run down a left rail. Each has its own conversation list and a
 * New chat action, and each familiar visited keeps its own Chat panel mounted
 * behind the others, so a reply goes on streaming while another familiar is in
 * front. The chat itself is the same `RightChatPanel` the main window docks —
 * transcript, streaming, composer and tools are not reimplemented here.
 *
 * Independent of the main window by construction: this window loads its own
 * familiar roster and session lists, keeps its own selection and drafts under
 * its own storage keys, and never reads the workspace's active familiar or
 * chat. A pop-out names where to land once (URL, then a DOM event for a
 * window that is already running); after that nothing the main window does
 * moves this one.
 */
export function DetachedChatWindow() {
  return (
    <WorkspaceSurfacePreferencesProvider>
      <FirstUseProvider>
        <FamiliarStudioProvider redirectToChat>
          <DetachedChatWindowSurface />
        </FamiliarStudioProvider>
      </FirstUseProvider>
    </WorkspaceSurfacePreferencesProvider>
  );
}

/** Below this the conversation list no longer fits beside a usable chat, so
 *  it becomes a drawer over it. Mirrored in detached-chat-window.css. */
const NARROW_QUERY = "(max-width: 759px)";

type FamiliarRoster = {
  familiars: Familiar[];
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** This window's own read of the familiar roster. A failed load keeps the
 *  last good roster (a failure means "can't see them", not "there are none")
 *  and retries quietly until it clears. */
function useFamiliarRoster(): FamiliarRoster {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const response = await fetch("/api/familiars", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const json = (await response.json()) as { ok?: boolean; error?: string; familiars?: Familiar[] };
      if (generation !== generationRef.current) return;
      if (!json.ok) {
        setError(json.error ?? "The Coven daemon is not reachable.");
        return;
      }
      setError(null);
      setFamiliars(json.familiars ?? []);
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setError(cause instanceof Error ? cause.message : "The request failed.");
    } finally {
      if (generation === generationRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  usePausablePoll(reload, 4_000, { enabled: error !== null, serialize: true });
  // A roster changes rarely; a slow refresh picks up a newly summoned familiar.
  usePausablePoll(reload, 60_000, { enabled: error === null, serialize: true });

  return { familiars, loaded, error, reload };
}

/** Whether the daemon is running, for the chat's offline state. Unknown reads
 *  as running: only a confirmed offline answer flips it, so a status hiccup
 *  never paints a healthy chat as offline. */
function useDaemonRunning(): boolean {
  const [running, setRunning] = useState(true);
  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/daemon/connection", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const payload: unknown = await response.json().catch(() => null);
      const result = classifyDaemonStatusPoll({ responseStatus: response.status, responseOk: response.ok, payload });
      if (result.kind === "running") setRunning(true);
      else if (result.kind === "offline") setRunning(false);
    } catch {
      // Unreachable status service: keep the last confirmed answer.
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  usePausablePoll(check, 10_000, { serialize: true });
  return running;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable (private mode, quota): the choice lasts the session.
  }
}

/** Arrow-key movement between the focusable rows of a vertical group. */
function moveRovingFocus(event: KeyboardEvent<HTMLElement>, selector: string): void {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector)).filter(
    (item) => !item.hasAttribute("disabled"),
  );
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next = index;
  if (event.key === "ArrowDown") next = index < 0 ? 0 : Math.min(items.length - 1, index + 1);
  else if (event.key === "ArrowUp") next = index < 0 ? items.length - 1 : Math.max(0, index - 1);
  else if (event.key === "Home") next = 0;
  else next = items.length - 1;
  event.preventDefault();
  items[next]?.focus();
}


function DetachedChatWindowSurface() {
  const keys = useKeySymbols();
  const { announce } = useAnnouncer();
  const roster = useFamiliarRoster();
  const daemonRunning = useDaemonRunning();
  const narrow = useMediaQuery(NARROW_QUERY);
  const listId = useId();

  const resolved = useResolvedFamiliars(roster.familiars);
  const visible = useMemo(() => resolved.filter((familiar) => !familiar.archived), [resolved]);
  const visibleIds = useMemo(() => visible.map((familiar) => familiar.id), [visible]);

  // Where a pop-out asked this window to land. Read once from the URL, then
  // removed from it so a reload restores this window's own last selection
  // rather than replaying a stale pop-out.
  const [landing, setLanding] = useState<{ familiarId: string | null; sessionId: string | null; read: boolean }>({
    familiarId: null,
    sessionId: null,
    read: false,
  });
  useEffect(() => {
    routeExternalUrlsToSystemBrowser();
    const target = readChatWindowTarget(window.location.search);
    // Keep the first read. This effect can run again (React re-runs mount
    // effects in development) after the target has left the URL, and an empty
    // second read must not replace the pop-out's real one.
    setLanding((current) => (current.read ? current : { ...target, read: true }));
    if (target.familiarId || target.sessionId) {
      const url = new URL(window.location.href);
      url.searchParams.delete("familiar");
      url.searchParams.delete("session");
      replaceHistoryUrl(`${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const [activeId, setActiveId] = useState<string | null>(null);
  // Familiars visited this session, in visit order. Each keeps its panel
  // mounted so its conversation, scroll position and any reply in flight
  // survive a switch to another familiar.
  const [mountedIds, setMountedIds] = useState<string[]>([]);
  // The conversation each not-yet-mounted familiar should open on.
  const [initialSessions, setInitialSessions] = useState<Record<string, string>>({});
  const controllersRef = useRef(new Map<string, RightChatPanelController>());
  // The chat each mounted familiar has open (null while composing a new one).
  const [selections, setSelections] = useState<Record<string, string | null>>({});

  const activate = useCallback((familiarId: string, sessionId?: string | null) => {
    if (sessionId) {
      const controller = controllersRef.current.get(familiarId);
      if (controller) controller.openSession(sessionId);
      else setInitialSessions((current) => ({ ...current, [familiarId]: sessionId }));
    }
    setActiveId(familiarId);
    setMountedIds((current) => (current.includes(familiarId) ? current : [...current, familiarId]));
    writeStored(CHAT_WINDOW_FAMILIAR_KEY, familiarId);
  }, []);

  // First selection, and recovery when the active familiar leaves the roster.
  useEffect(() => {
    if (!landing.read || visibleIds.length === 0) return;
    if (activeId && visibleIds.includes(activeId)) return;
    const next = resolveChatWindowFamiliarId(visibleIds, [landing.familiarId, readStored(CHAT_WINDOW_FAMILIAR_KEY)]);
    if (!next) return;
    activate(next, next === landing.familiarId || !landing.familiarId ? landing.sessionId : null);
  }, [activate, activeId, landing, visibleIds]);

  // A later pop-out, for a window that is already running.
  const visibleIdsRef = useRef(visibleIds);
  visibleIdsRef.current = visibleIds;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  useEffect(() => {
    const onTarget = (event: Event) => {
      const target = chatWindowTargetFromEvent(event);
      if (!target) return;
      const familiarId =
        target.familiarId && visibleIdsRef.current.includes(target.familiarId)
          ? target.familiarId
          : target.familiarId
            ? null
            : activeIdRef.current;
      if (familiarId) activate(familiarId, target.sessionId);
    };
    window.addEventListener(CHAT_WINDOW_TARGET_EVENT, onTarget);
    return () => window.removeEventListener(CHAT_WINDOW_TARGET_EVENT, onTarget);
  }, [activate]);

  // One unscoped list feeds every rail badge: which familiars are replying,
  // and which have a chat waiting on the person.
  const everyone = useChatSessionList(null, { enabled: true, intervalMs: 8_000 });
  const activity = useMemo(() => summarizeChatWindowActivity(everyone.sessions), [everyone.sessions]);
  const refreshActivity = everyone.refresh;

  // The conversation list: docked beside the chat when there is room (the
  // choice persists), a drawer over it when there is not.
  const [listCollapsed, setListCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    setListCollapsed(readStored(CHAT_WINDOW_LIST_COLLAPSED_KEY) === "1");
  }, []);
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);
  const listShown = narrow ? drawerOpen : !listCollapsed;
  const listToggleRef = useRef<HTMLButtonElement | null>(null);
  const toggleList = useCallback(() => {
    if (narrow) {
      setDrawerOpen((open) => !open);
      return;
    }
    setListCollapsed((collapsed) => {
      writeStored(CHAT_WINDOW_LIST_COLLAPSED_KEY, collapsed ? "0" : "1");
      return !collapsed;
    });
  }, [narrow]);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    requestAnimationFrame(() => listToggleRef.current?.focus());
  }, []);

  const registerController = useCallback((familiarId: string, controller: RightChatPanelController | null) => {
    if (controller) controllersRef.current.set(familiarId, controller);
    else controllersRef.current.delete(familiarId);
  }, []);
  const reportSelection = useCallback((familiarId: string, sessionId: string | null) => {
    setSelections((current) =>
      familiarId in current && current[familiarId] === sessionId ? current : { ...current, [familiarId]: sessionId },
    );
  }, []);

  const startNewChat = useCallback(() => {
    const familiarId = activeIdRef.current;
    if (!familiarId) return;
    controllersRef.current.get(familiarId)?.newChat();
    setDrawerOpen(false);
  }, []);

  // ⌘/Ctrl+N starts a chat with the familiar in front. This window owns the
  // whole page, so the shortcut cannot collide with another surface.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "n") return;
      event.preventDefault();
      startNewChat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startNewChat]);

  const activeFamiliar = visible.find((familiar) => familiar.id === activeId) ?? null;
  const activeSessionId = activeId ? selections[activeId] ?? null : null;
  useEffect(() => {
    document.title = activeFamiliar ? `${activeFamiliar.display_name} · CovenCave Chat` : "CovenCave Chat";
  }, [activeFamiliar]);

  const openInMain = useCallback(() => {
    if (!activeId || !activeSessionId) return;
    void openChatInMainWindow({ familiarId: activeId, sessionId: activeSessionId });
    announce("Chat opened in the main window");
  }, [activeId, activeSessionId, announce]);

  const listToggleLabel = listShown ? "Hide chat list" : "Show chat list";
  const body = (() => {
    if (!roster.loaded) {
      return (
        <div className="chat-window__state" role="status">
          <SkeletonRows count={4} className="chat-window__state-skeleton" />
          <span className="sr-only">Loading familiars…</span>
        </div>
      );
    }
    if (visible.length === 0 && roster.error) {
      return (
        <div className="chat-window__state">
          <ErrorState
            headline="Couldn't load familiars"
            subtitle={roster.error}
            actions={<Button onClick={() => void roster.reload()}>Retry</Button>}
          />
        </div>
      );
    }
    if (visible.length === 0) {
      return (
        <div className="chat-window__state">
          <EmptyState
            icon="ph:users-three"
            headline="No familiars yet"
            subtitle="Summon a familiar in the main window, then chat with it here."
            actions={<Button onClick={() => void focusMainWindow()}>Open CovenCave</Button>}
          />
        </div>
      );
    }
    return (
      <>
        <FamiliarRail
          familiars={visible}
          activeId={activeId}
          activity={activity}
          onSelect={(familiarId) => activate(familiarId)}
        />
        <div className="chat-window__panes">
          {mountedIds.map((familiarId) => {
            const familiar = roster.familiars.find((entry) => entry.id === familiarId);
            const resolvedFamiliar = visible.find((entry) => entry.id === familiarId);
            if (!familiar || !resolvedFamiliar) return null;
            return (
              <FamiliarChatPane
                key={familiarId}
                familiar={familiar}
                resolvedFamiliar={resolvedFamiliar}
                familiars={roster.familiars}
                familiarsLoaded={roster.loaded}
                familiarsError={roster.error}
                onRetryFamiliars={() => void roster.reload()}
                daemonRunning={daemonRunning}
                active={familiarId === activeId}
                initialSessionId={initialSessions[familiarId] ?? null}
                listId={`${listId}-${familiarId}`}
                listShown={listShown}
                narrow={narrow}
                onCloseDrawer={closeDrawer}
                onRegisterController={registerController}
                onSelection={reportSelection}
                onActivityChanged={refreshActivity}
                newChatHint={platformizeHint("⌘N", keys)}
              />
            );
          })}
        </div>
      </>
    );
  })();

  return (
    <main className="chat-window" data-list={listShown ? "shown" : "hidden"}>
      <h1 className="sr-only">CovenCave Chat</h1>
      {/* The window's own title bar. On macOS the shell opens it with an
          overlay title bar (show_chat_window_from_main), so this strip sits
          under the traffic lights and is the drag region; Tauri's drag.js
          turns a press on its empty chrome into a native window drag, gated
          by capabilities/loopback-window-drag.json. Inert in a browser. */}
      <header className="chat-window__titlebar" data-tauri-drag-region="deep">
        <IconButton
          ref={listToggleRef}
          icon="ph:sidebar-simple"
          size="md"
          aria-label={listToggleLabel}
          aria-expanded={listShown}
          aria-controls={activeId ? `${listId}-${activeId}` : undefined}
          title={listToggleLabel}
          disabled={!activeFamiliar}
          onClick={toggleList}
        />
        <div className="chat-window__identity">
          {activeFamiliar ? (
            <>
              <FamiliarAvatar familiar={activeFamiliar} size="md" />
              <span className="chat-window__identity-name">{activeFamiliar.display_name}</span>
              {activeFamiliar.role ? <span className="chat-window__identity-role">{activeFamiliar.role}</span> : null}
            </>
          ) : (
            <span className="chat-window__identity-name">Chat</span>
          )}
        </div>
        <IconButton
          icon="ph:note-pencil"
          size="md"
          aria-label={activeFamiliar ? `New chat with ${activeFamiliar.display_name}` : "New chat"}
          title={platformizeHint("New chat (⌘N)", keys)}
          disabled={!activeFamiliar}
          onClick={startNewChat}
        />
        <IconButton
          icon="ph:arrows-in-simple"
          size="md"
          aria-label="Open this chat in the main window"
          title={
            activeSessionId
              ? "Open this chat in the main window"
              : "Send a message first to open this chat in the main window"
          }
          disabled={!activeSessionId}
          onClick={openInMain}
        />
      </header>
      <div className="chat-window__body">{body}</div>
    </main>
  );
}

function FamiliarRail({
  familiars,
  activeId,
  activity,
  onSelect,
}: {
  familiars: ResolvedFamiliar[];
  activeId: string | null;
  activity: Map<string, ChatWindowActivity>;
  onSelect: (familiarId: string) => void;
}) {
  return (
    <nav className="chat-window__rail" aria-label="Familiars">
      <div
        className="chat-window__rail-list"
        role="tablist"
        aria-label="Familiars"
        aria-orientation="vertical"
        onKeyDown={(event) => moveRovingFocus(event, '[role="tab"]')}
      >
        {familiars.map((familiar) => {
          const active = familiar.id === activeId;
          const state = activity.get(familiar.id);
          const stateLabel = chatWindowActivityLabel(state);
          const tone = state?.running ? "running" : state?.waiting ? "waiting" : null;
          return (
            <button
              key={familiar.id}
              type="button"
              role="tab"
              id={`chat-window-tab-${familiar.id}`}
              aria-selected={active}
              aria-controls={`chat-window-pane-${familiar.id}`}
              aria-label={stateLabel ? `${familiar.display_name}, ${stateLabel}` : familiar.display_name}
              title={stateLabel ? `${familiar.display_name} · ${stateLabel}` : familiar.display_name}
              // Arrow keys move between familiars; only the selected one is a
              // Tab stop, so the rail costs a keyboard user one stop, not N.
              tabIndex={active || (activeId === null && familiar === familiars[0]) ? 0 : -1}
              className="focus-ring chat-window__familiar"
              style={{ "--chat-window-familiar": familiar.color } as CSSProperties}
              onClick={() => onSelect(familiar.id)}
            >
              <FamiliarAvatar familiar={familiar} size="lg" />
              {tone ? <span className="chat-window__familiar-dot" data-tone={tone} aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function FamiliarChatPane({
  familiar,
  resolvedFamiliar,
  familiars,
  familiarsLoaded,
  familiarsError,
  onRetryFamiliars,
  daemonRunning,
  active,
  initialSessionId,
  listId,
  listShown,
  narrow,
  onCloseDrawer,
  onRegisterController,
  onSelection,
  onActivityChanged,
  newChatHint,
}: {
  familiar: Familiar;
  resolvedFamiliar: ResolvedFamiliar;
  familiars: Familiar[];
  familiarsLoaded: boolean;
  familiarsError: string | null;
  onRetryFamiliars: () => void;
  daemonRunning: boolean;
  active: boolean;
  initialSessionId: string | null;
  listId: string;
  listShown: boolean;
  narrow: boolean;
  onCloseDrawer: () => void;
  onRegisterController: (familiarId: string, controller: RightChatPanelController | null) => void;
  onSelection: (familiarId: string, sessionId: string | null) => void;
  onActivityChanged: () => Promise<void>;
  newChatHint: string;
}) {
  const familiarId = familiar.id;
  // This familiar's own chats. Polled only while it is in front; a pane
  // behind the others still refreshes on its own session events below.
  const chats = useChatSessionList(familiarId, { enabled: active });
  const eligible = useMemo(() => eligibleRightChatSessions(chats.sessions, familiarId), [chats.sessions, familiarId]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const controllerRef = useRef<RightChatPanelController | null>(null);
  const listRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onRegisterController(familiarId, {
      openSession: (sessionId) => controllerRef.current?.openSession(sessionId),
      newChat: () => controllerRef.current?.newChat(),
    });
    return () => onRegisterController(familiarId, null);
  }, [familiarId, onRegisterController]);

  useEffect(() => {
    onSelection(familiarId, selectedSessionId);
  }, [familiarId, onSelection, selectedSessionId]);

  const refreshChats = chats.refresh;
  const refresh = useCallback(() => {
    void refreshChats();
    void onActivityChanged();
  }, [onActivityChanged, refreshChats]);
  const removeChats = chats.removeSessions;
  const handleDeleted = useCallback(
    (sessionIds: readonly string[]) => {
      removeChats(sessionIds);
      refresh();
    },
    [refresh, removeChats],
  );

  const drawer = narrow && listShown && active;
  useFocusTrap(drawer, listRef, { onEscape: onCloseDrawer });

  const pick = (action: () => void) => {
    action();
    if (narrow) onCloseDrawer();
  };

  const filter = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (filter ? eligible.filter((session) => sessionRailTitle(session).toLowerCase().includes(filter)) : eligible),
    [eligible, filter],
  );
  // Recomputed with the list (every poll), which keeps "Today"/"Yesterday"
  // and the relative ages honest without a clock of their own.
  const groups = useMemo(() => groupChatRowsByActivity(filtered, Date.now()), [filtered]);

  return (
    <section
      role="tabpanel"
      id={`chat-window-pane-${familiarId}`}
      aria-labelledby={`chat-window-tab-${familiarId}`}
      hidden={!active}
      className="chat-window__pane"
    >
      {drawer ? <button type="button" className="chat-window__scrim" aria-label="Hide chat list" tabIndex={-1} onClick={onCloseDrawer} /> : null}
      <aside
        ref={listRef}
        id={listId}
        className="chat-window__list"
        aria-label={`Chats with ${resolvedFamiliar.display_name}`}
        // Hidden means out of the tab order and the accessibility tree, not
        // merely off-canvas.
        inert={!listShown}
        aria-hidden={!listShown}
      >
        <div className="chat-window__list-head">
          <h2 className="sr-only">Chats with {resolvedFamiliar.display_name}</h2>
          <Button
            variant="primary"
            size="sm"
            fullWidth
            leadingIcon="ph:plus"
            aria-keyshortcuts="Meta+N Control+N"
            onClick={() => pick(() => controllerRef.current?.newChat())}
          >
            <span>New chat</span>
            <kbd className="chat-window__kbd">{newChatHint}</kbd>
          </Button>
          {eligible.length > 5 ? (
            <SearchInput
              value={query}
              onValueChange={setQuery}
              onClear={() => setQuery("")}
              leadingIcon="ph:funnel"
              placeholder="Filter chats…"
              aria-label={`Filter chats with ${resolvedFamiliar.display_name}`}
            />
          ) : null}
        </div>
        <div className="chat-window__list-scroll" onKeyDown={(event) => moveRovingFocus(event, ".chat-window__chat-row")}>
          {!chats.loaded ? (
            <div role="status">
              <SkeletonRows count={5} />
              <span className="sr-only">Loading chats…</span>
            </div>
          ) : chats.error && eligible.length === 0 ? (
            <ErrorState
              compact
              headline="Couldn't load chats"
              subtitle="Your conversations are still safe."
              actions={<Button size="sm" onClick={() => void refreshChats()}>Retry</Button>}
            />
          ) : (
            <>
              {selectedSessionId === null ? (
                <div className="chat-window__chat-row chat-window__chat-row--draft" aria-current="true">
                  <span className="chat-window__chat-title">New chat</span>
                  <span className="chat-window__chat-meta">Not sent yet</span>
                </div>
              ) : null}
              {eligible.length === 0 ? (
                <p className="chat-window__list-note" role="status">
                  No chats with {resolvedFamiliar.display_name} yet. Send a message to start one.
                </p>
              ) : filtered.length === 0 ? (
                <div className="chat-window__list-note" role="status">
                  <p>No chats match “{query.trim()}”.</p>
                  <Button size="xs" variant="ghost" onClick={() => setQuery("")}>Clear filter</Button>
                </div>
              ) : (
                groups.map((group) => (
                  <section key={group.bucket} className="chat-window__group" aria-label={group.label}>
                    <h3 className="chat-window__group-label">{group.label}</h3>
                    <ul className="chat-window__chats">
                      {group.rows.map((session) => (
                        <ChatRow
                          key={session.id}
                          session={session}
                          selected={session.id === selectedSessionId}
                          onOpen={() => pick(() => controllerRef.current?.openSession(session.id))}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )}
              {chats.error && eligible.length > 0 ? (
                <p className="chat-window__list-note" role="status">
                  Couldn't refresh chats. Showing the last list.
                </p>
              ) : null}
            </>
          )}
        </div>
      </aside>
      <div className="chat-window__chat">
        <RightChatPanel
          open={active}
          familiars={familiars}
          activeFamiliar={familiar}
          sessions={chats.sessions}
          sessionsLoaded={chats.loaded}
          sessionsError={chats.error}
          sessionsScopeFamiliarId={familiarId}
          familiarsLoaded={familiarsLoaded}
          familiarsError={familiarsError}
          daemonRunning={daemonRunning}
          initialSessionId={initialSessionId}
          controllerRef={controllerRef}
          onSelectedSessionChange={setSelectedSessionId}
          composerDraftKeyPrefix={CHAT_WINDOW_DRAFT_KEY_PREFIX}
          // The window draws its own chrome: there is no panel to close, and
          // each pane is bound to its familiar, so the router's requests to
          // change the active familiar stop here instead of moving the window.
          onClose={noop}
          onSetActiveFamiliar={noop}
          onRetryFamiliars={onRetryFamiliars}
          onRetrySessions={() => void refreshChats()}
          onSessionStarted={refresh}
          onSessionsChanged={refresh}
          onSessionsDeleted={handleDeleted}
          // Workspace commands, onboarding and tasks live in the main window.
          onSlashFromChat={unhandledSlash}
          onOpenOnboarding={() => void focusMainWindow()}
          onOpenTask={() => void focusMainWindow()}
          onOpenUrl={(url) => void openSystemBrowserUrl(url, { fallback: noop })}
        />
      </div>
    </section>
  );
}

function noop(): void {}

function unhandledSlash(): boolean {
  return false;
}

function ChatRow({ session, selected, onOpen }: { session: SessionRow; selected: boolean; onOpen: () => void }) {
  const title = sessionRailTitle(session);
  const state = chatWindowChatState(session);
  const age = relativeTime(session.updated_at || session.created_at);
  return (
    <li>
      <button
        type="button"
        className="focus-ring-inset chat-window__chat-row"
        aria-current={selected ? "true" : undefined}
        title={title}
        onClick={onOpen}
      >
        <span className="chat-window__chat-title">{title}</span>
        <span className="chat-window__chat-meta">
          {state ? (
            <>
              <span className="chat-window__dot" data-tone={state} aria-hidden />
              <span className="chat-window__chat-state">{sessionLifecycleLabel(state)}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          {age}
        </span>
      </button>
    </li>
  );
}
