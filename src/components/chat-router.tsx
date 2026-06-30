"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChatList } from "@/components/chat-list";
import { ChatProjectSidebar } from "@/components/chat-project-sidebar";
import { ChatView } from "@/components/chat-view";
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
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { useArchivedFamiliars } from "@/lib/cave-familiar-archive";
import { useProjects } from "@/lib/use-projects";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
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
  | { kind: "chat"; sessionId: string | null; projectRoot?: string; initialPrompt?: string; initialControls?: InitialCommandControls; familiarId?: string | null; origin?: SessionOrigin };

type Props = {
  familiar: Familiar | null;
  familiars?: Familiar[];
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onSetActiveFamiliar?: (id: string) => void;
  onSessionStarted?: () => void;
  onSessionsChanged?: () => void;
  sessionsLoaded?: boolean;
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
  /** Which surface embeds this router ("code" for the Codex coding split).
   *  Forwarded to ChatView so its composer copy/styling can be surface-aware. */
  surface?: string;
};

export type ChatRouterHandle = {
  goToList: () => void;
  newChat: (projectRoot?: string, initialPrompt?: string, familiarId?: string | null, origin?: SessionOrigin, initialControls?: InitialCommandControls) => void;
  openSession: (sessionId: string, findQuery?: string) => void;
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
    onSlashFromChat,
    onOpenOnboarding,
    pendingProjectRoot,
    onOpenTask,
    onOpenUrl,
    syncUrlHash,
    compact = false,
    onOpenProjectsTab,
    surface,
  },
  ref,
) {
  const [view, setView] = useState<View>({ kind: "list" });
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
  // Follows the existing in-app hash idiom (`#card-<id>`, `library:projects`):
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
                initialControls: prev.initialControls,
                familiarId: nextFamiliarId,
                origin: prev.origin,
              }
        : { kind: "list" },
    );
  }, [familiar?.id]);

  useImperativeHandle(
    ref,
    () => ({
      goToList: () => setView({ kind: "list" }),
      newChat: (projectRoot?: string, initialPrompt?: string, familiarId?: string | null, origin?: SessionOrigin, initialControls?: InitialCommandControls) => {
        const next = selectFamiliarForChat(familiarId);
        setView({
          kind: "chat",
          sessionId: null,
          projectRoot,
          initialPrompt,
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
      currentSessionId: () => (view.kind === "chat" ? view.sessionId : null),
      clearTranscript: () => viewHandle.current?.clearTranscript(),
      runSlash: (command: string) => viewHandle.current?.runSlash(command),
    }),
    [fallbackFamiliar, familiar, familiars, onSetActiveFamiliar, sessions, view],
  );

  if (familiars.length === 0 && !familiar) {
    // Empty-state copy is mode-aware: on phones the nav/sidebar/agent panels
    // are drawers behind a toggle, so "from the sidebar selector" / "left
    // panel" reads as broken. Point users at the drawer or the setup CTA
    // instead.
    const heading = isMobile
      ? "Choose a familiar to start chatting"
      : "Choose a familiar from the sidebar selector";
    const subline = pendingProjectRoot
      ? "Selecting one will start this chat in the pending project."
      : isMobile
        ? "Open the menu to pick a familiar, or set one up below."
        : "Pick who should handle the conversation from the left panel.";
    return (
      <section className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-base)] px-6 text-center text-sm text-[var(--text-muted)]">
        <div>
          <p className="text-[15px] font-medium text-[var(--text-secondary)]">
            {heading}
          </p>
          <p className="mt-1 text-[12px]">
            {subline}
          </p>
        </div>
        {onOpenOnboarding ? (
          <button
            onClick={onOpenOnboarding}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
          >
            Open setup
          </button>
        ) : null}
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
        compact={compact}
        onSessionsChanged={onSessionsChanged}
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
      <div className="min-h-0 min-w-0 flex-1">
        {caveChatoutCodex() ? (
          <FamiliarChatoutCodexSurface />
        ) : (
          <ChatView
            ref={viewHandle}
            surface={surface}
            familiar={chatFamiliar}
            sessionId={view.sessionId}
            session={activeSession}
            projectRoot={view.kind === "chat" ? view.projectRoot : undefined}
            initialPrompt={view.kind === "chat" ? view.initialPrompt : undefined}
            initialControls={view.kind === "chat" ? view.initialControls : undefined}
            origin={view.kind === "chat" ? view.origin : undefined}
            openFindQuery={pendingFind?.query}
            openFindNonce={pendingFind?.nonce}
            daemonRunning={daemonRunning}
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
        )}
      </div>
    </div>
  );
});
