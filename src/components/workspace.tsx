"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SidebarMinimal } from "@/components/sidebar-minimal";
import { groupInboxFeed } from "@/lib/inbox-feed";
import { sameSessionList } from "@/lib/session-list-equal";
import { arrayContentEqual } from "@/lib/array-content-equal";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { WorkspaceMode as WorkspaceModeFromDaemon } from "@/lib/workspace-mode";
import { CommandPalette, type PaletteIntent } from "@/components/command-palette";
import { BoardView } from "@/components/board-view";
import { JournalView } from "@/components/journal/journal-view";
import type { CalendarDeadline } from "@/components/calendar-view";
import { OnboardingOverlay } from "@/components/onboarding-overlay";
import { InboxEscalationsView } from "@/components/inbox-escalations-view";
import { NewReminderModal, draftFromSlashArgs } from "@/components/new-reminder-modal";
import { slashSaveParse } from "@/lib/slash-save-parser";
import { InboxToastStack, toastFromItem, type Toast } from "@/components/inbox-toast";
import { MagicTriggers } from "@/components/magic-triggers";
import { FamiliarGlyphPicker } from "@/components/familiar-glyph-picker";
import { Shell, type ShellHandle } from "@/components/shell";
import { MobileBottomTabs } from "@/components/mobile-bottom-tabs";
import { Icon } from "@/lib/icon";
import { FamiliarStudioProvider } from "@/lib/familiar-studio-context";
import { CompanionRail, type CompanionTab } from "@/components/companion-rail";
import { RailInspector } from "@/components/inspector-pane";
import { FamiliarsView } from "@/components/familiars-view";
import { GroupChatView } from "@/components/group-chat-view";
import {
  getFamiliarScope,
  setFamiliarScope,
  getLastSurface,
  setLastSurface,
  getRailOpen,
  setRailOpen,
} from "@/lib/familiar-memory";
import { recordFamiliarUsed } from "@/lib/familiar-quick-switch";
import { toggleFamiliarSelection } from "@/lib/familiar-multiselect";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { ChooserModal, type ChooserOption } from "@/components/ui/chooser-modal";
import { FamiliarPanel } from "@/components/familiar-panel";
import { BrowserPane, type BrowserPaneHandle } from "@/components/browser-pane";
// Heavy, mode-gated surfaces are code-split via @/components/lazy-surfaces so
// their chunks (and deps like @xyflow/react, @uiw/react-codemirror) load on
// first open instead of shipping in the main bundle. See lazy-surfaces.tsx.
import {
  CalendarView,
  ComuxView,
  EvalsView,
  FlowView,
  GitHubView,
} from "@/components/lazy-surfaces";
import { CodeSidebar } from "@/components/code-sidebar";
import { CodeView } from "@/components/code-view";
import { LibraryView } from "@/components/library-view";
import { PluginsView } from "@/components/plugins-view";
import { OpenCovenSubmissionPage } from "@/components/opencoven-submission-page";
import { CHAT_OPEN_PROJECTS_EVENT, CHAT_FOCUS_PROJECT_EVENT } from "@/lib/chat-tab-events";
import { HomeComposer } from "@/components/home-composer";
import { ChatSurface, type RightPanelKind } from "@/components/chat-surface";
import { SalemChatPanel } from "@/components/salem/salem-widget";
import { MobileHandoffModal } from "@/components/mobile-handoff-modal";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
import { nativeNotify } from "@/lib/native-notify";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import {
  buildDailySummaryNotification,
  dailySummaryAutoKey,
  ensureDailySummaryNotification,
} from "@/lib/daily-summary-notifications";
import type { Familiar, SessionRow } from "@/lib/types";
import { normalizeGitHubTasks, type GitHubTask } from "@/lib/github-tasks";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { useShellBanners } from "@/lib/shell-banners";
import { TopBar } from "@/components/top-bar";
import { FamiliarMenuBar } from "@/components/familiar-menu-bar";
import type { PendingChatAction } from "@/lib/pending-chat-action";
import {
  OPEN_IN_APP_BROWSER_EVENT,
  PENDING_IN_APP_BROWSER_URL_KEY,
} from "@/lib/open-external";

type WorkspaceMode = WorkspaceModeFromDaemon;

// CHAT-D13-05 (axe page-has-heading-one): the shell renders no visible page
// title, so the detail pane carries a visually-hidden h1 naming the active
// surface. Labels mirror the sidebar's vocabulary.
const WORKSPACE_MODE_TITLES: Record<WorkspaceMode, string> = {
  agents: "Familiars",
  home: "Home",
  chat: "Familiars",
  groupchat: "Group Chat",
  board: "Tasks",
  calendar: "Automations",
  inbox: "Automations",
  library: "Library",
  browser: "Browser",
  terminal: "Terminal",
  code: "Code",
  github: "GitHub",
  roles: "Roles",
  flow: "Flow",
  evals: "Evals",
  submissions: "Submissions",
  retro: "Evals",
  capabilities: "Capabilities",
  journal: "Journal",
};

// Chat deep links (CHAT-D9-01): `#chat-<sessionId>` re-enters a specific
// thread, same in-app hash idiom as `#card-<id>` and `library:projects`.
// ChatRouter writes the hash (syncUrlHash); Workspace owns restore + popstate.
const CHAT_HASH_PREFIX = "#chat-";
const MOBILE_MODE_STORAGE_KEY = "cave:mobile-mode-enabled";

function readChatHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith(CHAT_HASH_PREFIX)) return null;
  try {
    return decodeURIComponent(hash.slice(CHAT_HASH_PREFIX.length));
  } catch {
    return null;
  }
}

function clearChatHash() {
  if (typeof window === "undefined") return;
  if (!window.location.hash.startsWith(CHAT_HASH_PREFIX)) return;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

// Mode deep links (e.g. `/?mode=evals`): the Evals surface (and the other
// workspace modes) live inside this SPA shell and aren't URL-addressable on
// their own. A `?mode=<WorkspaceMode>` query param lets external links
// (redirects from /retro, dashboard buttons) land directly on a surface.
// Only modes the shell can actually render are honoured — validated against
// WORKSPACE_MODE_TITLES, which is keyed by every WorkspaceMode — so unknown
// values are ignored silently.
function readModeParam(): WorkspaceMode | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("mode");
  if (raw && Object.prototype.hasOwnProperty.call(WORKSPACE_MODE_TITLES, raw)) {
    return raw as WorkspaceMode;
  }
  return null;
}

function clearModeParam() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("mode")) return;
  params.delete("mode");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname + (query ? `?${query}` : "") + window.location.hash,
  );
}

function readMobileModeEnabled() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MOBILE_MODE_STORAGE_KEY) !== "false";
}

function writeMobileModeEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MOBILE_MODE_STORAGE_KEY, enabled ? "true" : "false");
}

function taskCanAnnotateSession(task: GitHubTask): boolean {
  return Boolean(task.sessionId && (task.prNumber != null || task.prUrl));
}

function attachGitHubTaskContext(sessions: SessionRow[], data: unknown): SessionRow[] {
  const taskBySessionId = new Map<string, GitHubTask>();
  for (const task of normalizeGitHubTasks(data)) {
    if (!taskCanAnnotateSession(task) || !task.sessionId) continue;
    if (!taskBySessionId.has(task.sessionId)) taskBySessionId.set(task.sessionId, task);
  }
  if (taskBySessionId.size === 0) return sessions;

  return sessions.map((session) => {
    const task = taskBySessionId.get(session.id);
    if (!task) return session;
    return {
      ...session,
      git: task.branch
        ? { ...(session.git ?? {}), branch: task.branch }
        : session.git,
      pullRequest: {
        repo: task.repo,
        number: task.prNumber,
        url: task.prUrl,
        state: task.status,
        branch: task.branch,
      },
    };
  });
}

export function Workspace() {
  const nextRouter = useRouter();
  const routerRef = useRef<ChatRouterHandle | null>(null);
  const shellRef = useRef<ShellHandle | null>(null);
  // Multiselect familiar scope. Empty set = "All familiars". `activeId` is the
  // derived single "primary" — the lone scoped id, or null when 0 or ≥2 are
  // selected — so all the existing single-familiar chrome/per-familiar state
  // behaves exactly as before at 0–1 selections; ≥2 is the new filter case.
  const [scopeIds, setScopeIds] = useState<Set<string>>(() => new Set());
  const activeId = scopeIds.size === 1 ? [...scopeIds][0]! : null;
  // Back-compat shim for the call sites that scope to a single familiar (e.g.
  // opening a session) or clear to All: writes the multiselect set accordingly.
  const setActiveId = useCallback((id: string | null) => {
    setScopeIds(id == null ? new Set<string>() : new Set([id]));
  }, []);
  const [activeFamiliarHydrated, setActiveFamiliarHydrated] = useState(false);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const [familiarsError, setFamiliarsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  // false until the first /api/sessions/list fetch settles — lets the chat
  // list show a skeleton instead of flashing its empty state on boot.
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const loadSessionsInFlightRef = useRef<Promise<void> | null>(null);
  const [daemonRunning, setDaemonRunning] = useState<boolean>(false);
  const { pushBanner, dismissBanner } = useShellBanners();
  const [responseNeeded, setResponseNeeded] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [topSearchQuery, setTopSearchQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("home");
  const [lastNonCodeMode, setLastNonCodeMode] = useState<WorkspaceMode>("home");
  // Whether the first daemon status poll has resolved. Until it has, the daemon
  // state is *unknown* (not "offline"), so the offline banner must stay hidden.
  const [daemonStatusResolved, setDaemonStatusResolved] = useState(false);
  // Sticky offline signal for the banner. A crash-looping / codesigning-zombie
  // daemon flaps: it briefly answers health (running:true) then dies again. The
  // banner keys off this instead of the raw per-poll status so a single transient
  // "running" doesn't flicker it away — it shows on the first failed poll and
  // only clears after the daemon is *consistently* healthy (see the streak ref).
  const [daemonOffline, setDaemonOffline] = useState(false);
  const daemonHealthyStreakRef = useRef(0);
  const browserPaneRef = useRef<BrowserPaneHandle>(null);
  const companionBrowserPaneRef = useRef<BrowserPaneHandle>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanelKind | null>(null);
  const [codeRightView, setCodeRightView] = useState<"files" | "changes">("files");
  const [railTab, setRailTab] = useState<CompanionTab>(() => {
    if (typeof window === "undefined") return "chat";
    const stored = window.localStorage.getItem("cave:rail.tab");
    // The standalone "inspector" (magnifier) tab folded into "memory" (brain);
    // remap any persisted value so a stale key doesn't select a removed tab.
    if (stored === "inspector") return "memory";
    return (stored as CompanionTab) ?? "chat";
  });
  const [familiarPanelOpen, setFamiliarPanelOpen] = useState(false);
  // YouTube ("Video") toggle state, lifted out of the companion rail so the
  // shell can keep the right panel peeking as a rotated video strip when the
  // user collapses it instead of vanishing (and stopping playback).
  const [railVideoActive, setRailVideoActive] = useState(false);
  const [pendingProjectChatRoot, setPendingProjectChatRoot] = useState<string | null>(null);
  const [pendingChatAction, setPendingChatAction] = useState<PendingChatAction>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [escalationsUnresolved, setEscalationsUnresolved] = useState(0);
  const [githubAssignedCount, setGithubAssignedCount] = useState(0);
  // Open (not-done) board cards, kept with their familiar so the Tasks badge can
  // show a per-familiar count when a familiar is scoped, and the grand total
  // only when "All familiars" is selected.
  const [openTaskCards, setOpenTaskCards] = useState<{ familiarId: string | null }[]>([]);
  // Board cards carrying an endDate, surfaced as read-only deadline markers on the calendar.
  const [boardDeadlines, setBoardDeadlines] = useState<CalendarDeadline[]>([]);
  const [enrichingTasks, setEnrichingTasks] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [inboxPrefs, setInboxPrefs] = useState<InboxPrefs>({
    version: 1,
    mutedFamiliars: [],
    sound: { mode: "default" },
  });
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [reminderModalDefaults, setReminderModalDefaults] = useState<{
    fireAt: string;
    title: string;
    whenText: string;
  }>({ fireAt: "", title: "", whenText: "" });
  const [editingReminder, setEditingReminder] = useState<InboxItem | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [glyphPickerFor, setGlyphPickerFor] = useState<Familiar | null>(null);
  const [addChooserOpen, setAddChooserOpen] = useState(false);
  const [mobileHandoffOpen, setMobileHandoffOpen] = useState(false);
  const [mobileModeEnabled, setMobileModeEnabledState] = useState(readMobileModeEnabled);
  const [mobileModeHost, setMobileModeHost] = useState<string | null>(null);
  const [mobileModeError, setMobileModeError] = useState<string | null>(null);
  const [addons, setAddons] = useState<{
    github?: boolean;
    library?: boolean;
    code?: boolean;
    terminal?: boolean;
    browser?: boolean;
    flow?: boolean;
    roles?: boolean;
    groupchat?: boolean;
    journal?: boolean;
    retro?: boolean;
  }>({});
  const responseNeededRef = useRef(responseNeeded);
  responseNeededRef.current = responseNeeded;
  // Deep-link target captured at mount, held until the async sessions fetch
  // settles (loadSessions → sessionsLoaded) so the restore can resolve it.
  const pendingChatDeepLinkRef = useRef<string | null>(readChatHash());
  // Refs for the popstate listener — sessions repoll every 4s and mode flips
  // often; the listener should not resubscribe on either.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const dailySummaryRequestedRef = useRef<string | null>(null);
  const sessionsLoadedRef = useRef(sessionsLoaded);
  sessionsLoadedRef.current = sessionsLoaded;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    if (mode !== "code") setLastNonCodeMode(mode);
  }, [mode]);

  const exitCodeMode = useCallback(() => {
    setMode(lastNonCodeMode === "code" ? "home" : lastNonCodeMode);
    shellRef.current?.dismissNavMobile();
  }, [lastNonCodeMode]);

  const setMobileModeEnabled = useCallback((enabled: boolean) => {
    writeMobileModeEnabled(enabled);
    setMobileModeEnabledState(enabled);
  }, []);

  const reconcileMobileMode = useCallback(async (enabled: boolean) => {
    try {
      const body = enabled
        ? { action: "app-start" }
        : { action: "app-stop" };
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        nativeHost?: string | null;
        error?: string;
        stderr?: string;
      };
      if (!json.ok) {
        setMobileModeError(json.stderr || json.error || "Mobile mode unavailable.");
        if (!enabled) setMobileModeHost(null);
        return;
      }
      setMobileModeError(null);
      setMobileModeHost(enabled ? json.nativeHost ?? null : null);
    } catch (err) {
      setMobileModeError(err instanceof Error ? err.message : "Mobile mode unavailable.");
    }
  }, []);

  useEffect(() => {
    void reconcileMobileMode(mobileModeEnabled);
  }, [mobileModeEnabled, reconcileMobileMode]);
  // Recurring reconcile only while mobile mode is on; usePausablePoll pauses it
  // in a hidden tab and refreshes on return.
  usePausablePoll(() => void reconcileMobileMode(mobileModeEnabled), 60_000, {
    enabled: mobileModeEnabled,
  });

  const refreshDaemonStatus = useCallback(async (opts?: { trusted?: boolean }) => {
    let running = false;
    try {
      const res = await fetch("/api/daemon/status", { cache: "no-store" });
      const json = (await res.json()) as { running?: boolean };
      running = json.running === true;
      setDaemonRunning(running);
    } catch {
      setDaemonRunning(false);
    } finally {
      // Drive the sticky offline signal: any failed poll marks the daemon
      // offline immediately, but a background poll takes two *consecutive*
      // healthy polls to clear — otherwise a flapping zombie daemon keeps
      // dismissing the banner.
      if (running) {
        daemonHealthyStreakRef.current += 1;
        // A `trusted` refresh follows an explicit user-initiated start, so a
        // healthy answer is enough to clear the banner immediately — without it
        // the "Start daemon" banner lingered for a poll cycle (~5s) after the
        // daemon was already up.
        if (opts?.trusted) daemonHealthyStreakRef.current = 2;
        if (daemonHealthyStreakRef.current >= 2) setDaemonOffline(false);
      } else {
        daemonHealthyStreakRef.current = 0;
        setDaemonOffline(true);
      }
      // The first poll has now produced a real answer — only after this may the
      // offline banner appear, so a fresh load doesn't flash it before we know.
      setDaemonStatusResolved(true);
    }
  }, []);

  const startDaemon = useCallback(async () => {
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not start");
      }
      dismissBanner("daemon-start-error");
      // Trusted: the user just started it and the API reported success, so a
      // single healthy status poll is enough to dismiss the offline banner now.
      await refreshDaemonStatus({ trusted: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "daemon did not start";
      pushBanner({
        id: "daemon-start-error",
        severity: "error",
        title: `Daemon start failed — ${message}`,
      });
      await refreshDaemonStatus();
    }
  }, [dismissBanner, pushBanner, refreshDaemonStatus]);

  // One-shot legacy localStorage key sweep: runs once per browser profile,
  // then marks itself done so it never re-runs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const swept = window.localStorage.getItem("cave:legacy-keys-swept");
    if (swept === "1") return;
    const orphans = [
      "cave:agent-pane-lock",     // stripLock
      "cave:agent-pane",          // shellAgentPane
      "cave:sidebar-icon-strip",  // legacy strip state, if any
    ];
    for (const k of orphans) {
      try { window.localStorage.removeItem(k); } catch { /* ignore */ }
    }
    window.localStorage.setItem("cave:legacy-keys-swept", "1");
  }, []);

  useEffect(() => {
    setScopeIds(new Set(getFamiliarScope()));
    setActiveFamiliarHydrated(true);
  }, []);

  useEffect(() => {
    if (!activeFamiliarHydrated) return;
    setFamiliarScope([...scopeIds]);
  }, [scopeIds, activeFamiliarHydrated]);

  useEffect(() => {
    if (!activeId) {
      queueMicrotask(() => shellRef.current?.closeFamiliar());
      return;
    }
    const desired = getRailOpen(activeId);
    queueMicrotask(() => {
      if (desired) shellRef.current?.openFamiliar();
      else shellRef.current?.closeFamiliar();
    });
  }, [activeId]);

  // Per-familiar rail tab. persistRailTab handles explicit tab choices: it
  // writes the active familiar slot (plus a global fallback for first paint).
  // Restoring a familiar tab on scope change uses plain setRailTab so it never
  // rewrites. Keyed on activeId ("all" when no familiar scope).
  const persistRailTab = useCallback((next: CompanionTab) => {
    setRailTab(next);
    try {
      window.localStorage.setItem("cave:rail.tab:" + (activeIdRef.current ?? "all"), next);
      window.localStorage.setItem("cave:rail.tab", next);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  useEffect(() => {
    if (!activeFamiliarHydrated || typeof window === "undefined") return;
    try {
      const stored =
        window.localStorage.getItem("cave:rail.tab:" + (activeId ?? "all")) ??
        window.localStorage.getItem("cave:rail.tab");
      if (stored) setRailTab(stored === "inspector" ? "memory" : (stored as CompanionTab));
    } catch {
      /* ignore storage failures */
    }
  }, [activeId, activeFamiliarHydrated]);

  useEffect(() => {
    const openSalem = () => {
      setRailTab("salem");
      requestAnimationFrame(() => shellRef.current?.openFamiliar());
    };
    window.addEventListener("cave:salem-open", openSalem);
    return () => window.removeEventListener("cave:salem-open", openSalem);
  }, []);

  // Cross-surface "create a familiar" bridge. The dock (and any deep surface
  // that can't reach openOnboarding directly) announces intent and the
  // Workspace opens onboarding — the full first-run flow. The Familiars page
  // also offers a lighter in-app "New familiar" dialog (POST /api/familiars)
  // for adding to an existing roster without re-running setup.
  useEffect(() => {
    const openCreate = () => setOnboardingOpen(true);
    window.addEventListener("cave:onboarding-open", openCreate);
    return () => window.removeEventListener("cave:onboarding-open", openCreate);
  }, []);

  // Cross-surface navigation bridge: surfaces that don't own setMode (e.g. the
  // chat rail's nav block) announce a target mode and the Workspace switches to
  // it. Keeps those surfaces decoupled from the mode state owner.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const mode = (e as CustomEvent<{ mode?: WorkspaceMode }>).detail?.mode;
      if (mode) setMode(mode);
    };
    window.addEventListener("cave:navigate-mode", onNavigate as EventListener);
    return () => window.removeEventListener("cave:navigate-mode", onNavigate as EventListener);
  }, []);

  // `?mode=<WorkspaceMode>` deep link: external links (e.g. /retro redirects,
  // dashboard buttons) can land directly on a surface. Runs once on mount,
  // mirrors the hash deep-link idiom — switch then strip the param so reloads
  // and back/forward stay clean.
  useEffect(() => {
    const target = readModeParam();
    if (!target) return;
    setMode(target);
    clearModeParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-to-open a file from chat: the comux pane (Code/Terminal) handles
  // `cave:open-project-file` directly when it's showing. When neither is, switch
  // to the Code workspace and re-emit so the freshly-mounted comux catches it.
  useEffect(() => {
    const onOpenFile = (e: Event) => {
      const m = modeRef.current;
      if (m === "code" || m === "terminal") return;
      const detail = (e as CustomEvent).detail;
      setMode("code");
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent("cave:open-project-file", { detail })),
        0,
      );
    };
    window.addEventListener("cave:open-project-file", onOpenFile as EventListener);
    return () => window.removeEventListener("cave:open-project-file", onOpenFile as EventListener);
  }, []);

  useEffect(() => {
    if (railTab !== "salem") {
      window.dispatchEvent(new CustomEvent("cave:salem-undock"));
    }
  }, [railTab]);

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; config?: { addons?: typeof addons } }) => {
        if (j.ok && j.config?.addons) setAddons(j.config.addons);
      })
      .catch(() => {/* keep defaults */});
  }, []);

  // Daemon status poll (previously lived on DaemonBar before chrome consolidation)
  // — pauses while the tab is hidden and refreshes on return (usePausablePoll).
  useEffect(() => {
    void refreshDaemonStatus();
  }, [refreshDaemonStatus]);
  usePausablePoll(() => void refreshDaemonStatus(), 5000, {
    pauseWhileInputActive: true,
  });

  // Push / dismiss the daemon-offline banner into the shared shell channel so
  // it appears at the top of every surface, not just Chat.
  useEffect(() => {
    if (!daemonOffline) {
      dismissBanner("daemon-offline");
      dismissBanner("daemon-start-error");
    } else if (daemonStatusResolved) {
      // Only show the offline banner once the status has actually resolved to
      // "not running" — never during the initial unknown window.
      pushBanner({
        id: "daemon-offline",
        severity: "warning",
        title: "Daemon offline — existing sessions visible but new tasks may not start.",
        cta: {
          label: "Start daemon",
          onClick: () => {
            void startDaemon();
          },
        },
      });
    }
  }, [daemonOffline, daemonStatusResolved, pushBanner, dismissBanner, startDaemon]);

  const loadFamiliars = useCallback(async () => {
    try {
      const res = await fetch("/api/familiars", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setFamiliars([]);
        setFamiliarsError(json.error ?? "daemon offline");
        return;
      }
      setFamiliarsError(null);
      setFamiliars((json.familiars ?? []) as Familiar[]);
    } catch (err) {
      setFamiliars([]);
      setFamiliarsError(err instanceof Error ? err.message : "fetch failed");
    }
  }, []);

  // Scope the view to a familiar. `null` clears to "All". With `opts.multi`
  // (⌘/Ctrl-click) the id is toggled in/out of the multiselect set; a plain
  // click replaces the scope with just that familiar (today's behavior).
  const selectFamiliarScope = useCallback((id: string | null, opts?: { multi?: boolean }) => {
    setScopeIds((prev) => (id == null ? new Set<string>() : toggleFamiliarSelection(prev, id, opts?.multi ?? false)));
    if (!id) return;
    // Stamp recency so the top-bar quick-switch strip reflects real usage.
    recordFamiliarUsed(id);
    // A multi-toggle shouldn't yank the surface around — only a plain single
    // select restores that familiar's last-viewed surface.
    if (opts?.multi) return;
    const last = getLastSurface(id);
    // Guard against retired/unknown persisted modes (e.g. the removed
    // "projects" standalone surface). Only restore if the stored string is
    // still a valid WorkspaceMode; otherwise fall back to the default.
    const VALID_MODES = new Set<string>(Object.keys(WORKSPACE_MODE_TITLES));
    if (last && VALID_MODES.has(last)) setMode(last as WorkspaceMode);
  }, []);

  const selectFamiliar = useCallback((id: string) => {
    selectFamiliarScope(id);
  }, [selectFamiliarScope]);

  const loadSessions = useCallback(() => {
    if (loadSessionsInFlightRef.current) return loadSessionsInFlightRef.current;

    const request = (async () => {
      let baseSessionsApplied = false;
      const githubTasksPromise = addons.github
        ? fetch("/api/github/tasks", { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null)
        : Promise.resolve(null);
      try {
        // Scope the session list to the active familiar's granted projects so
        // every surface fed by `sessions` enforces the familiar→projects map.
        // With "All familiars" (activeId null) the unscoped list is returned.
        const scope = activeId ? `?familiarId=${encodeURIComponent(activeId)}` : "";
        const sessionsResult = await fetch(`/api/sessions/list${scope}`, { cache: "no-store" });
        const json = await sessionsResult.json();
        if (!json.ok) return;

        const baseSessions = (json.sessions ?? []) as SessionRow[];
        // The 4s poll rebuilds a fresh array each tick; keep the previous
        // reference when nothing changed so an unchanged list doesn't re-render
        // every sessions consumer (chat list, rails, badges) for nothing.
        setSessions((prev) => (sameSessionList(prev, baseSessions) ? prev : baseSessions));
        setSessionsLoaded(true);
        baseSessionsApplied = true;

        const githubTasksJson = await githubTasksPromise;
        if (githubTasksJson) {
          setGithubAssignedCount(Array.isArray(githubTasksJson.tasks) ? githubTasksJson.tasks.length : 0);
          setSessions((currentSessions) => {
            const enriched = attachGitHubTaskContext(
              currentSessions.length > 0 ? currentSessions : baseSessions,
              githubTasksJson,
            );
            return sameSessionList(currentSessions, enriched) ? currentSessions : enriched;
          });
        }
      } catch {
        /* transient */
      } finally {
        if (!baseSessionsApplied) setSessionsLoaded(true);
        loadSessionsInFlightRef.current = null;
      }
    })();

    loadSessionsInFlightRef.current = request;
    return request;
  }, [addons.github, activeId]);

  useEffect(() => {
    loadFamiliars();
    loadSessions();
  }, [loadFamiliars, loadSessions]);
  usePausablePoll(() => void loadSessions(), 4000, {
    pauseWhileInputActive: true,
  });

  const refreshPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/prefs", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setInboxPrefs(json.prefs as InboxPrefs);
    } catch {
      /* keep defaults */
    }
  }, []);

  useEffect(() => {
    void refreshPrefs();
  }, [refreshPrefs]);

  // Tray menu events from Rust: bring the user into the inbox view or pop
  // open the reminder modal. No-op outside Tauri (next dev in a browser).
  useEffect(() => {
    if (typeof window === "undefined") return;
    // @ts-expect-error Tauri injects this at runtime
    if (!window.__TAURI_INTERNALS__) return;
    let unlistenOpen: (() => void) | undefined;
    let unlistenNew: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenOpen = await listen("tray:open-inbox", () => setMode("inbox"));
        unlistenNew = await listen("tray:new-reminder", () => {
          setReminderModalDefaults({ fireAt: "", title: "", whenText: "" });
          setReminderModalOpen(true);
        });
      } catch {
        /* harmless in browser dev */
      }
    })();
    return () => {
      unlistenOpen?.();
      unlistenNew?.();
    };
  }, []);

  useEffect(() => {
    if (activeId) setLastSurface(activeId, mode);
  }, [activeId, mode]);

  // Auto-collapse the bottom slide-up terminal slot when the Terminal surface
  // is active. Prevents the double-terminal state where the surface PTY and
  // the slide-up PTY both render at once.
  useEffect(() => {
    if (mode !== "terminal") return;
    requestAnimationFrame(() => {
      if (typeof window === "undefined") return;
      const raw = window.localStorage.getItem("cave.shell.bottom.v1");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const bottomLayout = parsed?.["cave.shell.bottom.v1"]?.layout;
        const bottomSize = Array.isArray(bottomLayout) ? bottomLayout[1] : 0;
        if (typeof bottomSize === "number" && bottomSize > 0) {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "`",
              code: "Backquote",
              ctrlKey: true,
              bubbles: true,
            }),
          );
        }
      } catch {
        /* ignore corrupted layout */
      }
    });
  }, [mode]);

  // Keep prefs accessible to the SSE callback without re-subscribing on every
  // mute toggle.
  const inboxPrefsRef = useRef(inboxPrefs);
  inboxPrefsRef.current = inboxPrefs;

  // Subscribe to the inbox SSE stream: drives the inbox list, toasts, and
  // macOS system notifications. EventSource auto-reconnects on its own.
  useEffect(() => {
    const es = new EventSource("/api/inbox/stream");
    const isMuted = (item: InboxItem) =>
      !!item.familiarId &&
      inboxPrefsRef.current.mutedFamiliars.includes(item.familiarId);
    const sound = () => {
      const s = inboxPrefsRef.current.sound;
      if (s.mode === "silent") return null;
      if (s.mode === "named" && s.name) return s.name;
      return undefined; // platform default
    };
    es.onmessage = (ev) => {
      let event: unknown;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!event || typeof event !== "object") return;
      const e = event as
        | { type: "snapshot"; items: InboxItem[] }
        | { type: "fired"; items: InboxItem[] }
        | { type: "created"; item: InboxItem }
        | { type: "updated"; item: InboxItem }
        | { type: "deleted"; id: string };
      if (e.type === "snapshot") {
        setInboxItems(e.items);
        return;
      }
      if (e.type === "created") {
        setInboxItems((prev) => [...prev, e.item]);
        if (e.item.status === "fired" && !isMuted(e.item)) {
          setToasts((prev) => [...prev, toastFromItem(e.item)]);
          void nativeNotify(e.item.title, e.item.body, sound());
        }
        return;
      }
      if (e.type === "updated") {
        setInboxItems((prev) =>
          prev.map((it) => (it.id === e.item.id ? e.item : it)),
        );
        return;
      }
      if (e.type === "deleted") {
        setInboxItems((prev) => prev.filter((it) => it.id !== e.id));
        return;
      }
      if (e.type === "fired") {
        setInboxItems((prev) => {
          const byId = new Map(e.items.map((it) => [it.id, it]));
          const merged = prev.map((it) => byId.get(it.id) ?? it);
          for (const fresh of e.items) {
            if (!prev.find((it) => it.id === fresh.id)) merged.push(fresh);
          }
          return merged;
        });
        const loud = e.items.filter((it) => !isMuted(it));
        if (loud.length === 1) {
          const item = loud[0];
          setToasts((prev) => [...prev, toastFromItem(item)]);
          void nativeNotify(item.title, item.body, sound());
        } else if (loud.length > 1) {
          const summary: Toast = {
            id: `missed-${Date.now()}`,
            title: `${loud.length} reminders fired`,
            body: loud.map((it) => it.title).join(" · "),
          };
          setToasts((prev) => [...prev, summary]);
          void nativeNotify(summary.title, summary.body, sound());
        }
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!sessionsLoaded) return;
    const now = new Date();
    const key = dailySummaryAutoKey(now);
    if (dailySummaryRequestedRef.current === key) return;
    const draft = buildDailySummaryNotification({ items: inboxItems, sessions, now });
    if (!draft) return;
    dailySummaryRequestedRef.current = key;
    void ensureDailySummaryNotification({ items: inboxItems, sessions, now }).then((result) => {
      if (result === "failed") dailySummaryRequestedRef.current = null;
    });
  }, [inboxItems, sessions, sessionsLoaded]);

  const openOnboarding = useCallback(() => setOnboardingOpen(true), []);
  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    void loadFamiliars();
  }, [loadFamiliars]);

  // First-run: auto-open onboarding if anything is missing and the user
  // hasn't explicitly skipped it.
  useEffect(() => {
    let cancelled = false;
    const skipped =
      typeof window !== "undefined" && window.localStorage.getItem("cave:onboarding:dismissed") === "1";
    if (skipped) return;
    void (async () => {
      try {
        const res = await fetch("/api/onboarding/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { complete?: boolean };
        if (!json.complete) setOnboardingOpen(true);
      } catch {
        /* ignore — DaemonBar surfaces transport issues */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta) {
        const k = e.key.toLowerCase();
        if (k === "k") {
          e.preventDefault();
          setPaletteOpen(true);
          return;
        }
        // ⌘/ (Ctrl+/ off-Mac) → keyboard shortcuts sheet, from anywhere.
        if (e.key === "/") {
          e.preventDefault();
          setShortcutsOpen((open) => !open);
        }
        return;
      }
      // Bare `?` also opens the sheet, but only when focus is not in an
      // input/textarea/contentEditable — typing "?" must stay typing.
      if (e.key === "?" && !isEditableTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setFamiliarResponse = useCallback((familiarId: string, needed: boolean) => {
    void familiarId;
    void needed;
    setResponseNeeded((prev) => prev);
  }, []);
  void setFamiliarResponse;

  const refreshInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setInboxItems(json.items ?? []);
    } catch {
      /* SSE will reconcile on next event */
    }
  }, []);

  // Calendar item actions — optimistic local update + fire-and-forget POST;
  // the /api/inbox/stream SSE reconciles authoritative state (same pattern as
  // dismissToast/snoozeToast).
  const completeInboxItem = useCallback((id: string) => {
    setInboxItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "done" } : it)));
    void fetch(`/api/inbox/${id}/done`, { method: "POST" });
  }, []);
  const dismissInboxItem = useCallback((id: string) => {
    setInboxItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "dismissed" } : it)));
    void fetch(`/api/inbox/${id}/dismiss`, { method: "POST" });
  }, []);
  const snoozeInboxItem = useCallback((id: string, untilIso: string) => {
    setInboxItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "snoozed", snoozeUntil: untilIso } : it)));
    void fetch(`/api/inbox/${id}/snooze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ untilIso }),
    });
  }, []);
  // Drag-to-reschedule from the calendar: move the item to a new fireAt and make
  // it pending there (clearing any snooze). Optimistic; the SSE stream reconciles.
  const rescheduleInboxItem = useCallback((id: string, fireAtIso: string) => {
    setInboxItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, fireAt: fireAtIso, status: "pending", snoozeUntil: null } : it)),
    );
    void fetch(`/api/inbox/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fireAt: fireAtIso, status: "pending", snoozeUntil: null }),
    });
  }, []);

  // Poll Inbox for unresolved-escalations count — drives the
  // sidebar/daemon-bar Inbox badge. Cheap GET every 30s; the route
  // already de-dupes via reconcileEscalations(). Pauses in a hidden tab.
  const refreshEscalations = useCallback(async () => {
    try {
      const res = await fetch("/api/escalations", { cache: "no-store" });
      const json = await res.json();
      if (json.ok && Array.isArray(json.items)) {
        const now = Date.now();
        const unresolved = (json.items as Array<{
          state: string;
          snoozeUntil?: string;
        }>).filter((it) => {
          if (it.state === "resolved" || it.state === "dismissed") return false;
          if (it.state === "snoozed" && it.snoozeUntil) {
            return new Date(it.snoozeUntil).getTime() <= now;
          }
          return true;
        }).length;
        setEscalationsUnresolved(unresolved);
      }
    } catch {
      /* keep last value on transient failure */
    }
  }, []);
  useEffect(() => {
    void refreshEscalations();
  }, [refreshEscalations]);
  usePausablePoll(() => void refreshEscalations(), 30_000, {
    pauseWhileInputActive: true,
  });

  const refreshOpenTaskCards = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok && Array.isArray(json.cards)) {
        const cards = json.cards as Array<{
          id?: string;
          title?: string;
          status?: string;
          familiarId?: string | null;
          endDate?: string | null;
        }>;
        // The 60s board poll rebuilds these arrays each tick; keep the previous
        // reference when the content is unchanged so an idle board doesn't
        // re-render the Tasks badge / calendar deadline markers for nothing.
        const nextOpenCards = cards
          .filter((c) => c.status !== "done")
          .map((c) => ({ familiarId: c.familiarId ?? null }));
        setOpenTaskCards((prev) => (arrayContentEqual(prev, nextOpenCards) ? prev : nextOpenCards));
        // Open cards with a due date become read-only calendar deadline markers
        // (a shipped/"done" task is no longer an upcoming deadline).
        const nextDeadlines = cards
          .filter((c) => c.id && c.endDate && c.status !== "done")
          .map((c) => ({
            id: c.id as string,
            title: c.title?.trim() || "Untitled task",
            date: c.endDate as string,
            familiarId: c.familiarId ?? null,
            status: c.status,
          }));
        setBoardDeadlines((prev) => (arrayContentEqual(prev, nextDeadlines) ? prev : nextDeadlines));
      }
    } catch {
      /* keep last value on transient failure */
    }
  }, []);

  // Poll the board for the count of open task cards (anything not yet "done")
  // — drives the desktop menu bar's Tasks badge. Cheap GET every 60s; pauses
  // in a hidden tab.
  useEffect(() => {
    void refreshOpenTaskCards();
  }, [refreshOpenTaskCards]);
  usePausablePoll(() => void refreshOpenTaskCards(), 60_000, {
    pauseWhileInputActive: true,
  });

  const handleEnrichTasks = useCallback(async () => {
    if (!activeId || enrichingTasks) return;
    setEnrichingTasks(true);
    setEnrichProgress(null);
    try {
      const res = await fetch("/api/board/enrich-steps", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-coven-cave-intent": "board-enrich-steps",
        },
        body: JSON.stringify({ intent: "board-enrich-steps", familiarId: activeId }),
      });
      if (!res.ok) throw new Error(`enrich tasks failed (${res.status})`);
      if (!res.body) throw new Error("enrich tasks: missing response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>;
            if (msg.kind === "start") {
              setEnrichProgress({ done: 0, total: (msg.total as number) ?? 0 });
            } else if (msg.kind === "done" || msg.kind === "skip") {
              setEnrichProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);
            } else if (msg.kind === "complete") {
              window.dispatchEvent(new CustomEvent("cave:board:reload"));
              await refreshOpenTaskCards();
            }
          } catch {
            /* ignore malformed progress lines */
          }
        }
      }
    } catch {
      /* keep the top-bar action quiet; progress resets below */
    } finally {
      setEnrichingTasks(false);
    }
  }, [activeId, enrichingTasks, refreshOpenTaskCards]);

  const openReminderModal = useCallback((title = "", whenText = "", fireAt = "") => {
    setReminderModalDefaults({ fireAt, title, whenText });
    setReminderModalOpen(true);
  }, []);

  const openReminderForFamiliar = useCallback((familiarId: string) => {
    setActiveId(familiarId);
    openReminderModal();
  }, [openReminderModal]);

  const pushToast = useCallback((title: string) => {
    const id = `eph:adhoc-${Date.now()}`;
    setToasts((prev) => [...prev, { id, title }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    // Persist dismissal for real items. Skip synthetic ids (missed-batches,
    // ephemeral response-needed rows).
    if (!id.startsWith("missed-") && !id.startsWith("eph:")) {
      void fetch(`/api/inbox/${id}/dismiss`, { method: "POST" });
    }
  }, []);

  const snoozeToast = useCallback((toast: Toast, untilIso: string) => {
    if (toast.itemId && !toast.itemId.startsWith("eph:")) {
      void fetch(`/api/inbox/${toast.itemId}/snooze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ untilIso }),
      });
    }
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
  }, []);

  const openFamiliarSession = useCallback((sessionId: string, familiarId?: string | null, findQuery?: string) => {
    if (familiarId) setActiveId(familiarId);
    setPendingChatAction({
      kind: "open",
      sessionId,
      familiarId,
      ...(findQuery ? { findQuery } : {}),
      nonce: Date.now(),
    });
    setMode("chat");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // @ts-expect-error Tauri injects this at runtime
    if (!window.__TAURI_INTERNALS__) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("quick-chat:open-session", (event) => {
          const payload = event.payload as { sessionId?: string; familiarId?: string | null };
          if (payload?.sessionId) openFamiliarSession(payload.sessionId, payload.familiarId);
        });
      } catch {
        /* harmless in browser dev */
      }
    })();
    return () => unlisten?.();
  }, [openFamiliarSession]);

  const openReminderLink = useCallback((link: LinkRef) => {
    if (link.kind === "url") {
      if (!link.ref) return;
      if (link.ref.startsWith("/")) {
        nextRouter.push(link.ref);
        return;
      }
      setMode("browser");
      requestAnimationFrame(() => browserPaneRef.current?.navigateTo(link.ref));
    } else if (link.kind === "card") {
      setMode("board");
      window.location.hash = `card-${link.ref}`;
    } else if (link.kind === "session") {
      openFamiliarSession(link.ref);
    }
  }, [nextRouter, openFamiliarSession]);

  const openInspectorInboxItem = useCallback((item: InboxItem) => {
    const sessionId =
      item.sessionId ?? (item.link?.kind === "session" ? item.link.ref : null);
    if (sessionId) {
      openFamiliarSession(sessionId, item.familiarId);
      return;
    }
    if (item.familiarId) setActiveId(item.familiarId);
    setMode("inbox");
  }, [openFamiliarSession]);

  const startFamiliarChat = useCallback((
    familiarId?: string | null,
    projectRoot?: string | null,
    initialPrompt?: string | null,
  ) => {
    if (familiarId) setActiveId(familiarId);
    setPendingProjectChatRoot(projectRoot ?? null);
    setPendingChatAction({
      kind: "new",
      familiarId,
      projectRoot,
      initialPrompt,
      nonce: Date.now(),
    });
    setMode("chat");
  }, []);

  // Bridge `cave:agents-new-chat` from surfaces that aren't the chat view.
  // ChatSurface owns this event, but it only mounts when mode === "chat", so a
  // dispatch from the Familiar Studio drawer (e.g. the Contract tab's
  // rehabilitation button) or other non-chat surfaces would otherwise be lost.
  // When already in chat, ChatSurface handles it directly — skip here to avoid
  // opening the new chat twice.
  useEffect(() => {
    const onAgentsNewChat = (e: Event) => {
      if (modeRef.current === "chat") return;
      const d = (e as CustomEvent<{ familiarId?: string | null; projectRoot?: string | null; initialPrompt?: string | null }>).detail;
      startFamiliarChat(d?.familiarId ?? null, d?.projectRoot ?? null, d?.initialPrompt ?? null);
    };
    window.addEventListener("cave:agents-new-chat", onAgentsNewChat);
    return () => window.removeEventListener("cave:agents-new-chat", onAgentsNewChat);
  }, [startFamiliarChat]);

  useEffect(() => {
    // ⌘1..⌘7 in the order surfaces appear top-to-bottom in the left sidebar
    // (Work group, then Tools group). ⌘9 is Projects and ⌘0 is Library (handled
    // below); Journal/Roles/Workflows are unshortcut.
    const SURFACE_ORDER: WorkspaceMode[] = [
      "home", "chat", "board", "inbox", "browser", "terminal", "code",
    ];

    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const alt = e.altKey;

      // ⌘1..⌘9 -> sidebar surface
      if (meta && !alt && /^[1-9]$/.test(e.key)) {
        // ⌘9 -> Projects tab inside chat surface (no SURFACE_ORDER lookup needed)
        if (e.key === "9") {
          e.preventDefault();
          setMode("chat");
          window.setTimeout(() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT)), 0);
          return;
        }
        const idx = parseInt(e.key, 10) - 1;
        const target = SURFACE_ORDER[idx];
        if (target) {
          e.preventDefault();
          setMode(target);
        }
        return;
      }

      // ⌘0 -> Library (the last Tools surface in the sidebar)
      if (meta && !alt && e.key === "0") {
        e.preventDefault();
        setMode("library");
        return;
      }

      // ⌘[ / ⌘] -> previous / next surface, cycling through SURFACE_ORDER in the
      // same top-to-bottom order as ⌘1..⌘8 (wraps at the ends). From an off-list
      // surface (Journal/Roles/Workflows), ⌘] lands on the first surface and ⌘[
      // on the last.
      if (meta && !alt && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const step = e.key === "]" ? 1 : -1;
        const cur = SURFACE_ORDER.indexOf(mode as WorkspaceMode);
        const base = cur === -1 ? (step === 1 ? -1 : 0) : cur;
        const next = (base + step + SURFACE_ORDER.length) % SURFACE_ORDER.length;
        setMode(SURFACE_ORDER[next]);
        return;
      }

      // ⌘, -> Settings (the TopBar account button advertises this shortcut in
      // its tooltip, but nothing was wired to handle it).
      if (meta && !alt && e.key === ",") {
        e.preventDefault();
        nextRouter.push("/settings");
        return;
      }

      // ⌥1..⌥9 → Nth familiar
      if (alt && !meta && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const target = familiars[idx];
        if (target) {
          e.preventDefault();
          selectFamiliar(target.id);
        }
        return;
      }

      // ⌘↑ / ⌘↓ → cycle familiars
      if (meta && (e.key === "ArrowUp" || e.key === "ArrowDown") && familiars.length > 0) {
        e.preventDefault();
        const idx = familiars.findIndex((f) => f.id === activeId);
        const step = e.key === "ArrowUp" ? -1 : 1;
        const next = (idx === -1 ? 0 : (idx + step + familiars.length) % familiars.length);
        selectFamiliar(familiars[next].id);
        return;
      }

      // ⌘N → new chat (only on Chat surface)
      if (meta && !alt && e.key.toLowerCase() === "n" && mode === "chat") {
        e.preventDefault();
        startFamiliarChat(activeId);
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [familiars, activeId, mode, selectFamiliar, startFamiliarChat, nextRouter]);

  const showFamiliarChatList = useCallback(() => {
    setPendingChatAction({ kind: "list", nonce: Date.now() });
    setMode("chat");
  }, []);

  // Mount-time deep-link restore: sessions load async (/api/sessions/list),
  // so hold the `#chat-<sessionId>` target until the first fetch settles,
  // then open the session — same lookup as the `/attach` slash command.
  // Unknown/stale ids fall back to the chat list with the hash cleared.
  useEffect(() => {
    if (!sessionsLoaded) return;
    const sid = pendingChatDeepLinkRef.current;
    if (!sid) return;
    pendingChatDeepLinkRef.current = null;
    const target = sessions.find((s) => s.id === sid);
    if (target) {
      openFamiliarSession(sid, target.familiarId);
    } else {
      clearChatHash();
      showFamiliarChatList();
    }
  }, [sessionsLoaded, sessions, openFamiliarSession, showFamiliarChatList]);

  // Browser Back/Forward between list ↔ chat (and chat ↔ chat). Only acts on
  // chat hashes — board `#card-` and library hashes keep their own listeners.
  useEffect(() => {
    const onPopState = () => {
      const sid = readChatHash();
      if (sid) {
        const target = sessionsRef.current.find((s) => s.id === sid);
        if (target) {
          openFamiliarSession(sid, target.familiarId);
          return;
        }
        if (!sessionsLoadedRef.current) {
          pendingChatDeepLinkRef.current = sid;
          return;
        }
        clearChatHash();
        showFamiliarChatList();
        return;
      }
      // Popped back out of a chat entry to the root (empty hash) → show the
      // list. A *non-empty* hash belongs to another surface's deep link — the
      // `#card-<id>` the task chip writes, or `#memory:` / `#library:` — and
      // that surface owns its own mode switch. Bouncing to the chat list here
      // would hijack such navigation: writing `#card-<id>` synchronously fires
      // this handler while `mode` is still "chat" (the intent's setMode("board")
      // hasn't committed yet), so an unconditional showFamiliarChatList() clobbers
      // the board switch in the same render batch and strands the user on the
      // chat list. Gating on the empty hash leaves cross-surface deep links to
      // their owners while preserving genuine Back-to-list.
      if (modeRef.current === "chat" && !window.location.hash) showFamiliarChatList();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openFamiliarSession, showFamiliarChatList]);

  // Leaving the chat surface invalidates a chat hash — clear it in place
  // (replace, not push) so a reload restores the surface the user actually
  // sees. Skip while the mount-time deep link is still awaiting sessions.
  useEffect(() => {
    if (mode === "chat" || pendingChatDeepLinkRef.current) return;
    clearChatHash();
  }, [mode]);

  const openToastTarget = useCallback((toast: Toast) => {
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    if (toast.link) {
      openReminderLink(toast.link);
    } else if (toast.sessionId) {
      openFamiliarSession(toast.sessionId, toast.familiarId);
    } else {
      setMode("inbox");
    }
  }, [openFamiliarSession, openReminderLink]);

  const toggleFamiliarPanel = useCallback(() => {
    shellRef.current?.toggleFamiliar();
  }, []);

  const onPaletteIntent = (intent: PaletteIntent) => {
    if (intent.kind === "switch-familiar") {
      setActiveId(intent.familiarId);
      showFamiliarChatList();
      return;
    }
    if (intent.kind === "open-session") {
      openFamiliarSession(intent.sessionId, intent.familiarId, intent.findQuery);
      return;
    }
    if (intent.kind === "new-chat") {
      startFamiliarChat(intent.familiarId);
      return;
    }
    if (intent.kind === "back-to-list") {
      showFamiliarChatList();
      return;
    }
    if (intent.kind === "open-tui-session") {
      void fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "attach", sessionId: intent.sessionId }),
      });
      return;
    }
    if (intent.kind === "open-board") {
      setMode("board");
      return;
    }
    if (intent.kind === "set-board-view") {
      // Persist for a fresh mount, navigate to the board, then signal a live
      // switch in case the board is already mounted.
      try { localStorage.setItem("cave:board:viewMode", intent.view); } catch { /* ignore */ }
      setMode("board");
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent("cave:board:set-view", { detail: { view: intent.view } })),
        0,
      );
      return;
    }
    if (intent.kind === "go-to-surface") {
      setMode(intent.mode as WorkspaceMode);
      shellRef.current?.dismissNavMobile();
      return;
    }
    if (intent.kind === "open-project") {
      // Open the Chat surface's Projects tab, then ask it to expand + scroll the
      // chosen project into view once it has mounted.
      setMode("chat");
      shellRef.current?.dismissNavMobile();
      const root = intent.root;
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT));
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent(CHAT_FOCUS_PROJECT_EVENT, { detail: { root } })),
          60,
        );
      }, 0);
      return;
    }
    if (intent.kind === "focus-card") {
      // Navigate to the board and signal which card to focus via URL hash.
      // BoardView listens for `#card-<id>` and selects the matching card.
      setMode("board");
      window.location.hash = `card-${intent.cardId}`;
      return;
    }
    if (intent.kind === "create-task") {
      const title = intent.title.trim();
      if (!title) return;
      const familiarId = activeId;
      void (async () => {
        try {
          const res = await fetch("/api/board", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, familiarId }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as {
            ok: boolean;
            card?: { id: string };
          };
          if (!json.ok || !json.card) {
            pushToast("Task creation failed.");
            return;
          }
          setMode("board");
          window.dispatchEvent(new Event("cave:board:reload"));
          window.location.hash = `card-${json.card.id}`;
        } catch {
          pushToast("Task creation failed.");
        }
      })();
      return;
    }
    if (intent.kind === "open-memory-file") {
      setMode("agents");
      window.location.hash = `memory:${encodeURIComponent(intent.path)}`;
      return;
    }
    if (intent.kind === "slash") {
      handleSlashIntent(intent.command, intent.args);
      return;
    }
  };

  // Map slash commands directly to local actions. Returns false for commands
  // this surface doesn't know so the chat composer can show its
  // "Unknown command" feedback instead of silently swallowing the input.
  const handleSlashIntent = (command: string, args = ""): boolean => {
    switch (command) {
      case "/new":
        startFamiliarChat(activeId);
        return true;
      case "/board":
        setMode("board");
        return true;
      case "/journal":
        try { localStorage.setItem("cave:journal:tab", "journal"); } catch { /* ignore */ }
        setMode("journal");
        window.dispatchEvent(new CustomEvent("cave:journal-set-tab", { detail: { tab: "journal" } }));
        return true;
      case "/canvas":
        try { localStorage.setItem("cave:journal:tab", "canvas"); } catch { /* ignore */ }
        setMode("journal");
        window.dispatchEvent(new CustomEvent("cave:journal-set-tab", { detail: { tab: "canvas" } }));
        return true;
      case "/chats":
      case "/agents":
      case "/chat":
        showFamiliarChatList();
        return true;
      case "/automations":
      case "/inbox":
        setMode("inbox");
        return true;
      case "/evals":
      case "/eval-loops":
        setMode("evals");
        return true;
      case "/remind": {
        const trimmedArgs = args.trim();
        const { title, whenText } = trimmedArgs
          ? draftFromSlashArgs(trimmedArgs)
          : { title: "", whenText: "" };
        openReminderModal(title, whenText);
        return true;
      }
      case "/palette":
        setPaletteOpen(true);
        return true;
      case "/shortcuts":
        setShortcutsOpen(true);
        return true;
      case "/terminal":
        setMode("terminal");
        return true;
      case "/projects":
        setMode("chat");
        window.setTimeout(() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT)), 0);
        return true;
      case "/library":
        setMode("library");
        return true;
      case "/research":
        setMode("library");
        // Defer so LibraryView is mounted and listening before the event fires.
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent("cave:library:research", { detail: { topic: args.trim() } })),
          0,
        );
        return true;
      case "/toggle-agent":
        toggleFamiliarPanel();
        return true;
      case "/quit":
        showFamiliarChatList();
        return true;
      case "/sessions":
        setMode("chat");
        showFamiliarChatList();
        return true;
      case "/familiar": {
        const name = args.trim().toLowerCase();
        if (name) {
          const match = familiars.find(
            (f) => f.id === name || f.display_name.toLowerCase() === name,
          );
          if (match) {
            setActiveId(match.id);
            showFamiliarChatList();
            return true;
          }
        }
        setPaletteOpen(true);
        return true;
      }
      case "/attach": {
        const sid = args.trim();
        if (!sid) {
          setPaletteOpen(true);
          return true;
        }
        // Find which familiar this session belongs to so we surface the right rail row
        const target = sessions.find((s) => s.id === sid);
        openFamiliarSession(sid, target?.familiarId);
        return true;
      }
      case "/tui": {
        const sid = routerRef.current?.currentSessionId();
        if (sid) {
          void fetch("/api/launch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "attach", sessionId: sid }),
          });
        }
        return true;
      }
      case "/save":
      case "/bookmark":
      case "/read": {
        // Same contract as the chat composer's /save: route the URL into the
        // library. Palette/home invocations have no transcript to append to,
        // so outcomes surface as toasts instead.
        const parsed = slashSaveParse(args);
        if ("error" in parsed) {
          pushToast("Usage: /save <url> [bookmarks|reading|github] [#tag]");
          return true;
        }
        void (async () => {
          try {
            const res = await fetch("/api/library/route-link", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                url: parsed.url,
                source: { kind: "slash", originSessionId: null },
                familiar: activeId ?? "",
                tags: parsed.tags,
                listHint: parsed.listHint,
              }),
            });
            const json = (await res.json()) as {
              ok: boolean;
              deduped?: boolean;
              classify?: { rule: string };
            };
            if (!json.ok) {
              pushToast("Save failed.");
            } else if (json.deduped) {
              pushToast("Already in library.");
            } else {
              const list =
                json.classify?.rule === "github"
                  ? "GitHub"
                  : json.classify?.rule === "article-host" ||
                      json.classify?.rule === "paper-host" ||
                      json.classify?.rule === "video-host"
                    ? "Reading"
                    : "Bookmarks";
              pushToast(`Saved to ${list}.`);
            }
          } catch {
            pushToast("Save failed.");
          }
        })();
        return true;
      }
      case "/clear":
        routerRef.current?.clearTranscript();
        return true;
      case "/help":
      case "/run":
      case "/codex":
      case "/claude":
        // These need composer context; route to the chat view's slash handler.
        routerRef.current?.runSlash(command);
        return true;
    }
    return false;
  };

  const active = familiars.find((f) => f.id === activeId) ?? null;
  const calendarFamiliarId = activeId ?? familiars[0]?.id ?? null;
  const retroFamiliarId = activeId ?? familiars[0]?.id ?? null;

  // Tasks badge count: scoped to the active familiar's open cards, or the grand
  // total of all open cards when "All familiars" (activeId === null) is selected.
  const boardTaskCount = useMemo(
    () =>
      activeId === null
        ? openTaskCards.length
        : openTaskCards.filter((c) => c.familiarId === activeId).length,
    [openTaskCards, activeId],
  );

  // Ephemeral bridge: turn each "needs response" familiar into a transient
  // InboxItem so the bell badge, inbox view, and inspector tab all surface it
  // without writing anything to disk. IDs are prefixed `eph:` so dismiss/snooze
  // handlers can detect and skip the API call.
  const inboxItemsWithEphemeral = useMemo<InboxItem[]>(() => {
    if (responseNeeded.size === 0) return inboxItems;
    const ephemeral: InboxItem[] = [];
    const nowIso = new Date().toISOString();
    for (const familiarId of responseNeeded) {
      const familiar = familiars.find((f) => f.id === familiarId);
      const latestSession = sessions
        .filter((s) => s.familiarId === familiarId)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
      ephemeral.push({
        id: `eph:response-needed:${familiarId}`,
        kind: "response-needed",
        title: familiar
          ? `${familiar.display_name} needs a reply`
          : `${familiarId} needs a reply`,
        status: "pending",
        createdAt: nowIso,
        updatedAt: nowIso,
        fireAt: null,
        firedAt: null,
        snoozeUntil: null,
        recurrence: { type: "none" },
        source: "system",
        familiarId,
        sessionId: latestSession?.id ?? null,
        link: latestSession ? { kind: "session", ref: latestSession.id } : null,
      });
    }
    return [...inboxItems, ...ephemeral];
  }, [inboxItems, responseNeeded, familiars, sessions]);

  // Schedules nav badge: how many inbox items currently need you (fired or
  // response-needed) - mirrors the Schedules > Inbox tab "needs you" group.
  const scheduleNeedsCount = useMemo(
    () => groupInboxFeed(inboxItemsWithEphemeral).needsYou.length,
    [inboxItemsWithEphemeral],
  );

  // Mood C three-pane Shell:
  //   nav   = always present (mode switcher + command launchers)
  //   list  = unused by Familiars; Inbox/Board/Plugins
  //           are full-width detail surfaces — they have their own list
  //           UI baked in and we don't want to double-list.
  //   detail = the active view. Agents mode renders an inline inspector
  //           rail on its right edge so we keep the inspector affordance
  //           without spawning a 4th pane.
  // Inbox badge counts unresolved escalations (Inbox is now the
  // primary Inbox surface). "new" + "acknowledged" + "snoozed-due" all
  // count as needing attention; resolved/dismissed do not.
  const inboxBadgeCount = escalationsUnresolved;

  const showCompanionRail =
    railTab === "browser" || railTab === "salem" || (mode !== "browser" && mode !== "agents");

  const openCompanionTab = useCallback((tab: CompanionTab) => {
    persistRailTab(tab);
    if (familiarPanelOpen && railTab === tab) {
      shellRef.current?.closeFamiliar();
      return;
    }
    requestAnimationFrame(() => shellRef.current?.openFamiliar());
  }, [familiarPanelOpen, railTab]);

  const openUrlInAppBrowser = useCallback((url: string) => {
    if (!url) return;
    setMode("browser");
    shellRef.current?.dismissNavMobile();
    window.setTimeout(() => browserPaneRef.current?.navigateTo(url), 0);
  }, []);

  useEffect(() => {
    const openPendingBrowserUrl = () => {
      const pending = window.sessionStorage.getItem(PENDING_IN_APP_BROWSER_URL_KEY);
      if (pending) {
        window.sessionStorage.removeItem(PENDING_IN_APP_BROWSER_URL_KEY);
        openUrlInAppBrowser(pending);
        return;
      }
      if (window.location.hash === "#browser") setMode("browser");
    };
    const onOpenBrowserUrl = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      if (detail?.url) {
        window.sessionStorage.removeItem(PENDING_IN_APP_BROWSER_URL_KEY);
        openUrlInAppBrowser(detail.url);
      }
    };
    openPendingBrowserUrl();
    window.addEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpenBrowserUrl);
    window.addEventListener("hashchange", openPendingBrowserUrl);
    return () => {
      window.removeEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpenBrowserUrl);
      window.removeEventListener("hashchange", openPendingBrowserUrl);
    };
  }, [openUrlInAppBrowser]);

  const openProjectChat = useCallback((projectRoot: string) => {
    startFamiliarChat(activeId, projectRoot);
  }, [activeId, startFamiliarChat]);

  const openCodeProjectChat = useCallback((projectRoot: string | null) => {
    setPendingProjectChatRoot(projectRoot ?? null);
    setPendingChatAction({
      kind: "new",
      familiarId: activeId,
      projectRoot,
      nonce: Date.now(),
    });
    setMode("code");
  }, [activeId]);

  const sidebar = (
    <SidebarMinimal
      mode={mode}
      sessions={sessions}
      activeSessionId={routerRef.current?.currentSessionId() ?? null}
      addons={addons}
      onNewChat={() => {
        startFamiliarChat(activeId);
        shellRef.current?.dismissNavMobile();
      }}
      onOpenSettings={() => {
        shellRef.current?.dismissNavMobile();
        nextRouter.push("/settings");
      }}
      onModeChange={(m) => {
        if (m === "browser") {
          setMode("browser");
          shellRef.current?.dismissNavMobile();
          return;
        }
        setMode(m as WorkspaceMode);
        shellRef.current?.dismissNavMobile();
      }}
      onOpenSession={(id) => {
        openFamiliarSession(id);
        shellRef.current?.dismissListMobile();
      }}
      inboxItems={inboxItemsWithEphemeral}
      inboxPrefs={inboxPrefs}
      familiars={resolvedFamiliars}
      activeFamiliarId={activeId}
      onFamiliarScopeChange={selectFamiliarScope}
      responseNeeded={responseNeeded}
      notificationBadgeCount={inboxBadgeCount}
      onOpenInbox={() => setMode("inbox")}
      onOpenInboxItem={(item) => {
        if (item.sessionId) {
          openFamiliarSession(item.sessionId, item.familiarId);
        } else {
          setMode("inbox");
        }
      }}
      onNotificationPrefsChanged={refreshPrefs}
      boardOpenCount={boardTaskCount}
      scheduleNeedsCount={scheduleNeedsCount}
      githubAssignedCount={githubAssignedCount}
    />
  );

  const codeSidebar = (
    <CodeSidebar
      sessions={sessions}
      activeSessionId={routerRef.current?.currentSessionId() ?? null}
      onBack={exitCodeMode}
      onOpenSession={(session) => {
        if (session.familiarId) setActiveId(session.familiarId);
        setPendingChatAction({
          kind: "open",
          sessionId: session.id,
          familiarId: session.familiarId,
          nonce: Date.now(),
        });
        setMode("code");
        shellRef.current?.dismissNavMobile();
      }}
      onNewChat={openCodeProjectChat}
      onDeleteSession={async (session) => {
        await fetch(`/api/chat/conversation/${encodeURIComponent(session.id)}`, { method: "DELETE" });
        await loadSessions();
      }}
    />
  );

  const list = undefined;

  const terminalDetail = (
    <div
      className={[
        "h-full min-h-0 flex flex-col",
        mode === "terminal"
          ? "relative"
          : "pointer-events-none invisible absolute inset-0 opacity-0",
      ].join(" ")}
      aria-hidden={mode !== "terminal"}
    >
      <ComuxView
        view="terminal"
        active={mode === "terminal"}
        sessions={sessions}
        onOpenSession={(sessionId, familiarId) => {
          openFamiliarSession(sessionId, familiarId);
        }}
        onNewChat={openProjectChat}
      />
    </div>
  );

  const detail = (
    <div className="cave-mode-fade relative h-full min-h-0 flex flex-col overflow-hidden">
      <h1 className="sr-only">{WORKSPACE_MODE_TITLES[mode] ?? "Coven Cave"}</h1>
      {terminalDetail}
      {mode === "terminal" ? null : mode === "agents" ? (
      <FamiliarsView
        familiars={familiars}
        sessions={sessions}
        activeFamiliar={active}
        daemonRunning={daemonRunning}
        responseNeeded={responseNeeded}
        onStartChat={(familiarId) => startFamiliarChat(familiarId)}
        onOpenSession={(sessionId, familiarId) => openFamiliarSession(sessionId, familiarId)}
        onOpenMemoryFile={(path) => {
          window.location.hash = `memory:${encodeURIComponent(path)}`;
        }}
        onOpenOnboarding={openOnboarding}
        onOpenUrl={openUrlInAppBrowser}
        onFamiliarCreated={(id) => {
          void loadFamiliars();
          selectFamiliar(id);
        }}
      />
    ) : mode === "chat" ? (
      <ChatSurface
        familiars={familiars}
        sessions={sessions}
        activeFamiliar={active}
        activeFamiliarId={activeId}
        daemonRunning={daemonRunning}
        routerRef={routerRef}
        sessionsLoaded={sessionsLoaded}
        inboxItems={inboxItemsWithEphemeral}
        inspectorOpen={inspectorOpen}
        rightPanel={rightPanel}
        pendingProjectRoot={pendingProjectChatRoot}
        pendingChatAction={pendingChatAction}
        onSetInspectorOpen={setInspectorOpen}
        onSetRightPanel={setRightPanel}
        onSetActiveFamiliar={setActiveId}
        onClearPendingProjectRoot={() => setPendingProjectChatRoot(null)}
        onPendingChatActionHandled={() => setPendingChatAction(null)}
        onSessionStarted={loadSessions}
        onSlashFromChat={handleSlashIntent}
        onOpenOnboarding={openOnboarding}
        onOpenInbox={() => setMode("inbox")}
        onCreateReminder={openReminderForFamiliar}
        onOpenInboxItem={openInspectorInboxItem}
        onInboxItemChanged={refreshInbox}
        onSessionsChanged={loadSessions}
        onOpenTask={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
        onOpenUrl={openUrlInAppBrowser}
      />
    ) : mode === "groupchat" ? (
      <GroupChatView
        familiars={resolvedFamiliars}
        onSessionStarted={loadSessions}
        onOpenUrl={openUrlInAppBrowser}
      />
    ) : mode === "code" ? (
      <CodeView
        chat={
          <ChatSurface
            surface="code"
            familiars={familiars}
            sessions={sessions}
            activeFamiliar={active}
            activeFamiliarId={activeId}
            daemonRunning={daemonRunning}
            routerRef={routerRef}
            sessionsLoaded={sessionsLoaded}
            inboxItems={inboxItemsWithEphemeral}
            inspectorOpen={inspectorOpen}
            rightPanel={rightPanel}
            pendingProjectRoot={pendingProjectChatRoot}
            pendingChatAction={pendingChatAction}
            onSetInspectorOpen={setInspectorOpen}
            onSetRightPanel={setRightPanel}
            onSetActiveFamiliar={setActiveId}
            onClearPendingProjectRoot={() => setPendingProjectChatRoot(null)}
            onPendingChatActionHandled={() => setPendingChatAction(null)}
            onSessionStarted={loadSessions}
            onSlashFromChat={handleSlashIntent}
            onOpenOnboarding={openOnboarding}
            onOpenInbox={() => setMode("inbox")}
            onCreateReminder={openReminderForFamiliar}
            onOpenInboxItem={openInspectorInboxItem}
            onInboxItemChanged={refreshInbox}
            onSessionsChanged={loadSessions}
            onOpenTask={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
            onOpenUrl={openUrlInAppBrowser}
          />
        }
        comux={
          <ComuxView
            view="projects"
            active={mode === "code"}
            storageNamespace=":code"
            rightView={codeRightView}
            onRightViewChange={setCodeRightView}
            hideProjectNavigator
            hideFileTree
            sessions={sessions}
            onOpenSession={(sessionId, familiarId) => {
              openFamiliarSession(sessionId, familiarId);
            }}
            onNewChat={openCodeProjectChat}
          />
        }
      />
    ) : mode === "library" ? (
      <LibraryView
        onOpenUrl={openUrlInAppBrowser}
        sessions={sessions}
        onOpenSession={openFamiliarSession}
        onNewProjectChat={openProjectChat}
      />
    ) : mode === "board" ? (
      <BoardView
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={activeId}
        scopeFamiliarIds={scopeIds}
        onOpenUrl={openUrlInAppBrowser}
        onJumpToSession={(sessionId, familiarId) => {
          openFamiliarSession(sessionId, familiarId);
        }}
      />
    ) : mode === "journal" ? (
      <JournalView familiars={familiars} activeFamiliarId={activeId} scopeFamiliarIds={scopeIds} />
    ) : mode === "inbox" || mode === "calendar" ? (
      // Calendar and Automations are one Automations surface: Calendar is the
      // leading tab of the Automations view. The "calendar" mode still resolves
      // here (nav button / deep links) but opens that tab; keying on the mode
      // remounts so the deep link lands on it.
      <InboxEscalationsView
        key={mode}
        initialTab={mode === "calendar" ? "calendar" : "all"}
        onOpenSource={(item) => {
          if (item.sourceSessionKey) {
            openFamiliarSession(item.sourceSessionKey);
          } else if (item.sourceUrl) {
            openUrlInAppBrowser(item.sourceUrl);
          }
        }}
        familiars={familiars}
        activeFamiliarId={activeId}
        onNewReminder={() => openReminderModal()}
        onOpenSession={(sessionId, familiarId) => {
          openFamiliarSession(sessionId, familiarId);
        }}
        onEditReminder={(item) => {
          setEditingReminder(item);
          setReminderModalOpen(true);
        }}
        onOpenLink={openReminderLink}
        calendarSlot={
          <CalendarView
            items={inboxItems}
            familiars={familiars}
            activeFamiliarId={calendarFamiliarId}
            scopeFamiliarIds={scopeIds}
            deadlines={boardDeadlines}
            onOpenDeadline={(id) => {
              setMode("board");
              window.dispatchEvent(new Event("cave:board:reload"));
              window.location.hash = `card-${id}`;
            }}
            onAddEntry={(defaults) => {
              openReminderModal(
                defaults?.title ?? "",
                defaults?.whenText ?? "",
                defaults?.fireAt ?? "",
              );
            }}
            onOpenItem={(item) => {
              if (item.sessionId) {
                openFamiliarSession(item.sessionId, item.familiarId);
              }
            }}
            onComplete={completeInboxItem}
            onDismiss={dismissInboxItem}
            onSnooze={snoozeInboxItem}
            onReschedule={rescheduleInboxItem}
          />
        }
      />
    ) : mode === "browser" ? (
      <BrowserPane ref={browserPaneRef} label="main" activeFamiliarId={active?.id ?? null} />
    ) : mode === "github" ? (
      <GitHubView
        onJumpToSession={openFamiliarSession}
        onFocusCard={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
      />
    ) : mode === "roles" || mode === "capabilities" ? (
      // Capabilities is the rightmost tab of the Roles page. The "capabilities"
      // mode still resolves here (deep links / navigate-mode) but opens that
      // tab; keying on the mode remounts so the deep link lands on it.
      <PluginsView
        key={mode}
        tabs={["roles", "skills", "marketplace", "capabilities"]}
        initialTab={mode === "capabilities" ? "capabilities" : "roles"}
        activeHarness={active?.harness ?? null}
        familiars={resolvedFamiliars}
        onOpenChat={(familiarId) => startFamiliarChat(familiarId)}
        onCreateSkill={() => setMode("capabilities")}
      />
    ) : mode === "submissions" ? (
      <OpenCovenSubmissionPage />
    ) : mode === "flow" ? (
      <FlowView />
    ) : mode === "evals" || mode === "retro" ? (
      <EvalsView familiars={resolvedFamiliars} activeFamiliarId={mode === "retro" ? retroFamiliarId : activeId} />
    ) : (
      <HomeComposer
        familiars={familiars}
        activeFamiliarId={activeId}
        sessions={sessions}
        onSetActiveFamiliar={setActiveId}
        onStartChat={(prompt, fid, projectRoot) => startFamiliarChat(fid, projectRoot, prompt)}
        onNavigateToBoard={() => setMode("board")}
        onToast={pushToast}
        onSlash={(command, args) => onPaletteIntent({ kind: "slash", command, args })}
        onOpenSession={(sessionId, familiarId) => openFamiliarSession(sessionId, familiarId)}
      />
    )}
    </div>
  );

  const mobileTabs = (
    <MobileBottomTabs
      mode={mode}
      onSelect={(id) => setMode(id as WorkspaceMode)}
      inboxBadgeCount={inboxBadgeCount}
    />
  );
  // The standalone "Manage familiars" drawer is gone — Settings → Familiars is
  // the single source of truth. `redirectToSettings` routes every
  // openFamiliarStudio(...) trigger (cards, switcher, onboarding) there.
  return (
    <FamiliarStudioProvider redirectToSettings>
      <Shell
        ref={shellRef}
        mobileTabs={mobileTabs}
        // While a video is playing in the rail, collapsing the right panel
        // leaves a thin peek strip (rotated video) instead of closing fully.
        rightPanelPeek={showCompanionRail && railVideoActive}
        onFamiliarOpenChange={(open) => {
          setFamiliarPanelOpen(open);
          if (activeId) setRailOpen(activeId, open);
        }}
        topBar={({ navDrawerOpen, listDrawerOpen, familiarDrawerOpen }) => (
          <>
            <FamiliarMenuBar
              familiars={resolvedFamiliars}
              activeFamiliarId={activeId}
              selectedFamiliarIds={scopeIds}
              sessions={sessions}
              responseNeeded={responseNeeded}
              taskCount={boardTaskCount}
              inboxCount={inboxBadgeCount}
              onOpenSearch={() => setPaletteOpen(true)}
              searchQuery={topSearchQuery}
              onSearchQueryChange={(query) => {
                setTopSearchQuery(query);
                setPaletteOpen(true);
              }}
              onSelectFamiliar={selectFamiliarScope}
              onViewTasks={() => setMode("board")}
              onEnrichTasks={handleEnrichTasks}
              enrichingTasks={enrichingTasks}
              enrichProgress={enrichProgress}
              onViewInbox={() => setMode("inbox")}
            />
            <TopBar
              onOpenPalette={() => setPaletteOpen(true)}
              searchQuery={topSearchQuery}
              onSearchQueryChange={(query) => {
                setTopSearchQuery(query);
                setPaletteOpen(true);
              }}
              onOpenInbox={() => setMode("inbox")}
              onOpenSettings={() => nextRouter.push("/settings")}
              onOpenMobileHandoff={() => setMobileHandoffOpen(true)}
              inboxItems={inboxItemsWithEphemeral}
              familiars={familiars}
              activeFamiliar={resolvedFamiliars.find((f) => f.id === activeId) ?? null}
              familiarOptions={resolvedFamiliars}
              onSelectFamiliar={selectFamiliarScope}
              onEnrichTasks={handleEnrichTasks}
              enrichingTasks={enrichingTasks}
              enrichProgress={enrichProgress}
              onViewTasks={() => setMode("board")}
              taskCount={boardTaskCount}
              sessions={sessions}
              responseNeeded={responseNeeded}
              familiarSwitcherLabeled={mode === "chat"}
              inboxPrefs={inboxPrefs}
              inboxBadgeCount={inboxBadgeCount}
              onOpenInboxItem={(item) => {
                if (item.sessionId) openFamiliarSession(item.sessionId, item.familiarId);
                else setMode("inbox");
              }}
              onNotificationPrefsChanged={refreshPrefs}
              onToggleNav={() => shellRef.current?.toggleNav()}
              onToggleList={list ? () => shellRef.current?.toggleList() : undefined}
              navDrawerOpen={navDrawerOpen}
            listDrawerOpen={listDrawerOpen}
            familiarDrawerOpen={familiarDrawerOpen}
            onToggleFamiliar={
              showCompanionRail
                ? () => {
                    openCompanionTab(railTab === "browser" ? "browser" : "salem");
                  }
                : undefined
            }
          />
          </>
        )}
        nav={mode === "code" ? codeSidebar : sidebar}
        list={list}
        detail={detail}
        agent={
          showCompanionRail ? (
            <CompanionRail
              familiar={active}
              defaultTab={railTab}
              activeTab={railTab}
              onTabChange={persistRailTab}
              chatBadge={active ? responseNeeded.has(active.id) : false}
              daemonRunning={daemonRunning}
              onCreateFamiliar={openOnboarding}
              youtubeActive={railVideoActive}
              onYoutubeActiveChange={setRailVideoActive}
              // When the panel is collapsed (peek) with video on, show only the
              // rotated video strip; the top-bar toggle / this button re-expand.
              videoStrip={railVideoActive && !familiarPanelOpen}
              onExpandRail={() => shellRef.current?.openFamiliar()}
              hideChatTab={mode === "chat"}
              // Chat surface already shows a "Choose a familiar" CTA in the
              // detail panel — suppress the rail's duplicate prompt there.
              suppressEmpty={mode === "chat"}
              // Empty scope set = "All familiars" is selected (not a missing
              // pick) — the rail must not pitch "Create familiar" in that case.
              scopeIsAll={scopeIds.size === 0}
              chatSlot={
                <FamiliarPanel
                  familiar={active}
                  sessions={sessions}
                  daemonRunning={daemonRunning}
                  onSessionStarted={loadSessions}
                  onSlashFromChat={handleSlashIntent}
                  onOpenOnboarding={openOnboarding}
                />
              }
              memorySlot={
                <RailInspector familiar={active} onOpenFullView={() => setMode("agents")} />
              }
              browserSlot={
                <BrowserPane ref={companionBrowserPaneRef} label="companion" activeFamiliarId={active?.id ?? null} />
              }
              salemSlot={
                <SalemChatPanel
                  familiarId={active?.id ?? familiars.find((f) => f.id === "salem")?.id ?? "salem"}
                  model={active?.model ?? familiars.find((f) => f.id === "salem")?.model ?? null}
                />
              }
            />
          ) : undefined
        }
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={activeId}
        initialQuery={topSearchQuery}
        onQueryChange={setTopSearchQuery}
        onIntent={onPaletteIntent}
        addons={addons}
      />

      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <OnboardingOverlay open={onboardingOpen} onDismiss={closeOnboarding} />

      <NewReminderModal
        open={reminderModalOpen}
        onClose={() => {
          setReminderModalOpen(false);
          setEditingReminder(null);
        }}
        familiars={familiars}
        defaultFamiliarId={activeId}
        defaultFireAt={reminderModalDefaults.fireAt}
        defaultWhenText={reminderModalDefaults.whenText}
        defaultTitle={reminderModalDefaults.title}
        editing={
          editingReminder
            ? {
                id: editingReminder.id,
                title: editingReminder.title,
                fireAt: editingReminder.fireAt ?? new Date().toISOString(),
                recurrence: editingReminder.recurrence,
                link: editingReminder.link ?? null,
              }
            : undefined
        }
        onUpdate={async (id, draft) => {
          await fetch(`/api/inbox/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: draft.title,
              fireAt: draft.fireAt,
              recurrence: draft.recurrence ?? { type: "none" },
              link: draft.link ?? null,
            }),
          });
          // SSE `updated` event refreshes the row; mirror the create path.
        }}
        onCreate={async (draft) => {
          await fetch("/api/inbox", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "reminder",
              title: draft.title,
              body: draft.body,
              fireAt: draft.fireAt,
              familiarId: draft.familiarId,
              recurrence: draft.recurrence ?? { type: "none" },
              link: draft.link ?? null,
              source: "user",
            }),
          });
          // SSE `created` event will append the row; no manual refresh needed.
        }}
      />

      <InboxToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onSnooze={snoozeToast}
        onOpen={openToastTarget}
      />

      <MagicTriggers />

      <FamiliarGlyphPicker
        open={glyphPickerFor !== null}
        familiar={glyphPickerFor}
        onClose={() => setGlyphPickerFor(null)}
      />

      <ChooserModal
        open={addChooserOpen}
        onClose={() => setAddChooserOpen(false)}
        breadcrumb={["CovenCave", "Add"]}
        options={
          [
            {
              id: "reminder",
              icon: "ph:alarm-bold",
              title: "Reminder",
              description: "Schedule a reminder to fire at a specific time.",
            },
            {
              id: "board-card",
              icon: "ph:kanban",
              title: "Board card",
              description: "Queue work for a familiar on the board.",
            },
            {
              id: "familiar",
              icon: "ph:sparkle",
              title: "Familiar",
              description: "Run setup to scaffold a new familiar.",
            },
          ] as ChooserOption[]
        }
        onPick={(id) => {
          if (id === "reminder") openReminderModal();
          else if (id === "board-card") setMode("board");
          else if (id === "familiar") openOnboarding();
        }}
      />

      <MobileHandoffModal
        open={mobileHandoffOpen}
        onClose={() => setMobileHandoffOpen(false)}
        mobileModeEnabled={mobileModeEnabled}
        nativeHost={mobileModeHost}
        mobileModeError={mobileModeError}
        onMobileModeChange={setMobileModeEnabled}
      />
    </FamiliarStudioProvider>
  );
}
