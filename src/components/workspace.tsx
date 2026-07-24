"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SidebarMinimal } from "@/components/sidebar-minimal";
import { stampFirstOpenOnce } from "@/lib/first-run-stamps";
import { groupInboxFeed, unreadInboxCount } from "@/lib/inbox-feed";
import { parseGitHubItemUrl, type GitHubItemTarget } from "@/lib/github-item-url";
import { filterDeletedSessions, recordDeletedSessionIds } from "@/lib/session-list-deletes";
import { sameSessionList } from "@/lib/session-list-equal";
import { invalidateConversation } from "@/lib/conversation-cache";
import { arrayContentEqual } from "@/lib/array-content-equal";
import type { ChatRouterHandle } from "@/components/chat-router";
import {
  isWorkspaceMode,
  resolveWorkspaceModeAlias,
  type CanonicalWorkspaceMode,
  type WorkspaceMode as WorkspaceModeFromDaemon,
} from "@/lib/workspace-mode";
import { clearChatHash, clearModeParam, readChatHash, readModeParam } from "@/lib/workspace-url-state";
import type { PaletteIntent } from "@/components/command-palette";
// Journal retired as an in-shell surface (redirects to Settings → Familiars),
// so JournalView is gone; Grimoire is a new in-shell surface from main.
import type { CalendarDeadline } from "@/components/calendar-view";
import { CaveBackdropLayer } from "@/components/cave-backdrop-layer";
import { readMobileModeEnabled, writeMobileModeEnabled } from "@/lib/mobile-mode-pref";
import { reconcileMobileModeRequest } from "@/lib/mobile-mode-reconcile";
import {
  shouldApplyStartupOnboardingStatus,
  type OnboardingStatusPayload,
} from "@/lib/onboarding-gate";
import { draftFromSlashArgs } from "@/lib/reminder-slash-draft";
import { InboxToastStack, toastFromItem, type Toast } from "@/components/inbox-toast";
import { MagicTriggers } from "@/components/magic-triggers";
import { Shell, type ShellHandle } from "@/components/shell";
import type { DetailSplitTile } from "@/components/detail-split-host";
import { MobileBottomTabs } from "@/components/mobile-bottom-tabs";
import { Icon } from "@/lib/icon";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { FamiliarStudioProvider, openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import { useSurfacePreference } from "@/lib/surface-preferences";
import { surfacePreferenceSpecs } from "@/lib/surface-preference-specs";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  getFamiliarScope,
  setFamiliarScope,
  getLastSurface,
  setLastSurface,
} from "@/lib/familiar-memory";
import { toggleFamiliarSelection } from "@/lib/familiar-multiselect";
import { readCelebrationsEnabled } from "@/lib/celebrations-pref";
import { useMilestoneWatch } from "@/lib/use-milestone-watch";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useSurfaceWarmup } from "@/lib/use-surface-warmup";
import { classifyDaemonStatusPoll } from "@/lib/daemon-status-classification";
import {
  createDaemonDesktopAutoStartCoordinator,
  createDaemonStatusRequestGate,
  runWorkspaceDaemonStart,
} from "@/lib/daemon-desktop-auto-start";
import { waitForDaemonUpdateIdle } from "@/lib/app-update-daemon";
import { useTauriPlatform } from "@/lib/tauri-platform";
import type { BrowserPaneHandle } from "@/components/browser-pane";
// Heavy, mode-gated surfaces are code-split via @/components/lazy-surfaces so
// their chunks (and deps like @xyflow/react, @uiw/react-codemirror) load on
// first open instead of shipping in the main bundle. See lazy-surfaces.tsx.
import {
  BoardView,
  BrowserPane,
  CalendarView,
  CommandPalette,
  FamiliarsView,
  FamiliarWorkQueueView,
  FamiliarGlyphPicker,
  CodeView,
  GrimoireView,
  InboxEscalationsView,
  MarketplaceView,
  MobileHandoffModal,
  NewReminderModal,
  OnboardingOverlay,
  OpenCovenSubmissionPage,
  RailInspector,
  SalemChatPanel,
  AskSalemView,
  ShortcutsSheet,
} from "@/components/lazy-surfaces";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { CHAT_OPEN_PROJECTS_EVENT, CHAT_FOCUS_PROJECT_EVENT, CHAT_OPEN_COVEN_EVENT, markCovenTabPending, markProjectsTabPending } from "@/lib/chat-tab-events";
import { HomeComposer } from "@/components/home-composer";
import { ChatSurface } from "@/components/chat-surface";
import { nativeNotify } from "@/lib/native-notify";
import type { InboxItem, LinkRef } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import {
  dailySummaryAutoKey,
  dateSlug,
  ensureDailySummaryNotification,
} from "@/lib/daily-summary-notifications";
import {
  DAILY_REFRESH_POLL_MS,
  dailySummarySignature,
  shouldRefreshDailySummary,
} from "@/lib/daily-summary-refresh";
import {
  NARRATIVE_RETRY_MS,
  generateDailyNarrative,
  shouldRegenerateNarrative,
} from "@/lib/daily-narrative";
import type { Familiar, SessionRow } from "@/lib/types";
import {
  getRoleSurface,
  isRoleSurfaceMode,
  parseRoleSurfaceMode,
  roleSurfaceMode,
  type RoleSurfaceMode,
} from "@/lib/role-surfaces";
import { useRoleSurfaceSession } from "@/lib/use-role-surfaces";
import { RoleSurfaceHost } from "@/components/role-surface-host";
// Role Surfaces self-register via this manifest — the shell only ever handles
// the generic `surface:<id>` mode and never names a role.
import "@/components/role-surfaces/register";
import type { InitialCommandControls } from "@/lib/command-controls";
import { normalizeGitHubTasks, type GitHubTask } from "@/lib/github-tasks";
import { attachGitHubTaskContext } from "@/lib/workspace-github-task-context";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { useShellBanners } from "@/lib/shell-banners";
import { TopBar } from "@/components/top-bar";
import { FamiliarMenuBar } from "@/components/familiar-menu-bar";
import { RunningSessionsPopover } from "@/components/running-sessions-popover";
import { NotificationBell } from "@/components/notification-bell";
import { StatusBar } from "@/components/status-bar";
import { sessionStatusTone } from "@/lib/session-status";
import { sessionPrStatus } from "@/lib/session-pr-status";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import { FirstProjectGate } from "@/components/first-project-gate";
import { resolveFirstProjectGatePolicy } from "@/lib/first-project-gate-policy";
import {
  clearPendingFirstProjectAccessSnapshot,
  readPendingFirstProjectAccessSnapshot,
  resolvePendingFirstProjectAccessSnapshot,
  type PendingFirstProjectAccessSnapshot,
} from "@/lib/first-project-gate-retry";
import type { PendingChatAction } from "@/lib/pending-chat-action";
import { consumePendingAgentsNewChat } from "@/lib/agents-new-chat";
import type { PendingCodeOpen } from "@/lib/pending-code-open";
import type { ChatAttachment } from "@/lib/chat-attachments";
import { startVoiceConversation, voiceChatStartErrorMessage } from "@/lib/voice/start-voice-chat";
import {
  OPEN_IN_APP_BROWSER_EVENT,
  PENDING_IN_APP_BROWSER_URL_KEY,
} from "@/lib/open-external";
import { deactivateAllNativeBrowserWebviews } from "@/lib/native-browser-lifecycle";
import {
  consumeBrowserNavigation,
  enqueueBrowserNavigation,
  type BrowserNavigationRequest,
} from "@/lib/browser-navigation-queue";
import {
  addSecondaryWorkspaceTile,
  removeSecondaryWorkspaceTile,
} from "@/lib/workspace-tiles";
import { useArchivedFamiliars } from "@/lib/cave-familiar-archive";
import { useProjects } from "@/lib/use-projects";
import { publishSchedulesChanged } from "@/lib/board-cache-events";
import {
  resolveLoadedActiveFamiliarId,
  resolveWorkspaceActiveFamiliarId,
} from "@/lib/active-familiar";

type WorkspaceMode = WorkspaceModeFromDaemon;

// Everything the primary detail pane can show: the built-in workspace modes
// plus registered Role Surfaces via the generic `surface:<id>` mode.
type CaveMode = WorkspaceMode | RoleSurfaceMode;

// What the drag-to-split secondary pane is showing: either a draggable page
// (a workspace mode) or one of the companion surfaces (Salem / Memory /
// Browser) that were re-homed here when the right rail was removed.
type SplitTarget =
  | { kind: "page"; mode: WorkspaceMode }
  | { kind: "salem" }
  | { kind: "memory" }
  | { kind: "browser" };

const SPLIT_COMPANION_TITLES: Record<Exclude<SplitTarget["kind"], "page">, string> = {
  salem: "Salem",
  memory: "Memory",
  browser: "Browser",
};

function splitTargetKey(target: SplitTarget): string {
  return target.kind === "page" ? `page:${target.mode}` : target.kind;
}

function splitTargetTitle(target: SplitTarget): string {
  return target.kind === "page" ? WORKSPACE_MODE_TITLES[target.mode] : SPLIT_COMPANION_TITLES[target.kind];
}

function splitTargetRendersMode(target: SplitTarget, mode: CanonicalWorkspaceMode): boolean {
  return target.kind === "page" && resolveWorkspaceModeAlias(target.mode) === mode;
}

// CHAT-D13-05 (axe page-has-heading-one): the shell renders no visible page
// title, so the detail pane carries a visually-hidden h1 naming the active
// surface. Labels mirror the sidebar's canonical vocabulary (issue #3283 —
// one surface, one name): alias modes that render another surface's view
// (calendar, familiar-work-queue) reuse that surface's name.
const WORKSPACE_MODE_TITLES: Record<WorkspaceMode, string> = {
  agents: "Familiars",
  home: "Home",
  chat: "Chat",
  groupchat: "Group Chat",
  board: "Tasks",
  calendar: "Rituals",
  inbox: "Rituals",
  browser: "Browser",
  github: "GitHub",
  code: "Code",
  roles: "Roles",
  marketplace: "Marketplace",
  flow: "Flow",
  submissions: "Submissions",
  capabilities: "Capabilities",
  "familiar-work-queue": "Tasks",
  journal: "Journal",
  grimoire: "Memories",
  salem: "Ask Salem",
};

// Chat deep links (CHAT-D9-01): `#chat-<sessionId>` re-enters a specific
// thread, same in-app hash idiom as `#card-<id>`.
// ChatRouter writes the hash (syncUrlHash); Workspace owns restore + popstate.
// GitHub task context is low-churn. At five minutes, uninterrupted idle
// foreground use makes at most 12 Cave requests/hour instead of piggybacking on
// the four-second session poll (~900/hour). usePausablePoll also pauses this in
// hidden windows and while the user is composing input.
const GITHUB_TASKS_POLL_MS = 5 * 60_000;

export function Workspace() {
  useSurfaceWarmup();
  const nextRouter = useRouter();
  const tauriPlatform = useTauriPlatform();
  const routerRef = useRef<ChatRouterHandle | null>(null);
  const shellRef = useRef<ShellHandle | null>(null);
  // ⌘J quick-chat launcher (cave-xsq.6): a ref so the global keydown effect
  // (declared above startFamiliarChat) can call it without a TDZ, and without
  // workspace self-dispatching a chat-nav event. Assigned in an effect below.
  const quickChatLaunchRef = useRef<() => void>(() => {});
  // Multiselect familiar scope. Empty set = "All familiars". `activeId` is the
  // derived single "primary" — the lone scoped id, or null when 0 or ≥2 are
  // selected — so all the existing single-familiar chrome/per-familiar state
  // behaves exactly as before at 0–1 selections; ≥2 is the new filter case.
  const [scopeIds, setScopeIds] = useState<Set<string>>(() => new Set());
  const requestedActiveId = scopeIds.size === 1 ? [...scopeIds][0]! : null;
  const archivedFamiliars = useArchivedFamiliars();
  // Back-compat shim for the call sites that scope to a single familiar (e.g.
  // opening a session) or clear to All: writes the multiselect set accordingly.
  const setActiveId = useCallback((id: string | null) => {
    setScopeIds(id == null ? new Set<string>() : new Set([id]));
  }, []);
  const [activeFamiliarHydrated, setActiveFamiliarHydrated] = useState(false);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const visibleFamiliars = useMemo(
    () => familiars.filter((familiar) => !(familiar.id in archivedFamiliars)),
    [familiars, archivedFamiliars],
  );
  // false until the first /api/familiars fetch settles (success or error) —
  // lets the chat boot view hold a quiet frame instead of flashing the
  // "choose a familiar" empty-state copy while the roster is in flight.
  const [familiarsLoaded, setFamiliarsLoaded] = useState(false);
  const [familiarRosterLoadedSuccessfully, setFamiliarRosterLoadedSuccessfully] = useState(false);
  const loadedActiveId = resolveLoadedActiveFamiliarId(requestedActiveId, visibleFamiliars);
  const activeId = resolveWorkspaceActiveFamiliarId(
    requestedActiveId,
    visibleFamiliars,
    familiarsLoaded,
    familiarRosterLoadedSuccessfully,
  );
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const {
    projects: registeredProjects,
    loading: projectsLoading,
    error: projectsError,
    loadedSuccessfully: projectsLoadedSuccessfully,
    reload: reloadProjects,
    createProjectOrThrow,
  } = useProjects();
  const [familiarsError, setFamiliarsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  // false until the first /api/sessions/list fetch settles — lets the chat
  // list show a skeleton instead of flashing its empty state on boot.
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  // The last session-list load failed (cave-x6k5) — see loadSessions.
  const [sessionsError, setSessionsError] = useState(false);
  // Monotonic sequence guard for loadSessions (see its definition): the list is
  // scoped to the active familiar, and loadSessions re-fires on every scope
  // change, so a stale in-flight load must not paint the previous familiar's
  // sessions.
  const loadSessionsReqRef = useRef(0);
  const loadGitHubTasksReqRef = useRef(0);
  const loadGitHubTasksForceEpochRef = useRef(0);
  const loadGitHubTasksForceInFlightRef = useRef(0);
  const baseSessionsRef = useRef<SessionRow[]>([]);
  const locallyDeletedSessionIdsRef = useRef<Set<string>>(new Set());
  const githubTasksRef = useRef<GitHubTask[] | null>(null);
  const [daemonRunning, setDaemonRunning] = useState<boolean>(false);
  const { pushBanner, dismissBanner } = useShellBanners();
  const [responseNeeded, setResponseNeeded] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [topSearchQuery, setTopSearchQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Home-first boot: every fresh launch (desktop app window or web tab)
  // opens on the Home surface — the daily overview with the universal
  // composer — per operator direction (this reverses cave-hsa6's chat-first
  // boot). Chat stays one step away (⌘2 / nav / the composer submit), and
  // deep links (?mode=, #chat-…) and cave:navigate-mode override this as
  // before, so restored sessions and share links still land where they point.
  const [mode, setModeRaw] = useState<CaveMode>("home");
  // Which tab the Grimoire surface shows. Lifted here so the Journal nav row can
  // route straight into Grimoire's Journal tab (see the setMode `journal` branch)
  // and so the choice persists across Grimoire remounts within a session.
  const [grimoireView, setGrimoireView] = useSurfacePreference(surfacePreferenceSpecs.grimoire.view);
  const [, setBoardViewMode] = useSurfacePreference(surfacePreferenceSpecs.board.viewMode);
  // Alias funnel: MODE_ALIASES (src/lib/workspace-mode.ts) is the single
  // source of truth for where every compatibility mode lands. groupchat /
  // journal / flow are rewritten HERE so `mode` never holds them (Group Chat
  // is a tab inside the Chat surface; Journal a tab inside Memories; Flow is
  // retired). The other aliases (calendar, familiar-work-queue, roles,
  // capabilities) pass through untouched: the render branches mount their
  // canonical surface on the matching tab, keyed by the alias so deep links
  // remount onto it. workspace-alias-modes.test.ts pins these branches to
  // the table.
  const setMode = useCallback((next: CaveMode) => {
    // Native child WebViews render above React. Deactivate the primary pane
    // before committing a non-Browser surface so there is no paint where the
    // old WebView can intercept the new surface's first clicks.
    if (modeRef.current === "browser" && next !== "browser") {
      deactivateAllNativeBrowserWebviews("main");
    }
    if (next === "groupchat") {
      // Set the latch synchronously so a freshly-mounting ChatSurface opens the
      // Group tab on mount; the event covers an already-mounted ChatSurface.
      markCovenTabPending();
      setModeRaw("chat");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_COVEN_EVENT)), 0);
      return;
    }
    if (next === "journal") {
      // Journal is now a tab inside the Grimoire surface. Every entry point
      // (sidebar row, ⌘K palette, ?mode= deep link, cave:navigate-mode,
      // dashboard links) funnels through setMode, so opening Grimoire on its
      // Journal tab here covers them all. (Per-familiar journals still live in
      // Settings → Familiars → Journal.)
      setGrimoireView("journal");
      setModeRaw("grimoire");
      return;
    }
    if (next === "flow") {
      // FlowView is retired (lives on feature/automations-flow); "flow" has no
      // render branch, so an unremapped request fell through to Home with the
      // wrong sr-title and no nav highlight (cave-hyor). The remap lives HERE —
      // the single choke point — so ?mode=flow deep links, cave:navigate-mode,
      // and last-mode restore all land on Schedules.
      setModeRaw("inbox");
      return;
    }
    setModeRaw(next);
  }, []);
  // Chat mode replaces the global nav with the project-grouped Chats sidebar.
  // Its Home button exits Chat, restoring the normal navigation.
  // Whether the first daemon status poll has resolved. Until it has, the daemon
  // state is *unknown* (not "offline"), so the offline banner must stay hidden.
  const [daemonStatusResolved, setDaemonStatusResolved] = useState(false);
  // Sticky offline signal for the banner. A crash-looping / codesigning-zombie
  // daemon flaps: it briefly answers health (running:true) then dies again. The
  // banner keys off this instead of the raw per-poll status so a single transient
  // "running" doesn't flicker it away — it shows on the first definitive local-
  // offline poll and only clears after the daemon is *consistently* healthy.
  const [daemonOffline, setDaemonOffline] = useState(false);
  // The access-token gate rejected our credential (401 on the status poll).
  // Distinct from daemonOffline: the daemon may be fine — WE can't see it, and
  // the fix is re-auth (reload to the gate page), not "Start daemon" (cave-wkp5).
  const [authExpired, setAuthExpired] = useState(false);
  const [daemonStatusUnavailable, setDaemonStatusUnavailable] = useState<string | null>(null);
  const daemonHealthyStreakRef = useRef(0);
  const daemonStatusRequestGateRef = useRef<ReturnType<typeof createDaemonStatusRequestGate> | null>(null);
  if (daemonStatusRequestGateRef.current === null) {
    daemonStatusRequestGateRef.current = createDaemonStatusRequestGate();
  }
  const startDaemonRef = useRef<() => Promise<void>>(async () => {});
  const daemonAutoStartCoordinatorRef = useRef<ReturnType<typeof createDaemonDesktopAutoStartCoordinator> | null>(null);
  if (daemonAutoStartCoordinatorRef.current === null) {
    daemonAutoStartCoordinatorRef.current = createDaemonDesktopAutoStartCoordinator(() => {
      void startDaemonRef.current();
    });
  }
  const browserPaneRef = useRef<BrowserPaneHandle>(null);
  const browserNavigationIdRef = useRef(Date.now() * 1024);
  const [browserNavigationQueue, setBrowserNavigationQueue] = useState<BrowserNavigationRequest[]>([]);

  const openUrlInAppBrowser = useCallback((url: string) => {
    if (!url) return;
    browserNavigationIdRef.current += 1;
    const request = { id: browserNavigationIdRef.current, url };
    setBrowserNavigationQueue((queue) => enqueueBrowserNavigation(queue, request));
    setMode("browser");
    shellRef.current?.dismissNavMobile();
  }, [setMode]);

  const acknowledgeBrowserNavigation = useCallback((request: BrowserNavigationRequest) => {
    setBrowserNavigationQueue((queue) => consumeBrowserNavigation(queue, request.id));
    if (window.sessionStorage.getItem(PENDING_IN_APP_BROWSER_URL_KEY) === request.url) {
      window.sessionStorage.removeItem(PENDING_IN_APP_BROWSER_URL_KEY);
    }
  }, []);

  // ── Mode-transition crossfade ──────────────────────────────────────────
  // The `.cave-mode-fade` CSS animation only plays on the wrapper's *initial*
  // mount. Re-firing it on a mode switch would need `key={mode}` on the
  // wrapper, which is deliberately forbidden — the key remounts keepalive
  // surfaces (it once killed the terminal's PTYs on every switch; pinned in
  // comux-view-terminal.test.ts). Instead, replay a short opacity fade on the
  // (persistent) wrapper via WAAPI whenever `mode` changes. Opacity-only, so it
  // never applies a transform and therefore never becomes the containing block
  // for position:fixed descendants (the cave-cco trap that forced 4 portal
  // workarounds). Skips the first run (initial entrance is the CSS animation)
  // and honors prefers-reduced-motion.
  const detailFadeRef = useRef<HTMLDivElement>(null);
  const modeFadeAnimRef = useRef<Animation | null>(null);
  const modeFadeReadyRef = useRef(false);
  useLayoutEffect(() => {
    if (!modeFadeReadyRef.current) {
      modeFadeReadyRef.current = true;
      return;
    }
    const el = detailFadeRef.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    modeFadeAnimRef.current?.cancel();
    modeFadeAnimRef.current = el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 120, easing: "ease-out" },
    );
  }, [mode]);
  // Drag-to-split: up to three secondary surfaces opened beside the primary
  // one (four visible pages total). Targets are draggable pages or companion
  // surfaces (Salem / Memory / Browser) re-homed from the removed right rail.
  // `splitSide` preserves the familiar 2-page left/right snap behavior.
  const [splitTargets, setSplitTargets] = useState<SplitTarget[]>([]);
  const [splitSide, setSplitSide] = useState<"left" | "right">("right");
  const addSplitTarget = useCallback((target: SplitTarget, side: "left" | "right" = "right") => {
    if (chatProjectBlockedRef.current && splitTargetRendersMode(target, "chat")) {
      setMode("home");
      return;
    }
    setSplitSide(side);
    setSplitTargets((prev) => addSecondaryWorkspaceTile(prev, target, splitTargetKey));
  }, []);
  const [pendingProjectChatRoot, setPendingProjectChatRoot] = useState<string | null>(null);
  const [pendingChatAction, setPendingChatAction] = useState<PendingChatAction>(null);
  // The session the chat surface is showing, mirrored as state so the sidebar
  // highlight moves the instant a row is clicked. Set optimistically by the
  // open/new-chat producers below and reconciled by ChatRouter's
  // onActiveSessionChange (new-chat promotion, back-to-list, in-router opens).
  // Never read routerRef.currentSessionId() during render for this — the
  // router applies opens in a deferred hop, so render-time ref reads always
  // lagged one update behind (the n-1 highlight bug).
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  // Mirror for the []-dep file-open listener below: opens raised mid-chat
  // attach the CURRENT session without re-subscribing on every change.
  const activeChatSessionIdRef = useRef<string | null>(null);
  activeChatSessionIdRef.current = activeChatSessionId;
  const [pendingCodeOpen, setPendingCodeOpen] = useState<PendingCodeOpen | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingResolved, setOnboardingResolved] = useState(false);
  const [autoFinishOnboarding, setAutoFinishOnboarding] = useState(false);
  // Lazy-load onboarding on first use, then keep its host mounted while closed.
  // Its refs and job polling intentionally survive close/reopen cycles so an
  // in-flight install is not forgotten and daemon auto-start stays one-shot.
  const [onboardingMounted, setOnboardingMounted] = useState(false);
  const [projectsInitiallyResolved, setProjectsInitiallyResolved] = useState(false);
  const [pendingFirstProjectGrant, setPendingFirstProjectGrant] = useState<PendingFirstProjectAccessSnapshot | null>(() => readPendingFirstProjectAccessSnapshot());
  const manualOnboardingOpenedRef = useRef(false);
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
    mutedKinds: [],
    sound: { mode: "default" },
  });
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [reminderModalDefaults, setReminderModalDefaults] = useState<{
    fireAt: string;
    title: string;
    whenText: string;
  }>({ fireAt: "", title: "", whenText: "" });
  const [editingReminder, setEditingReminder] = useState<InboxItem | null>(null);
  // Deep-link target for the native GitHub surface (a GitHub-event inbox
  // notification's PR/issue). GitHub lives on the Code surface's GitHub tab
  // (cave-m6ys), so the target survives within the whole surface — mode
  // "github" (the tab alias) or "code" — and clears on leaving it so a later
  // manual visit doesn't re-open a stale item.
  const [githubTarget, setGithubTarget] = useState<GitHubItemTarget | null>(null);
  useEffect(() => {
    if (mode !== "github" && mode !== "code" && githubTarget) setGithubTarget(null);
  }, [mode, githubTarget]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [glyphPickerFor, setGlyphPickerFor] = useState<Familiar | null>(null);
  const [mobileHandoffOpen, setMobileHandoffOpen] = useState(false);
  // Continue-on-phone (cave-i74f): the chat id riding the next handoff QR.
  const [mobileHandoffChatId, setMobileHandoffChatId] = useState<string | null>(null);
  const [mobileModeEnabled, setMobileModeEnabledState] = useState(readMobileModeEnabled);
  const [mobileModeHost, setMobileModeHost] = useState<string | null>(null);
  const [mobileModeError, setMobileModeError] = useState<string | null>(null);
  const responseNeededRef = useRef(responseNeeded);
  responseNeededRef.current = responseNeeded;
  // Deep-link target captured at mount, held until the async sessions fetch
  // settles (loadSessions → sessionsLoaded) so the restore can resolve it.
  const pendingChatDeepLinkRef = useRef<string | null>(readChatHash());
  // Render mirror of the ref: while the deep link awaits the sessions fetch
  // the shell shows an "Opening chat…" takeover instead of flashing Home —
  // that wait is ~2s warm but stretches under a cold dev-server compile.
  // The hash is only readable client-side, so the flag must start false to
  // match SSR's first render (seeding it from the ref made every #chat- URL
  // a hydration mismatch that regenerated the whole tree); the layout effect
  // flips it before first paint, so the takeover still shows without a
  // Home flash.
  const [chatDeepLinkPending, setChatDeepLinkPending] = useState(false);
  useLayoutEffect(() => {
    if (pendingChatDeepLinkRef.current !== null) setChatDeepLinkPending(true);
  }, []);
  // Refs for the popstate listener — sessions repoll every 4s and mode flips
  // often; the listener should not resubscribe on either.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // Daily-summary refresh state: the day key whose cycle we're in, the input
  // signature and time of the last POST attempt, and an in-flight latch. All
  // reset when the day key rolls over (midnight).
  const dailySummaryRequestedRef = useRef<string | null>(null);
  const dailySummarySignatureRef = useRef<string | null>(null);
  const dailySummaryAttemptAtRef = useRef(0);
  const dailySummaryInFlightRef = useRef(false);
  const narrativeInFlightRef = useRef(false);
  const narrativeAttemptAtRef = useRef(0);
  const sessionsLoadedRef = useRef(sessionsLoaded);
  sessionsLoadedRef.current = sessionsLoaded;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const setMobileModeEnabled = useCallback((enabled: boolean) => {
    writeMobileModeEnabled(enabled);
    setMobileModeEnabledState(enabled);
  }, []);

  const reconcileMobileMode = useCallback(async (enabled: boolean, options?: { force?: boolean; suppressError?: boolean }) => {
    const result = await reconcileMobileModeRequest(enabled, options);
    if (!result.ok) {
      // suppressError covers the one-time boot reconcile with the pref off:
      // the shared reconciler reports transport failures as !ok too, so both
      // the expected plain-web 503 and a fetch error stay silent there.
      if (!options?.suppressError) {
        setMobileModeError(result.stderr || result.error || "Mobile mode unavailable.");
      }
      if (!enabled) setMobileModeHost(null);
      return;
    }
    setMobileModeError(null);
    setMobileModeHost(enabled ? result.nativeHost ?? null : null);
  }, []);

  // Always reconcile once on boot, even when the persisted pref is off: Tailscale
  // Serve routes outlive the web UI process, so a stale route from a crash or
  // failed prior stop must be reset. Suppress only the boot-time disabled error
  // so plain-web sessions do not show a misleading mobile-mode failure. After
  // boot, disabled->disabled renders can skip, while enabled->disabled still
  // posts app-stop.
  const mobileModeWasEnabledRef = useRef(false);
  const didInitialMobileModeReconcileRef = useRef(false);
  useEffect(() => {
    const wasEnabled = mobileModeWasEnabledRef.current;
    const isInitialReconcile = !didInitialMobileModeReconcileRef.current;
    didInitialMobileModeReconcileRef.current = true;
    mobileModeWasEnabledRef.current = mobileModeEnabled;
    if (!mobileModeEnabled && !wasEnabled && !isInitialReconcile) return;
    void reconcileMobileMode(mobileModeEnabled, {
      suppressError: isInitialReconcile && !mobileModeEnabled,
    });
  }, [mobileModeEnabled, reconcileMobileMode]);
  // Recurring reconcile only while mobile mode is on; usePausablePoll pauses it
  // in a hidden tab and refreshes on return. The poll keeps ticking through
  // prerequisite failures — the shared reconciler's TTL breaker decides when a
  // tick becomes a real probe, so the status heals itself once Tailscale
  // comes up instead of latching stale until a manual Retry.
  usePausablePoll(() => void reconcileMobileMode(mobileModeEnabled), 60_000, {
    enabled: mobileModeEnabled,
  });

  // Milestone crossings → renown ledger → inbox toasts. Self-contained
  // (fetches its own unscoped roster/session data once per check).
  useMilestoneWatch();

  const refreshDaemonStatus = useCallback(async (opts?: { trusted?: boolean }) => {
    const requestGate = daemonStatusRequestGateRef.current!;
    const requestId = requestGate.begin();
    let result: ReturnType<typeof classifyDaemonStatusPoll>;
    let credentialAccepted = false;
    try {
      const res = await fetch("/api/daemon/status", { cache: "no-store" });
      const payload = await res.json().catch(() => null);
      result = classifyDaemonStatusPoll({
        responseStatus: res.status,
        responseOk: res.ok,
        payload,
      });
      // A real non-401 response proves the Cave credential is accepted again.
      credentialAccepted = res.status !== 401;
    } catch {
      result = classifyDaemonStatusPoll({
        responseStatus: 0,
        responseOk: false,
        payload: null,
        error: "status request failed",
      });
    }

    // An explicit refresh after Start can overtake an older background poll.
    // Only the newest request may publish state, or that stale offline result
    // can put the banner back after the daemon is already healthy.
    if (!requestGate.isLatest(requestId)) return;
    // The coordinator pins this first accepted decision. Later polls may update
    // live UI state, but can never turn into a delayed automatic restart.
    daemonAutoStartCoordinatorRef.current!.observeStatus(result);
    if (credentialAccepted) setAuthExpired(false);

    setDaemonStatusResolved(true);
    if (result.kind === "auth-expired") {
      setAuthExpired(true);
      setDaemonStatusUnavailable(null);
      return;
    }
    if (result.kind === "unavailable") {
      daemonHealthyStreakRef.current = 0;
      setDaemonStatusUnavailable(result.reason);
      return;
    }

    setDaemonStatusUnavailable(null);
    if (result.kind === "offline") {
      daemonHealthyStreakRef.current = 0;
      setDaemonRunning(false);
      setDaemonOffline(true);
      return;
    }

    setDaemonRunning(true);
    daemonHealthyStreakRef.current += 1;
    // A `trusted` refresh follows an explicit user-initiated start, so a
    // healthy answer is enough to clear the banner immediately — without it
    // the "Start daemon" banner lingered for a poll cycle (~5s) after the
    // daemon was already up.
    if (opts?.trusted) daemonHealthyStreakRef.current = 2;
    if (daemonHealthyStreakRef.current >= 2) setDaemonOffline(false);
  }, []);

  const startDaemon = useCallback(async () => {
    // The release-alignment trigger may be replacing the CLI after observing
    // this same offline state. Starting the old binary during that window can
    // lock coven.exe on Windows and make the update fail.
    await waitForDaemonUpdateIdle();
    await runWorkspaceDaemonStart({
      fetchImpl: fetch,
      dismissError: () => dismissBanner("daemon-start-error"),
      reportError: (message) => pushBanner({
        id: "daemon-start-error",
        severity: "error",
        title: `Daemon start failed — ${message}`,
      }),
      refreshStatus: refreshDaemonStatus,
    });
  }, [dismissBanner, pushBanner, refreshDaemonStatus]);
  startDaemonRef.current = startDaemon;

  useEffect(() => {
    daemonAutoStartCoordinatorRef.current!.observePlatform(tauriPlatform);
  }, [tauriPlatform]);

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
    if (
      !activeFamiliarHydrated
      || !familiarsLoaded
      || !familiarRosterLoadedSuccessfully
      || requestedActiveId === null
      || requestedActiveId === loadedActiveId
    ) return;
    setScopeIds(loadedActiveId ? new Set([loadedActiveId]) : new Set());
  }, [activeFamiliarHydrated, familiarsLoaded, familiarRosterLoadedSuccessfully, requestedActiveId, loadedActiveId]);

  useEffect(() => {
    // Salem was re-homed from the (removed) right rail into the drag-to-split
    // pane — its launcher now opens Salem beside the current surface.
    const openSalem = () => {
      addSplitTarget({ kind: "salem" });
    };
    window.addEventListener("cave:salem-open", openSalem);
    return () => window.removeEventListener("cave:salem-open", openSalem);
  }, [addSplitTarget]);

  // Cross-surface "create a familiar" bridge. The dock (and any deep surface
  // that can't reach openOnboarding directly) announces intent and the
  // Workspace opens onboarding — the full first-run flow. The Familiars page
  // also offers a lighter in-app "New familiar" dialog (POST /api/familiars)
  // for adding to an existing roster without re-running setup.
  useEffect(() => {
    const openCreate = () => {
      manualOnboardingOpenedRef.current = true;
      setAutoFinishOnboarding(false);
      setOnboardingOpen(true);
    };
    window.addEventListener("cave:onboarding-open", openCreate);
    return () => window.removeEventListener("cave:onboarding-open", openCreate);
  }, []);

  // `?mode=<WorkspaceMode>` deep link: external links can land directly on a
  // surface. Runs once on mount,
  // mirrors the hash deep-link idiom — switch then strip the param so reloads
  // and back/forward stay clean.
  useEffect(() => {
    const target = readModeParam();
    if (!target) return;
    setMode(target);
    clearModeParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `/#card-<id>` deep link (daily-report pages, dashboard action inbox):
  // BoardView is the only consumer of the card hash and it never mounts on
  // the boot-default Chat surface, so external card links opened the app and
  // silently dropped the card (cave-qnh2). Switch to the board; BoardView's
  // hash effect re-applies once cards load. Same treatment for `/#grimoire:`
  // (memory/knowledge/journal doc links from daily-report pages and shared
  // URLs): GrimoireView reads its hash on mount, so it only needs the mode
  // switch here (cave-aka2).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (/^#card-/.test(window.location.hash)) setMode("board");
    else if (window.location.hash.startsWith("#grimoire:")) setMode("grimoire");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // File/diff links land on the Code surface (cave-ohcj): every open — from
  // chat transcripts, the Projects hub, anywhere — routes into code mode with
  // the raising chat session attached so CodeView can select its workbench.
  // The event detail is preserved in state until CodeView mounts.
  useEffect(() => {
    const enqueue = (kind: PendingCodeOpen["kind"], e: Event) => {
      const detail = (e as CustomEvent<{ path?: string; line?: number }>).detail;
      if (!detail?.path) return;
      const sessionId = activeChatSessionIdRef.current ?? undefined;
      setPendingCodeOpen(
        kind === "files"
          ? { kind, path: detail.path, line: detail.line, sessionId, nonce: Date.now() }
          : { kind, path: detail.path, sessionId, nonce: Date.now() },
      );
      setMode("code");
    };
    const onOpenProjectFile = (e: Event) => enqueue("files", e);
    const onOpenFileDiff = (e: Event) => enqueue("changes", e);
    // Projects hub → "Browse files": carries a project ROOT (not a file path);
    // CodeView picks that project's newest session and browses its tree
    // (cave-z44's peek, re-homed on the Code surface).
    const onBrowseProjectFiles = (e: Event) => {
      const detail = (e as CustomEvent<{ root?: string }>).detail;
      if (!detail?.root) return;
      setPendingCodeOpen({ kind: "files", root: detail.root, nonce: Date.now() });
      setMode("code");
    };
    window.addEventListener("cave:open-project-file", onOpenProjectFile as EventListener);
    window.addEventListener("cave:open-file-diff", onOpenFileDiff as EventListener);
    window.addEventListener("cave:browse-project-files", onBrowseProjectFiles as EventListener);
    return () => {
      window.removeEventListener("cave:open-project-file", onOpenProjectFile as EventListener);
      window.removeEventListener("cave:open-file-diff", onOpenFileDiff as EventListener);
      window.removeEventListener("cave:browse-project-files", onBrowseProjectFiles as EventListener);
    };
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
  // it appears at the top of every surface, not just Chat. While the access
  // token is rejected the daemon state is unknowable — suppress this banner
  // in favour of the re-auth one (cave-wkp5).
  useEffect(() => {
    if (!daemonOffline || authExpired) {
      dismissBanner("daemon-offline");
      dismissBanner("daemon-start-error");
    } else if (daemonStatusResolved) {
      // Only show the offline banner once status has resolved to a definitive
      // local-offline result — never during the initial unknown window.
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
  }, [daemonOffline, daemonStatusResolved, authExpired, pushBanner, dismissBanner, startDaemon]);

  // A status-service failure, timeout, malformed response, or non-local target
  // problem does not prove the local daemon is stopped. Keep that uncertainty
  // accurate and retryable instead of offering the misleading Start daemon CTA.
  useEffect(() => {
    if (!daemonStatusUnavailable || authExpired || daemonOffline) {
      dismissBanner("daemon-status-unavailable");
      return;
    }
    pushBanner({
      id: "daemon-status-unavailable",
      severity: "warning",
      title: `Daemon status unavailable — ${daemonStatusUnavailable}`,
      cta: {
        label: "Retry",
        onClick: () => {
          void refreshDaemonStatus();
        },
      },
    });
  }, [daemonStatusUnavailable, authExpired, daemonOffline, pushBanner, dismissBanner, refreshDaemonStatus]);

  // Re-auth banner: the access-token gate is rejecting every request, so all
  // surfaces are degrading at once. A reload lands on the gate page, which
  // explains how to sign back in (paste a token / open the pairing link).
  useEffect(() => {
    if (!authExpired) {
      dismissBanner("auth-expired");
      return;
    }
    pushBanner({
      id: "auth-expired",
      severity: "error",
      title: "Access expired — this session's token is no longer valid. Reload to sign in again.",
      cta: {
        label: "Reload",
        onClick: () => {
          window.location.reload();
        },
      },
    });
  }, [authExpired, pushBanner, dismissBanner]);

  const loadFamiliars = useCallback(async () => {
    try {
      const res = await fetch("/api/familiars", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        // Keep the last-known-good roster: a failed load means "can't see the
        // familiars right now", not "there are none". Clearing here made three
        // surfaces show first-run copy over an intact roster (cave-atzv).
        setFamiliarsError(json.error ?? "daemon offline");
        setFamiliarRosterLoadedSuccessfully(false);
        return;
      }
      setFamiliarsError(null);
      setFamiliars((json.familiars ?? []) as Familiar[]);
      setFamiliarRosterLoadedSuccessfully(true);
    } catch (err) {
      setFamiliarsError(err instanceof Error ? err.message : "fetch failed");
      setFamiliarRosterLoadedSuccessfully(false);
    } finally {
      setFamiliarsLoaded(true);
    }
  }, []);

  // A roster load that failed (or raced the daemon's boot) self-heals once the
  // daemon is reachable again — without this, one transient failure left the
  // empty state up until an unrelated refresh event (cave-atzv).
  useEffect(() => {
    if (daemonRunning) void loadFamiliars();
  }, [daemonRunning, loadFamiliars]);
  // …and while an error IS showing, keep retrying quietly. The effect above
  // only fires on daemonRunning TRANSITIONS, so a one-off fetch flake with the
  // daemon already "running" (e.g. it restarts right after the first familiar
  // is summoned) stranded the error screen until a manual Retry (issue #2990).
  usePausablePoll(() => void loadFamiliars(), 4_000, {
    enabled: familiarsError !== null,
  });

  // Scope the view to a familiar. `null` clears to "All". With `opts.multi`
  // (⌘/Ctrl-click) the id is toggled in/out of the multiselect set; a plain
  // click replaces the scope with just that familiar (today's behavior).
  const selectFamiliarScope = useCallback((id: string | null, opts?: { multi?: boolean; preserveSurface?: boolean }) => {
    setScopeIds((prev) => (id == null ? new Set<string>() : toggleFamiliarSelection(prev, id, opts?.multi ?? false)));
    if (!id) return;
    // A multi-toggle shouldn't yank the surface around — only a plain single
    // select restores that familiar's last-viewed surface.
    if (opts?.multi || opts?.preserveSurface) return;
    const last = getLastSurface(id);
    // Guard against retired/unknown persisted modes (e.g. removed standalone
    // surfaces). Any real mode is safe to hand to setMode — its alias funnel
    // routes compatibility modes (flow, journal, groupchat, …) onto their
    // canonical surface via MODE_ALIASES (cave-nwi8, cave-m4ih.3).
    // A persisted Role Surface mode restores too — if this familiar no longer
    // holds the role, the visibility effect below falls back generically.
    if (last && (isWorkspaceMode(last) || isRoleSurfaceMode(last))) setMode(last as CaveMode);
  }, []);

  const selectFamiliar = useCallback((id: string) => {
    selectFamiliarScope(id);
  }, [selectFamiliarScope]);

  const loadGitHubTasks = useCallback(async (force = false) => {
    const reqId = ++loadGitHubTasksReqRef.current;
    const forceEpoch = force
      ? ++loadGitHubTasksForceEpochRef.current
      : loadGitHubTasksForceEpochRef.current;
    const startedDuringForcedRefresh = !force && loadGitHubTasksForceInFlightRef.current > 0;
    if (force) loadGitHubTasksForceInFlightRef.current += 1;
    try {
      const res = await fetch("/api/github/tasks", {
        method: force ? "POST" : "GET",
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      const superseded = force
        ? forceEpoch !== loadGitHubTasksForceEpochRef.current
        : startedDuringForcedRefresh ||
          forceEpoch !== loadGitHubTasksForceEpochRef.current ||
          reqId !== loadGitHubTasksReqRef.current;
      if (!res.ok || !json || json.ok === false || superseded) return;

      const tasks = normalizeGitHubTasks(json);
      githubTasksRef.current = tasks;
      setGithubAssignedCount(Array.isArray(json.tasks) ? json.tasks.length : 0);
      setSessions((currentSessions) => {
        const baseSessions = baseSessionsRef.current.length > 0
          ? baseSessionsRef.current
          : currentSessions;
        const visibleBaseSessions = filterDeletedSessions(baseSessions, locallyDeletedSessionIdsRef.current);
        const enriched = attachGitHubTaskContext(visibleBaseSessions, tasks);
        return sameSessionList(currentSessions, enriched) ? currentSessions : enriched;
      });
    } catch {
      // Keep the last-known-good count and session context. The next scheduled
      // or explicit refresh will retry without blanking GitHub metadata.
    } finally {
      if (force) loadGitHubTasksForceInFlightRef.current -= 1;
    }
  }, []);

  const loadSessions = useCallback(() => {
    // Sequence guard. loadSessions runs from mount, the 4s poll, the
    // familiars-refresh event, and — because `activeId` is a dep — re-fires
    // whenever the active-familiar SCOPE changes. It scopes the fetch to that
    // familiar's granted projects, so a load started under scope A that resolves
    // *after* the user switches to scope B would paint A's sessions under B
    // until the next poll healed it. A monotonic reqId (replacing the old
    // in-flight-promise dedup, which additionally *skipped* the new-scope load
    // while A was still in flight) drops every superseded load's writes, so only
    // the newest scope ever reaches state.
    const reqId = ++loadSessionsReqRef.current;
    const isCurrent = () => reqId === loadSessionsReqRef.current;

    return (async () => {
      let baseSessionsApplied = false;
      try {
        // Scope the session list to the active familiar's granted projects so
        // every surface fed by `sessions` enforces the familiar→projects map.
        // With "All familiars" (activeId null) the unscoped list is returned,
        // but we collapse the per-familiar workspace auto-journal/reflection
        // runs there: they'd otherwise flood the global list and make it look
        // contradictory versus the clean project-scoped familiar homes. Scoped
        // views already drop them via project-grant scoping, so collapse is only
        // applied to the unscoped view.
        const scope = activeId
          ? `?familiarId=${encodeURIComponent(activeId)}`
          : "?collapseFamiliarWorkspace=1";
        const sessionsResult = await fetch(`/api/sessions/list${scope}`, { cache: "no-store" });
        const json = await sessionsResult.json();
        if (!isCurrent()) return; // superseded by a newer load / scope change
        if (!json.ok) {
          // A failed list is NOT "no chats" — flag it so the chat list can
          // render a truthful can't-load state instead of the first-run
          // empty state (cave-x6k5). The 4s poll retries.
          setSessionsError(true);
          return;
        }

        setSessionsError(false);
        const baseSessions = filterDeletedSessions((json.sessions ?? []) as SessionRow[], locallyDeletedSessionIdsRef.current);
        baseSessionsRef.current = baseSessions;
        const visibleSessions = githubTasksRef.current
          ? attachGitHubTaskContext(baseSessions, githubTasksRef.current)
          : baseSessions;
        // The 4s poll rebuilds a fresh array each tick; keep the previous
        // reference when nothing changed so an unchanged list doesn't re-render
        // every sessions consumer (chat list, rails, badges) for nothing.
        setSessions((prev) => (sameSessionList(prev, visibleSessions) ? prev : visibleSessions));
        setSessionsLoaded(true);
        baseSessionsApplied = true;
      } catch {
        if (isCurrent()) setSessionsError(true); // transient — poll retries
      } finally {
        if (!baseSessionsApplied && isCurrent()) setSessionsLoaded(true);
      }
    })();
  }, [activeId]);

  const handleSessionsDeleted = useCallback((sessionIds: readonly string[]) => {
    const confirmedIds = recordDeletedSessionIds(locallyDeletedSessionIdsRef.current, sessionIds);
    if (confirmedIds.length === 0) return;

    baseSessionsRef.current = filterDeletedSessions(
      baseSessionsRef.current,
      locallyDeletedSessionIdsRef.current,
    );
    setSessions((currentSessions) => {
      const nextSessions = filterDeletedSessions(
        currentSessions,
        locallyDeletedSessionIdsRef.current,
      );
      return sameSessionList(currentSessions, nextSessions) ? currentSessions : nextSessions;
    });
    // Drop a highlight pointing at a deleted session; the sidebars guard by
    // row lookup anyway, but keep the mirrored state honest.
    setActiveChatSessionId((cur) => (cur && confirmedIds.includes(cur) ? null : cur));
    for (const sessionId of confirmedIds) invalidateConversation(sessionId);
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    loadFamiliars();
    loadSessions();
    void loadGitHubTasks();
  }, [loadFamiliars, loadSessions, loadGitHubTasks]);
  // Composers rebind a familiar's runtime through /api/config (the runtime
  // chip). Surfaces reading the roster's familiar.harness (e.g. the chat
  // empty-state identity line) shouldn't wait for the next natural reload —
  // the switch paths fire this event so the roster catches up immediately.
  useEffect(() => {
    const onFamiliarsRefresh = () => void loadFamiliars();
    window.addEventListener("cave:familiars-refresh", onFamiliarsRefresh);
    return () => window.removeEventListener("cave:familiars-refresh", onFamiliarsRefresh);
  }, [loadFamiliars]);
  usePausablePoll(() => void loadSessions(), 4000, {
    pauseWhileInputActive: true,
  });
  usePausablePoll(() => void loadGitHubTasks(), GITHUB_TASKS_POLL_MS, {
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

  // Keep prefs accessible to the SSE callback without re-subscribing on every
  // mute toggle.
  const inboxPrefsRef = useRef(inboxPrefs);
  inboxPrefsRef.current = inboxPrefs;

  // cave-fy1q phase 3: first-run funnel anchor — written once ever, and only
  // while onboarding is still undismissed (the lib guards both), so
  // time-to-first-reply measures fresh installs and never re-anchors old ones.
  useEffect(() => {
    stampFirstOpenOnce();
  }, []);

  // Subscribe to the inbox SSE stream: drives the inbox list, toasts, and
  // macOS system notifications. EventSource auto-reconnects on its own.
  useEffect(() => {
    const es = new EventSource("/api/inbox/stream");
    // Quiet delivery, not suppression: muted items still land in the inbox and
    // bell — they just skip the toast/native-notification/sound moment.
    const isMuted = (item: InboxItem) =>
      !!item.muted ||
      (!!item.familiarId &&
        inboxPrefsRef.current.mutedFamiliars.includes(item.familiarId)) ||
      (inboxPrefsRef.current.mutedKinds as readonly string[]).includes(item.kind);
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
      // Schedules consumes the same inbox data through a warmed, point-in-time
      // landing cache. Every authoritative stream event can make that cache
      // stale, even when Schedules itself is unmounted.
      publishSchedulesChanged();
      if (e.type === "snapshot") {
        // Reconnect snapshots usually carry what we already have — keep the
        // reference so inboxItemsWithEphemeral consumers don't re-render
        // (companion to #2762's content-equal guard on `updated` echoes).
        setInboxItems((prev) => (arrayContentEqual(prev, e.items) ? prev : e.items));
        return;
      }
      if (e.type === "created") {
        setInboxItems((prev) => [...prev, e.item]);
        // Celebrations off = clean-tool mode: milestone items still land in
        // the inbox (and the unread badge) but skip the toast + native ping.
        const quietedMilestone = e.item.kind === "milestone" && !readCelebrationsEnabled();
        if (e.item.status === "fired" && !isMuted(e.item) && !quietedMilestone) {
          setToasts((prev) => [...prev, toastFromItem(e.item)]);
          void nativeNotify(e.item.title, e.item.body, sound());
        }
        return;
      }
      if (e.type === "updated") {
        setInboxItems((prev) => {
          // The SSE broadcast that follows an optimistic complete/dismiss/
          // snooze delivers the same content back — bail on identity so every
          // consumer of inboxItemsWithEphemeral skips one redundant re-render
          // (cave-bzch).
          const idx = prev.findIndex((it) => it.id === e.item.id);
          if (idx === -1) return prev;
          if (JSON.stringify(prev[idx]) === JSON.stringify(e.item)) return prev;
          const next = prev.slice();
          next[idx] = e.item;
          return next;
        });
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

  // Keep today's report live: create it on first activity, then refresh it in
  // place whenever its inputs change (throttled server-writes; the report
  // freezes for good once the day key rolls over).
  const refreshDailySummary = useCallback(
    (force: boolean) => {
      if (!sessionsLoaded || dailySummaryInFlightRef.current) return;
      const now = new Date();
      const key = dailySummaryAutoKey(now);
      if (dailySummaryRequestedRef.current !== key) {
        // New day (or first run) — start a fresh refresh cycle.
        dailySummaryRequestedRef.current = key;
        dailySummarySignatureRef.current = null;
        dailySummaryAttemptAtRef.current = 0;
      }
      const signature = dailySummarySignature({ items: inboxItems, sessions, now });
      const hasItem = inboxItems.some((item) => item.auto === key);
      const refresh = shouldRefreshDailySummary({
        hasItem,
        signature,
        lastSignature: dailySummarySignatureRef.current,
        lastAttemptAt: dailySummaryAttemptAtRef.current,
        now,
        force,
      });
      if (!refresh) return;
      dailySummarySignatureRef.current = signature;
      dailySummaryAttemptAtRef.current = now.getTime();
      dailySummaryInFlightRef.current = true;
      void ensureDailySummaryNotification({ items: inboxItems, sessions, now })
        .then((result) => {
          if (result === "failed") {
            // Retry on the next input change once the min interval passes.
            dailySummarySignatureRef.current = null;
          } else if (result === "skipped" && !hasItem) {
            // Empty day — nothing was posted; keep the create path immediate
            // for when the first activity lands.
            dailySummarySignatureRef.current = null;
            dailySummaryAttemptAtRef.current = 0;
          }
        })
        .finally(() => {
          dailySummaryInFlightRef.current = false;
        });
    },
    [inboxItems, sessions, sessionsLoaded],
  );
  useEffect(() => {
    refreshDailySummary(false);
  }, [refreshDailySummary]);
  // Fallback tick: forces an attempt even with an unchanged signature, and
  // rolls the refresh cycle past midnight for an app that stays open.
  usePausablePoll(() => refreshDailySummary(true), DAILY_REFRESH_POLL_MS, {
    enabled: sessionsLoaded,
  });

  // Layer a familiar-written narrative on today's report once its facts
  // exist. One-shot generation through the chat bridge; every failure path is
  // silent — the deterministic count-line body simply remains the summary.
  useEffect(() => {
    if (!sessionsLoaded || daemonOffline || narrativeInFlightRef.current) return;
    const now = new Date();
    const item = inboxItems.find((it) => it.auto === dailySummaryAutoKey(now));
    const report = item?.media?.report;
    const stats = item?.media?.stats;
    if (!report?.factsHash || !stats) return;
    if (
      !shouldRegenerateNarrative({
        narrative: item.media?.narrative,
        factsHash: report.factsHash,
        now,
      })
    ) {
      return;
    }
    if (now.getTime() - narrativeAttemptAtRef.current < NARRATIVE_RETRY_MS) return;
    const familiar = familiars.find((f) => f.id === activeId) ?? familiars[0];
    if (!familiar) return;
    narrativeAttemptAtRef.current = now.getTime();
    narrativeInFlightRef.current = true;
    void (async () => {
      try {
        const dayLabel = new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(
          now,
        );
        const { text, error } = await generateDailyNarrative({
          familiarId: familiar.id,
          report,
          stats,
          dayLabel,
        });
        if (error || !text) return;
        await fetch("/api/inbox/daily-summary", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessions: sessionsRef.current,
            date: dateSlug(now),
            narrative: {
              text,
              familiarId: familiar.id,
              familiarName: familiar.display_name || familiar.name,
              factsHash: report.factsHash,
            },
          }),
        }).catch(() => undefined);
      } finally {
        narrativeInFlightRef.current = false;
      }
    })();
  }, [inboxItems, sessionsLoaded, daemonOffline, familiars, activeId]);

  const openOnboarding = useCallback(() => {
    manualOnboardingOpenedRef.current = true;
    setAutoFinishOnboarding(false);
    setOnboardingOpen(true);
  }, []);
  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    void loadFamiliars();
    // Familiar creation lives in the app now (the Summoning Circle on the
    // Familiars surface), not in the wizard. A user who leaves setup with a
    // live daemon and an empty roster can't chat yet — walk them to the
    // circle's invitation instead of dropping them on a familiar-less Home.
    if (daemonRunning && familiars.length === 0) setMode("agents");
  }, [loadFamiliars, daemonRunning, familiars.length, setMode]);

  useEffect(() => {
    if (!projectsLoading) setProjectsInitiallyResolved(true);
  }, [projectsLoading]);

  const canReconcilePendingFirstProjectGrant = familiarsLoaded && familiarRosterLoadedSuccessfully && projectsLoadedSuccessfully;
  const reconciledPendingFirstProjectGrant = resolvePendingFirstProjectAccessSnapshot({
    snapshot: pendingFirstProjectGrant,
    projects: registeredProjects,
    visibleFamiliars,
    familiarsLoaded,
    familiarRosterLoadedSuccessfully,
    projectsLoadedSuccessfully,
  });

  useEffect(() => {
    if (!canReconcilePendingFirstProjectGrant || !pendingFirstProjectGrant || reconciledPendingFirstProjectGrant) return;
    clearPendingFirstProjectAccessSnapshot();
    setPendingFirstProjectGrant(null);
  }, [canReconcilePendingFirstProjectGrant, pendingFirstProjectGrant, reconciledPendingFirstProjectGrant]);

  // First-run: auto-open onboarding if setup is missing and the user hasn't
  // explicitly skipped or finished it. The decision lives in the shared
  // shouldAutoOpenOnboarding gate so it can't diverge from the wizard's
  // finish-state (cave-219): both read bare server `complete` now that Coven
  // Code is an optional runtime rather than a requirement. See
  // onboarding-gate.ts for the structural-steps vs daemon-down rationale.
  useEffect(() => {
    let cancelled = false;
    const skipped =
      typeof window !== "undefined" && window.localStorage.getItem("cave:onboarding:dismissed") === "1";
    if (skipped) {
      setOnboardingResolved(true);
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/onboarding/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as OnboardingStatusPayload;
        if (
          shouldApplyStartupOnboardingStatus({
            status: json,
            cancelled,
            manuallyOpened: manualOnboardingOpenedRef.current,
          })
        ) {
          setAutoFinishOnboarding(true);
          setOnboardingOpen(true);
        }
      } catch {
        /* ignore — the daemon-offline banner surfaces transport issues */
      } finally {
        if (!cancelled) setOnboardingResolved(true);
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
        // ⌘J (Ctrl+J off-Mac) → jump straight into a fresh chat with the active
        // familiar, from anywhere. cave-xsq.6 retired the parallel quick-chat
        // overlay in favor of the real (now ChatGPT-clean) chat surface; this
        // reuses the tested new-chat plumbing (workspace handles it off-chat,
        // ChatSurface handles it in-chat — see the cave:agents-new-chat wiring).
        if (k === "j") {
          e.preventDefault();
          quickChatLaunchRef.current();
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

  // Calendar item actions — optimistic local update + verified POST; the
  // /api/inbox/stream SSE reconciles authoritative state on SUCCESS, but a
  // FAILED write emits no SSE event, so each action now re-syncs from the
  // server and corrects the announcement when its request fails — the old
  // fire-and-forget left items visually done and told AT "Marked done."
  // regardless (cave-x6k5). Announcements stay generic on purpose: the
  // callbacks are [] -deps'd and only carry the id.
  const { announce } = useAnnouncer();
  const verifyInboxWrite = useCallback((req: Promise<Response>, failureNote: string) => {
    void req
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch(() => {
        announce(failureNote, "assertive");
        void refreshInbox();
      });
  }, [announce, refreshInbox]);
  const completeInboxItem = useCallback((id: string) => {
    setInboxItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "done" } : it)));
    verifyInboxWrite(fetch(`/api/inbox/${id}/done`, { method: "POST" }), "Couldn't mark done — restored.");
    announce("Marked done.");
  }, [announce, verifyInboxWrite]);
  const dismissInboxItem = useCallback((id: string) => {
    setInboxItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "dismissed" } : it)));
    verifyInboxWrite(fetch(`/api/inbox/${id}/dismiss`, { method: "POST" }), "Couldn't dismiss — restored.");
    announce("Dismissed.");
  }, [announce, verifyInboxWrite]);
  const snoozeInboxItem = useCallback((id: string, untilIso: string) => {
    setInboxItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "snoozed", snoozeUntil: untilIso } : it)));
    verifyInboxWrite(
      fetch(`/api/inbox/${id}/snooze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ untilIso }),
      }),
      "Couldn't snooze — restored.",
    );
    announce("Snoozed.");
  }, [announce, verifyInboxWrite]);
  // Drag-to-reschedule from the calendar: move the item to a new fireAt and make
  // it pending there (clearing any snooze). Optimistic; verified like the rest.
  const rescheduleInboxItem = useCallback((id: string, fireAtIso: string) => {
    setInboxItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, fireAt: fireAtIso, status: "pending", snoozeUntil: null } : it)),
    );
    verifyInboxWrite(
      fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fireAt: fireAtIso, status: "pending", snoozeUntil: null }),
      }),
      "Couldn't reschedule — restored.",
    );
  }, [verifyInboxWrite]);

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

  // Declared above handleEnrichTasks, which closes over it.
  const pushToast = useCallback((title: string) => {
    const id = `eph:adhoc-${Date.now()}`;
    setToasts((prev) => [...prev, { id, title }]);
  }, []);

  const handleEnrichTasks = useCallback(async () => {
    if (!activeId || enrichingTasks) return;
    setEnrichingTasks(true);
    setEnrichProgress(null);
    // The trigger is a small top-bar button with no surface of its own — count
    // the outcome so it can say what happened when the run ends (issue #2991:
    // "clicking it results in loading and then returns to the start, no
    // feedback").
    let total = 0;
    let enhanced = 0;
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
              total = (msg.total as number) ?? 0;
              setEnrichProgress({ done: 0, total });
            } else if (msg.kind === "done" || msg.kind === "skip") {
              if (msg.kind === "done") enhanced += 1;
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
      // Close the loop: the live label disappears when the run ends, so state
      // the outcome — especially the two "nothing happened" shapes that read
      // as a silent failure.
      pushToast(
        total === 0
          ? "No open tasks to enhance right now."
          : enhanced === 0
            ? "Open tasks already have steps — nothing to enhance."
            : `Enhanced ${enhanced} task${enhanced === 1 ? "" : "s"} — open Tasks to review.`,
      );
    } catch {
      pushToast("Enhance tasks failed — check the daemon banner and try again.");
    } finally {
      setEnrichingTasks(false);
    }
  }, [activeId, enrichingTasks, pushToast, refreshOpenTaskCards]);

  const openReminderModal = useCallback((title = "", whenText = "", fireAt = "") => {
    setReminderModalDefaults({ fireAt, title, whenText });
    setReminderModalOpen(true);
  }, []);

  // Acknowledge a real inbox item: stamps readAt so the bell badge quiets, but
  // the notification stays listed until dismissed/done. No-ops server-side on
  // already-read items, so callers don't need to check. Skips synthetic ids
  // (missed-batches, ephemeral response-needed rows, ad-hoc toasts).
  const markInboxItemRead = useCallback((id: string | null | undefined) => {
    if (!id || id.startsWith("missed-") || id.startsWith("eph:")) return;
    // Best-effort: a dead daemon must not turn a toast timer into a crash.
    void fetch("/api/inbox/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", ids: [id] }),
    }).catch(() => undefined);
  }, []);

  // Explicit ✕ on a toast = "seen it" — mark read, keep it in the bell. The
  // old handler POSTed /dismiss, which RESOLVED the item; combined with the
  // auto-hide timer routing through the same handler, every notification that
  // fired while you were present silently destroyed itself after 8 seconds.
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    markInboxItemRead(id);
  }, [markInboxItemRead]);

  // Auto-hide expiry: the user may never have seen the toast — remove the
  // visual only, leave the item unread so the bell still carries it.
  const expireToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const snoozeToast = useCallback((toast: Toast, untilIso: string) => {
    if (toast.itemId && !toast.itemId.startsWith("eph:")) {
      void fetch(`/api/inbox/${toast.itemId}/snooze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ untilIso }),
      }).catch(() => undefined);
    }
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
  }, []);

  const openFamiliarSession = useCallback((sessionId: string, familiarId?: string | null, findQuery?: string) => {
    if (familiarId) setActiveId(familiarId);
    setActiveChatSessionId(sessionId);
    setPendingChatAction({
      kind: "open",
      sessionId,
      familiarId,
      ...(findQuery ? { findQuery } : {}),
      nonce: Date.now(),
    });
    setMode("chat");
  }, []);

  // Cross-surface navigation bridge: surfaces that don't own setMode (e.g. the
  // chat rail's nav block) announce a target mode and the Workspace switches to
  // it. Keeps those surfaces decoupled from the mode state owner.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const targetMode = (e as CustomEvent<{ mode?: string }>).detail?.mode;
      if (!targetMode) return;
      // Alias modes (flow, journal, groupchat, github, …) need no
      // special-casing: setMode's alias funnel routes them via MODE_ALIASES.
      setMode(targetMode as WorkspaceMode);
    };
    window.addEventListener("cave:navigate-mode", onNavigate as EventListener);
    return () => window.removeEventListener("cave:navigate-mode", onNavigate as EventListener);
  }, [openFamiliarSession]);

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

  // GitHub PR/issue URLs (github-watcher notifications, reminder links) open
  // the NATIVE GitHub surface with the item's detail — never a browser tab.
  // Returns false for anything that isn't a github.com item URL so callers
  // fall back to their existing behavior (cave-qcsv).
  const openGitHubTarget = useCallback((url: string | null | undefined): boolean => {
    const target = parseGitHubItemUrl(url);
    if (!target) return false;
    setGithubTarget(target);
    setMode("github");
    return true;
  }, []);

  const openUrlInApp = useCallback((url: string) => {
    if (openGitHubTarget(url)) {
      shellRef.current?.dismissNavMobile();
      return;
    }
    openUrlInAppBrowser(url);
  }, [openGitHubTarget, openUrlInAppBrowser]);

  const openReminderLink = useCallback((link: LinkRef) => {
    if (link.kind === "url") {
      if (!link.ref) return;
      if (link.ref.startsWith("/")) {
        nextRouter.push(link.ref);
        return;
      }
      if (openGitHubTarget(link.ref)) return;
      openUrlInAppBrowser(link.ref);
    } else if (link.kind === "card") {
      setMode("board");
      window.location.hash = `card-${link.ref}`;
    } else if (link.kind === "session") {
      openFamiliarSession(link.ref);
    } else if (link.kind === "memory") {
      // LinkRef supported "memory" but this fell through silently — a visible
      // Link button that did nothing (cave-gg5d). Grimoire is the memory reader.
      openGrimoireDoc("memory", link.ref);
    }
  }, [nextRouter, openFamiliarSession, openUrlInAppBrowser, openGitHubTarget]);

  const openInspectorInboxItem = useCallback((item: InboxItem) => {
    markInboxItemRead(item.id);
    const sessionId =
      item.sessionId ?? (item.link?.kind === "session" ? item.link.ref : null);
    if (sessionId) {
      openFamiliarSession(sessionId, item.familiarId);
      return;
    }
    // A GitHub-event notification's target is its PR/issue — open it natively.
    if (item.link?.kind === "url" && openGitHubTarget(item.link.ref)) return;
    if (item.familiarId) setActiveId(item.familiarId);
    setMode("inbox");
  }, [openFamiliarSession, markInboxItemRead, openGitHubTarget]);

  const startFamiliarChat = useCallback((
    familiarId?: string | null,
    projectRoot?: string | null,
    initialPrompt?: string | null,
    initialControls?: InitialCommandControls | null,
    initialAttachments?: ChatAttachment[] | null,
  ) => {
    if (chatProjectBlockedRef.current) {
      if (familiarId) setActiveId(familiarId);
      setMode("home");
      return;
    }
    if (familiarId) setActiveId(familiarId);
    setPendingProjectChatRoot(projectRoot ?? null);
    setActiveChatSessionId(null);
    setPendingChatAction({
      kind: "new",
      familiarId,
      projectRoot,
      initialPrompt,
      initialAttachments,
      initialControls,
      nonce: Date.now(),
    });
    setMode("chat");
  }, []);

  // Voice new-chat: create the empty conversation the call will attach to,
  // then route to chat with autoVoice so the overlay opens on arrival. On
  // failure stay on Home — no navigation, no orphan state. The mint is an
  // awaited round-trip, so re-check modeRef before navigating: if the user
  // already left Home while it was in flight, don't yank them back into a
  // chat they didn't ask for.
  const startVoiceChat = useCallback(async (familiarId: string, projectRoot: string | null) => {
    const result = await startVoiceConversation(familiarId, projectRoot);
    if (!result.ok) {
      pushToast(voiceChatStartErrorMessage(result.error));
      return;
    }
    if (modeRef.current !== "home") return;
    setActiveId(familiarId);
    setPendingProjectChatRoot(projectRoot ?? null);
    setActiveChatSessionId(result.sessionId);
    setPendingChatAction({ kind: "open", sessionId: result.sessionId, familiarId, autoVoice: true, nonce: Date.now() });
    setMode("chat");
  }, [pushToast]);

  // Keep the ⌘J quick-chat launcher pointed at "new chat with the active
  // familiar" — startFamiliarChat handles both the off-chat (switch + new
  // thread) and in-chat (new thread) cases (cave-xsq.6).
  useEffect(() => {
    quickChatLaunchRef.current = () => startFamiliarChat(activeId);
  }, [startFamiliarChat, activeId]);

  // Bridge `cave:agents-new-chat` from surfaces that aren't the chat view.
  // ChatSurface owns this event, but it only mounts when mode === "chat", so a
  // dispatch from the Familiar Studio drawer (e.g. the Contract tab's
  // rehabilitation button) or other non-chat surfaces would otherwise be lost.
  // When already in chat, ChatSurface handles it directly — skip here to avoid
  // opening the new chat twice.
  useEffect(() => {
    const onAgentsNewChat = (e: Event) => {
      if (modeRef.current === "chat") return;
      const d = (e as CustomEvent<{ familiarId?: string | null; projectRoot?: string | null; initialPrompt?: string | null; initialControls?: InitialCommandControls | null }>).detail;
      startFamiliarChat(d?.familiarId ?? null, d?.projectRoot ?? null, d?.initialPrompt ?? null, d?.initialControls ?? null);
    };
    window.addEventListener("cave:agents-new-chat", onAgentsNewChat);
    // Chat overflow → "Continue on phone": open the pairing modal with the
    // active conversation's deep link on the QR.
    const onContinueOnPhone = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail;
      setMobileHandoffChatId(detail?.chatId ?? null);
      setMobileHandoffOpen(true);
    };
    window.addEventListener("cave:continue-on-phone", onContinueOnPhone as EventListener);
    return () => {
      window.removeEventListener("cave:agents-new-chat", onAgentsNewChat);
      window.removeEventListener("cave:continue-on-phone", onContinueOnPhone as EventListener);
    };
  }, [startFamiliarChat]);

  // Consume a cross-page "new chat" handoff (cave-hbpb): standalone routes like
  // the familiar analytics pages have no workspace listeners, so their Resolve
  // actions persist the request to sessionStorage and navigate here.
  useEffect(() => {
    const pending = consumePendingAgentsNewChat();
    if (!pending) return;
    startFamiliarChat(
      pending.familiarId ?? null,
      pending.projectRoot ?? null,
      pending.initialPrompt ?? null,
      pending.initialControls ?? null,
    );
  }, [startFamiliarChat]);

  useEffect(() => {
    // ⌘1..⌘5 in the order surfaces appear top-to-bottom in the left sidebar
    // (Work group, then Tools group). ⌘9 is Projects; Journal/Roles/Workflows
    // are unshortcut.
    const SURFACE_ORDER: WorkspaceMode[] = [
      "home", "chat", "board", "inbox", "browser",
    ];

    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const alt = e.altKey;

      // ⌘1..⌘9 -> sidebar surface
      if (meta && !alt && /^[1-9]$/.test(e.key)) {
        // ⌘9 -> Projects tab inside chat surface (no SURFACE_ORDER lookup needed)
        if (e.key === "9") {
          e.preventDefault();
          markProjectsTabPending(); // latch beats the fresh-mount race (cave-c2zf)
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

      // ⌘[ / ⌘] -> previous / next surface, cycling through SURFACE_ORDER in the
      // same top-to-bottom order as ⌘1..⌘5 (wraps at the ends). From an off-list
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
    setActiveChatSessionId(null);
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
    setChatDeepLinkPending(false);
    const target = sessions.find((s) => s.id === sid);
    if (target) {
      openFamiliarSession(sid, target.familiarId);
    } else {
      clearChatHash();
      showFamiliarChatList();
    }
  }, [sessionsLoaded, sessions, openFamiliarSession, showFamiliarChatList]);

  // Browser Back/Forward between list ↔ chat (and chat ↔ chat). Only acts on
  // chat hashes — board `#card-` keeps its own listener.
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
          // Show the "Opening chat…" takeover while sessions settle, matching the
          // mount-restore path; the deep-link resolver clears it on found/stale.
          setChatDeepLinkPending(true);
          return;
        }
        clearChatHash();
        showFamiliarChatList();
        return;
      }
      // Popped back out of a chat entry to the root (empty hash) → show the
      // list. A *non-empty* hash belongs to another surface's deep link — the
      // `#card-<id>` the task chip writes, or `#memory:` — and
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
    markInboxItemRead(toast.itemId);
    if (toast.link) {
      openReminderLink(toast.link);
    } else if (toast.sessionId) {
      openFamiliarSession(toast.sessionId, toast.familiarId);
    } else {
      setMode("inbox");
    }
  }, [openFamiliarSession, openReminderLink, markInboxItemRead]);

  // Open a page in the split beside the current surface (drag-to-split drop).
  const openSplitPage = useCallback(
    (m: string, side: "left" | "right") => {
      if (!m || m === mode || !isWorkspaceMode(m)) return;
      addSplitTarget({ kind: "page", mode: m }, side);
    },
    [addSplitTarget, mode],
  );

  // (cave-gg5d) The old "cave:salem-undock" dispatches here had NO listener
  // anywhere — SalemChatPanel's unmount does the real teardown.
  const closeSplit = useCallback(() => {
    setSplitTargets([]);
  }, []);

  const closeSplitTile = useCallback((id: string) => {
    setSplitTargets((prev) => removeSecondaryWorkspaceTile(prev, id, splitTargetKey));
  }, []);

  // Promote a split tile to the sole surface (its divider was dragged past the
  // far edge, collapsing the primary). Only page tiles map to a primary mode —
  // switching to it makes the redundant-split effect below clear the tile.
  // Companion tiles (Salem / Memory / Browser) have no primary mode, so they
  // stay put (the host leaves them at max width instead).
  const promoteSplitTile = useCallback(
    (id: string) => {
      const target = splitTargets.find((t) => splitTargetKey(t) === id);
      if (target?.kind === "page") setMode(target.mode);
    },
    [splitTargets],
  );

  // Page splits showing the same page as the primary are redundant — clear them
  // (e.g. the user navigated the primary surface to a page in the split).
  useEffect(() => {
    setSplitTargets((prev) => prev.filter((target) => target.kind !== "page" || target.mode !== mode));
  }, [mode]);

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
      }).catch(() => undefined);
      return;
    }
    if (intent.kind === "open-board") {
      setMode("board");
      return;
    }
    if (intent.kind === "set-board-view") {
      // Persist for a fresh mount, navigate to the board, then signal a live
      // switch in case the board is already mounted.
      setBoardViewMode(intent.view);
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
      markProjectsTabPending(); // latch beats the fresh-mount race (cave-c2zf)
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
      // Land on the Grimoire editor with the file selected. (The old
      // `#memory:` hash had no consumer anywhere — picking a memory result
      // jumped to Familiars with nothing opened; cave-ce7y.)
      openGrimoireDoc("memory", intent.path);
      return;
    }
    if (intent.kind === "open-setting") {
      const params = new URLSearchParams();
      if (intent.group) params.set("group", intent.group);
      if (intent.familiarTab) params.set("familiarTab", intent.familiarTab);
      const search = params.size > 0 ? `?${params.toString()}` : "";
      nextRouter.push(`/settings${search}#${intent.section}`);
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
        setMode("journal"); // opens the Grimoire on its Journal tab (see setMode)
        return true;
      case "/canvas":
        // The Canvas page moved to feature/journal-canvas-surface. /canvas is
        // chat-inline now: hand off to a fresh chat and let its composer's
        // /canvas handler take over (args typed here aren't forwarded).
        startFamiliarChat(activeId);
        return true;
      case "/chats":
      case "/agents":
      case "/chat":
        showFamiliarChatList();
        return true;
      case "/rituals":
      case "/schedules":
      case "/automations":
      case "/inbox":
        setMode("inbox");
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
      case "/projects":
        markProjectsTabPending(); // latch beats the fresh-mount race (cave-c2zf)
        setMode("chat");
        window.setTimeout(() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT)), 0);
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
          }).catch(() => undefined);
        }
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

  const active = visibleFamiliars.find((f) => f.id === activeId) ?? null;
  const calendarFamiliarId = activeId ?? visibleFamiliars[0]?.id ?? null;
  const {
    open: firstProjectGateOpen,
    familiarId: projectGateFamiliarId,
    blockChatLaunch: chatProjectBlocked,
  } = resolveFirstProjectGatePolicy({
    activeFamiliarId: activeId,
    visibleFamiliars,
    registeredProjects,
    pendingGrant: reconciledPendingFirstProjectGrant,
    onboardingResolved,
    onboardingOpen,
    mode,
    familiarsLoaded,
    familiarRosterLoadedSuccessfully,
    projectsInitiallyResolved,
  });
  const chatProjectBlockedRef = useRef(chatProjectBlocked);
  chatProjectBlockedRef.current = chatProjectBlocked;

  useEffect(() => {
    if (!chatProjectBlocked) return;
    setSplitTargets((prev) => {
      const next = prev.filter((target) => !splitTargetRendersMode(target, "chat"));
      return next.length === prev.length ? prev : next;
    });
  }, [chatProjectBlocked]);

  // Tasks badge count: scoped to the active familiar's open cards, or the grand
  // total of all open cards when "All familiars" (activeId === null) is selected.
  const boardTaskCount = useMemo(
    () =>
      activeId === null
        ? openTaskCards.length
        : openTaskCards.filter((c) => c.familiarId === activeId).length,
    [openTaskCards, activeId],
  );

  // Live daemon activity for the top bar's running-processes control: sessions
  // whose status reads as running (shared sessionStatusTone vocabulary —
  // running / starting / working), excluding archived rows. Derived from the
  // same 4s-polled sessions list every other chrome badge uses.
  const runningSessions = useMemo(
    () => sessions.filter((s) => !s.archived_at && sessionStatusTone(s.status) === "running"),
    [sessions],
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

  // The "needs you" attention tier (fired or response-needed). ONE memo feeds
  // both the Schedules nav badge and Home's "Needs you" strip so the two can
  // never disagree (cave-925w).
  const inboxNeedsYou = useMemo(
    () => groupInboxFeed(inboxItemsWithEphemeral).needsYou,
    [inboxItemsWithEphemeral],
  );
  const scheduleNeedsCount = inboxNeedsYou.length;

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

  // The notification bell counts UNREAD notifications from the same items it
  // lists (one definition, unreadInboxCount) — it used to show the polled
  // escalations count above a list of inbox items, so badge and list routinely
  // disagreed. Live via SSE, quieted by Mark read / opening items.
  const notificationUnreadCount = useMemo(
    () => unreadInboxCount(inboxItemsWithEphemeral),
    [inboxItemsWithEphemeral],
  );

  // Role Surfaces: build the shared context from the live session and resolve
  // which registered surfaces the active familiar should see. Entirely
  // registry-driven — the shell never branches on a specific role.
  const roleSurfaceSession = useRoleSurfaceSession({
    familiar: active,
    sessions,
    activeSessionId: activeChatSessionId,
    daemonRunning,
    openUrl: openUrlInAppBrowser,
    openSession: openFamiliarSession,
  });

  // If the current mode is a Role Surface this familiar can't see (role
  // unassigned, surface unregistered, familiar switched away), fall back home.
  useEffect(() => {
    if (!isRoleSurfaceMode(mode)) return;
    if (!roleSurfaceSession.rolesLoaded) return;
    const surfaceId = parseRoleSurfaceMode(mode);
    if (!roleSurfaceSession.visibleSurfaces.some((s) => s.id === surfaceId)) setMode("home");
  }, [mode, roleSurfaceSession.rolesLoaded, roleSurfaceSession.visibleSurfaces, setMode]);

  useEffect(() => {
    const openPendingBrowserUrl = () => {
      const pending = window.sessionStorage.getItem(PENDING_IN_APP_BROWSER_URL_KEY);
      if (pending) {
        openUrlInAppBrowser(pending);
        return;
      }
      if (window.location.hash === "#browser") setMode("browser");
    };
    const onOpenBrowserUrl = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      if (detail?.url) {
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

  // Page modes currently open as split tiles — the sidebar marks their rows
  // "open in split" so the active highlight stays honest after drag-to-split
  // (dropping opens the page beside the primary WITHOUT changing `mode`).
  const splitPageModes = useMemo(
    () => splitTargets.filter((t): t is Extract<SplitTarget, { kind: "page" }> => t.kind === "page").map((t) => t.mode),
    [splitTargets],
  );
  const browserVisible = useMemo(
    () =>
      mode === "browser" ||
      splitTargets.some((target) => target.kind === "browser" || (target.kind === "page" && target.mode === "browser")),
    [mode, splitTargets],
  );

  useEffect(() => {
    if (browserVisible) return;
    deactivateAllNativeBrowserWebviews();
  }, [browserVisible]);

  const sidebar = (
    <SidebarMinimal
      mode={mode}
      splitPageModes={splitPageModes}
      // Registered Role Surfaces visible for the active familiar — rendered by
      // the sidebar as generic rows (rooms), never named in shell code.
      roleSurfaces={roleSurfaceSession.visibleSurfaces.map((surface) => ({
        mode: roleSurfaceMode(surface.id),
        label: surface.title,
        iconName: surface.iconName,
        description: surface.description,
      }))}
      sessions={sessions}
      activeSessionId={activeChatSessionId}
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
        setMode(m as CaveMode);
        shellRef.current?.dismissNavMobile();
      }}
      onOpenSession={(id) => {
        openFamiliarSession(id);
        shellRef.current?.dismissNavMobile();
      }}
      inboxItems={inboxItemsWithEphemeral}
      inboxPrefs={inboxPrefs}
      familiars={resolvedFamiliars}
      activeFamiliarId={activeId}
      selectedFamiliarIds={scopeIds}
      onFamiliarScopeChange={selectFamiliarScope}
      responseNeeded={responseNeeded}
      notificationBadgeCount={notificationUnreadCount}
      onOpenInbox={() => setMode("inbox")}
      onNotificationPrefsChanged={refreshPrefs}
      boardOpenCount={boardTaskCount}
      scheduleNeedsCount={scheduleNeedsCount}
      githubAssignedCount={githubAssignedCount}
    />
  );

  const chatSidebar = (
    <WorkspaceSidebar
      sessions={sessions}
      familiars={resolvedFamiliars}
      activeFamiliarId={activeId}
      activeSessionId={activeChatSessionId}
      responseNeeded={responseNeeded}
      onSelectFamiliar={selectFamiliarScope}
      onOpenSession={(session) => {
        openFamiliarSession(session.id, session.familiarId);
        shellRef.current?.dismissNavMobile();
      }}
      onOpenSessionInSplit={(session) => {
        // Open beside the current chat: same pending-action pipeline as a
        // plain open, but the chat surface routes it into a split pane
        // (falling back to a normal open when splits are unavailable). The
        // active familiar is left alone — the pane carries its own.
        setPendingChatAction({ kind: "open-split", sessionId: session.id, nonce: Date.now() });
        setMode("chat");
        shellRef.current?.dismissNavMobile();
      }}
      onNewChat={(projectRoot) => {
        startFamiliarChat(activeId, projectRoot);
        shellRef.current?.dismissNavMobile();
      }}
      onNavigate={(nextMode) => {
        setMode(nextMode);
        shellRef.current?.dismissNavMobile();
      }}
      onDeleteSession={async (session) => {
        const res = await fetch(`/api/chat/conversation/${encodeURIComponent(session.id)}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({ ok: false, error: "delete failed" }));
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "delete failed");
        }

        handleSessionsDeleted([session.id]);
      }}
      onSessionsChanged={loadSessions}
      onOpenUrl={(url) => {
        shellRef.current?.dismissNavMobile();
        openUrlInApp(url);
      }}
      scheduledCount={scheduleNeedsCount}
      onOpenSettings={() => {
        shellRef.current?.dismissNavMobile();
        nextRouter.push("/settings");
      }}
    />
  );

  const contextualNav = mode === "chat" ? chatSidebar : sidebar;

  // renderSurface maps a workspace mode to its surface element. Extracted so the
  // same machinery renders both the primary detail and a dragged-in split
  // secondary.
  const renderSurface = (mode: CaveMode): ReactNode =>
    isRoleSurfaceMode(mode) ? (
      // Generic Role Surface host — the registry decides what renders here.
      <RoleSurfaceHost
        surfaceId={parseRoleSurfaceMode(mode) ?? ""}
        context={roleSurfaceSession.context}
        visibleSurfaces={roleSurfaceSession.visibleSurfaces}
        rolesLoaded={roleSurfaceSession.rolesLoaded}
        onLeave={() => setMode("home")}
      />
    ) : mode === "agents" ? (
      <FamiliarsView
        familiars={familiars}
        sessions={sessions}
        activeFamiliar={active}
        daemonRunning={daemonRunning}
        responseNeeded={responseNeeded}
        onStartChat={(familiarId) => startFamiliarChat(familiarId)}
        onOpenSession={(sessionId, familiarId) => openFamiliarSession(sessionId, familiarId)}
        onOpenMemoryFile={(path) => {
          // Grimoire editor is the memory-file reader — the old `#memory:`
          // hash had no consumer (cave-ce7y).
          openGrimoireDoc("memory", path);
        }}
        onOpenOnboarding={openOnboarding}
        onOpenUrl={openUrlInAppBrowser}
        onFamiliarCreated={(id) => {
          void loadFamiliars();
          selectFamiliar(id);
        }}
        familiarsError={familiarsError}
        onRetryFamiliars={() => void loadFamiliars()}
      />
    ) : mode === "chat" ? (
      <ChatSurface
        familiars={familiars}
        sessions={sessions}
        activeFamiliar={active}
        activeFamiliarId={activeId}
        selectedFamiliarIds={scopeIds}
        daemonRunning={daemonRunning}
        routerRef={routerRef}
        hideThreadRail
        sessionsLoaded={sessionsLoaded}
        sessionsError={sessionsError}
        familiarsLoaded={familiarsLoaded}
        familiarsError={familiarsError}
        onRetryFamiliars={() => void loadFamiliars()}
        pendingProjectRoot={pendingProjectChatRoot}
        pendingChatAction={pendingChatAction}
        onSetActiveFamiliar={setActiveId}
        onFamiliarScopeChange={selectFamiliarScope}
        onClearPendingProjectRoot={() => setPendingProjectChatRoot(null)}
        onPendingChatActionHandled={() => setPendingChatAction(null)}
        onActiveSessionChange={setActiveChatSessionId}
        onSessionStarted={loadSessions}
        onSlashFromChat={handleSlashIntent}
        onOpenOnboarding={openOnboarding}
        onSessionsChanged={loadSessions}
        onSessionsDeleted={handleSessionsDeleted}
        onOpenTask={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
        onOpenUrl={openUrlInApp}
      />
    ) : mode === "board" || mode === "familiar-work-queue" ? (
      // Tasks and the Work Queue are one surface (cave-oa1z, the Schedules
      // pattern): the legacy familiar-work-queue mode still resolves here but
      // opens that tab; keying on the mode remounts so deep links land on it.
      <BoardView
        key={mode}
        initialTab={mode === "familiar-work-queue" ? "queue" : "tasks"}
        queueSlot={<FamiliarWorkQueueView familiars={resolvedFamiliars} onOpenUrl={openUrlInAppBrowser} embedded activeFamiliarId={activeId} />}
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={activeId}
        scopeFamiliarIds={scopeIds}
        daemonRunning={daemonRunning}
        onSessionsChanged={loadSessions}
        onSessionsDeleted={handleSessionsDeleted}
        onSlashFromChat={handleSlashIntent}
        onOpenOnboarding={openOnboarding}
        onOpenUrl={openUrlInAppBrowser}
        onJumpToSession={(sessionId, familiarId) => {
          openFamiliarSession(sessionId, familiarId);
        }}
      />
    ) : mode === "grimoire" ? (
      <GrimoireView
        view={grimoireView}
        onViewChange={setGrimoireView}
        familiars={familiars}
        activeFamiliarId={activeId}
      />
    ) : mode === "inbox" || mode === "calendar" ? (
      // Calendar and crons are one Schedules surface. The "calendar" mode still resolves
      // here (nav button / deep links) but opens that tab; keying on the mode
      // remounts so the deep link lands on it.
      <InboxEscalationsView
        key={mode}
        initialTab={mode === "calendar" ? "calendar" : "overview"}
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
              } else if (item.link) {
                // GitHub-event notifications open the native GitHub surface;
                // other links use their normal open paths.
                openReminderLink(item.link);
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
      <BrowserPane
        handleRef={browserPaneRef}
        label="main"
        activeFamiliarId={active?.id ?? null}
        active={browserVisible}
        navigationRequest={browserNavigationQueue[0] ?? null}
        onNavigationConsumed={acknowledgeBrowserNavigation}
      />
    ) : mode === "code" || mode === "github" ? (
      // "github" is a tab alias (cave-m6ys): the standalone surface was
      // absorbed as Code's GitHub tab. Keyed remount so ?mode=github deep
      // links land on the tab even when Code is already the active surface.
      <CodeView
        key={mode}
        sessions={sessions}
        initialTopTab={mode === "github" ? "github" : undefined}
        onJumpToSession={openFamiliarSession}
        onFocusCard={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
        githubTarget={githubTarget}
        pendingOpen={pendingCodeOpen}
        onPendingOpenHandled={() => setPendingCodeOpen(null)}
        onTasksRefresh={() => void loadGitHubTasks(true)}
      />
    ) : mode === "marketplace" || mode === "roles" || mode === "capabilities" ? (
      // Roles and Marketplace merged into one hub. The "roles"/"capabilities"
      // modes still resolve here (deep links / navigate-mode) but land on
      // Browse while those sections are hidden; keying on the mode remounts
      // so deep links land.
      <MarketplaceView
        key={mode}
        initialSection={mode === "roles" ? "roles" : mode === "capabilities" ? "capabilities" : "browse"}
        familiars={resolvedFamiliars}
        onOpenChat={(familiarId) => startFamiliarChat(familiarId)}
      />
    ) : mode === "submissions" ? (
      <OpenCovenSubmissionPage />
    ) : mode === "salem" ? (
      <AskSalemView familiars={familiars} activeFamiliarId={activeId} />
    ) : (
      <HomeComposer
        familiars={familiars}
        activeFamiliarId={activeId}
        sessions={sessions}
        onStartChat={(prompt, fid, projectRoot, opts) =>
          startFamiliarChat(fid, projectRoot, prompt, opts?.initialControls ?? null, opts?.initialAttachments ?? null)
        }
        onStartVoiceCall={(fid, projectRoot) => startVoiceChat(fid, projectRoot)}
        onNavigateToBoard={() => setMode("board")}
        onToast={pushToast}
        onSlash={(command, args) => onPaletteIntent({ kind: "slash", command, args })}
        onOpenSession={(sessionId, familiarId) => openFamiliarSession(sessionId, familiarId)}
        needsYou={inboxNeedsYou}
        onOpenInboxItem={openInspectorInboxItem}
        onOpenSchedules={() => setMode("inbox")}
      />
    );

  // ── Bottom status bar (chat-revamp phase D) ────────────────────────────────
  // Quiet context strip under the Home/Chat detail column. Chat feeds it the
  // ACTIVE session's metadata (registered-project name, model, per-session
  // workBranch — falling back to the poll-time checkout branch — cwd, and the
  // attached PR via the shared sessionPrStatus derivation). Home has no session
  // context, so it degrades to the active familiar's model + the Tasks count;
  // other surfaces don't render the strip at all.
  const statusSessionId = activeChatSessionId;
  const statusSession =
    mode === "chat" && statusSessionId
      ? sessions.find((s) => s.id === statusSessionId) ?? null
      : null;
  const statusProject = statusSession
    ? registeredProjects.find(
        (p) => normalizeProjectRoot(p.root) === normalizeProjectRoot(statusSession.project_root),
      ) ?? null
    : null;
  const statusPr = sessionPrStatus(statusSession?.pullRequest);
  const statusBar =
    mode === "home" || mode === "chat" ? (
      <StatusBar
        projectName={statusProject?.name ?? null}
        model={statusSession?.model ?? active?.model ?? null}
        branch={statusSession ? statusSession.workBranch ?? statusSession.git?.branch ?? null : null}
        cwd={statusSession?.project_root ?? null}
        pr={statusPr}
        taskCount={boardTaskCount}
        onViewTasks={() => setMode("board")}
        onOpenPr={(url) => openUrlInApp(url)}
      />
    ) : null;

  const detailContent = renderSurface(mode);
  const detail = (
    <div
      ref={detailFadeRef}
      className="cave-mode-fade relative h-full min-h-0 flex flex-col overflow-hidden"
    >
      <h1 className="sr-only">
        {(isRoleSurfaceMode(mode)
          ? getRoleSurface(parseRoleSurfaceMode(mode) ?? "")?.title
          : WORKSPACE_MODE_TITLES[mode]) ?? "CovenCave"}
      </h1>
      {firstProjectGateOpen ? (
        <FirstProjectGate
          open={firstProjectGateOpen}
          familiarId={projectGateFamiliarId}
          pendingGrant={reconciledPendingFirstProjectGrant}
          onPendingGrantChange={setPendingFirstProjectGrant}
          loadingProjects={projectsLoading}
          projectsError={projectsError}
          createProjectOrThrow={createProjectOrThrow}
          reloadProjects={reloadProjects}
        />
      ) : null}
      <div
        className="workspace-detail-content flex h-full min-h-0 min-w-0 flex-1 flex-col"
        aria-hidden={firstProjectGateOpen ? true : undefined}
        inert={firstProjectGateOpen || undefined}
      >
        {detailContent}
      </div>
      {/* Phase-D status strip: a flex sibling of the flex-1 content above, so
          it claims its 28px and the surface shrinks around it. Hidden while
          the first-project gate holds the surface inert. */}
      {firstProjectGateOpen ? null : statusBar}
    </div>
  );

  // Split tiles: dragged-in pages (heavy/stateful surfaces like terminal are
  // excluded from drag) or re-homed companion surfaces (Salem / Memory / Browser).
  const renderSplitTargetContent = (target: SplitTarget): ReactNode =>
    target.kind === "page" ? (
      target.mode !== mode ? (
        <div className="cave-mode-fade relative h-full min-h-0 flex flex-col overflow-hidden">
          {renderSurface(target.mode)}
        </div>
      ) : null
    ) : target.kind === "salem" ? (
      <SalemChatPanel
        familiarId={active?.id ?? familiars.find((f) => f.id === "salem")?.id ?? "salem"}
        model={active?.model ?? familiars.find((f) => f.id === "salem")?.model ?? null}
      />
    ) : target.kind === "memory" ? (
      <RailInspector familiar={active} onOpenFullView={() => setMode("agents")} />
    ) : (
      <BrowserPane label="companion" activeFamiliarId={active?.id ?? null} active={browserVisible} />
    );

  const splitTiles: DetailSplitTile[] = splitTargets
    .map((target) => ({
      id: splitTargetKey(target),
      title: splitTargetTitle(target),
      content: renderSplitTargetContent(target),
    }))
    .filter((tile) => tile.content != null);

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
      {/* Backdrop vibe: the user's image behind Home + Chat, painted under
          the shell; the derived accent applies document-wide from the same
          store (cave-backdrop.ts). In chat, a single-familiar scope with its
          own backdrop overrides the app-wide image (generic = fallback). */}
      <CaveBackdropLayer
        active={mode === "home" || mode === "chat"}
        familiarId={mode === "chat" ? activeId : null}
      />
      <Shell
        ref={shellRef}
        mobileTabs={mobileTabs}
        // Drag-to-split: a sidebar page dropped into the main area opens beside
        // the current surface, resizable with desktop-style snapping.
        splitTiles={splitTiles}
        splitSide={splitSide}
        onCloseSplit={closeSplit}
        onCloseSplitTile={closeSplitTile}
        onPromoteSplitTile={promoteSplitTile}
        onDropSplitPage={openSplitPage}
        navPolicy={mode === "chat" ? "chat-contextual" : "remembered"}
        topBar={({ navDrawerOpen }) => (
          <>
            <FamiliarMenuBar
              activeFamiliarId={activeId}
              activeFamiliarName={active?.display_name ?? null}
              // Running processes: clicking the waveform trigger lists each
              // live daemon session; a row jumps into that chat.
              runningStatus={
                <RunningSessionsPopover
                  sessions={runningSessions}
                  familiars={familiars}
                  onOpenSession={openFamiliarSession}
                />
              }
              // Desktop notifications: the same NotificationBell the mobile
              // TopBar hosts, mounted in this bar's right status cluster.
              bell={
                <NotificationBell
                  items={inboxItemsWithEphemeral}
                  familiars={familiars}
                  prefs={inboxPrefs}
                  badgeCount={notificationUnreadCount}
                  onOpenInbox={() => setMode("inbox")}
                  onOpenItem={(item) => {
                    markInboxItemRead(item.id);
                    if (item.familiarId) setActiveId(item.familiarId);
                    setMode("inbox");
                  }}
                  onPrefsChanged={refreshPrefs}
                />
              }
              taskCount={boardTaskCount}
              scheduleNeedsCount={scheduleNeedsCount}
              onOpenSearch={() => setPaletteOpen(true)}
              searchQuery={topSearchQuery}
              onSearchQueryChange={(query) => {
                setTopSearchQuery(query);
                setPaletteOpen(true);
              }}
              onViewTasks={() => setMode("board")}
              onEnrichTasks={handleEnrichTasks}
              enrichingTasks={enrichingTasks}
              enrichProgress={enrichProgress}
              onViewSchedules={() => setMode("inbox")}
              onOpenQuickChat={() => startFamiliarChat(activeId)}
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
              onOpenQuickChat={() => startFamiliarChat(activeId)}
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
              inboxBadgeCount={notificationUnreadCount}
              // Bell rows open in the Inbox (Schedules) surface — the popover
              // is a triage list, not a chat launcher. Session jumps stay on
              // the chat surface and Home needs-you paths
              // (openInspectorInboxItem).
              onOpenInboxItem={(item) => {
                markInboxItemRead(item.id);
                if (item.familiarId) setActiveId(item.familiarId);
                setMode("inbox");
              }}
              onNotificationPrefsChanged={refreshPrefs}
              onToggleNav={() => shellRef.current?.toggleNav()}
              onToggleList={undefined}
              navDrawerOpen={navDrawerOpen}
              listDrawerOpen={false}
            />
          </>
        )}
        nav={contextualNav}
        list={undefined}
        detail={detail}
      />

      {paletteOpen && (
        <CommandPalette
          open
          onClose={() => setPaletteOpen(false)}
          familiars={familiars}
          sessions={sessions}
          activeFamiliarId={activeId}
          initialQuery={topSearchQuery}
          onQueryChange={setTopSearchQuery}
          onIntent={onPaletteIntent}
        />
      )}

      {shortcutsOpen && <ShortcutsSheet open onClose={() => setShortcutsOpen(false)} />}

      {(onboardingOpen || onboardingMounted) && (
        <OnboardingOverlay
          autoFinishWhenComplete={autoFinishOnboarding}
          open={onboardingOpen}
          onDismiss={() => {
            setAutoFinishOnboarding(false);
            setOnboardingMounted(true);
            closeOnboarding();
          }}
        />
      )}

      {reminderModalOpen && (
        <NewReminderModal
          open
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
                  whenText: editingReminder.whenText ?? undefined,
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
                whenText: draft.whenText ?? null,
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
                whenText: draft.whenText ?? null,
                link: draft.link ?? null,
                source: "user",
              }),
            });
            // SSE `created` event will append the row; no manual refresh needed.
          }}
        />
      )}

      <InboxToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onExpire={expireToast}
        onSnooze={snoozeToast}
        onOpen={openToastTarget}
      />

      <MagicTriggers />

      {glyphPickerFor ? (
        <FamiliarGlyphPicker
          open
          familiar={glyphPickerFor}
          onClose={() => setGlyphPickerFor(null)}
        />
      ) : null}

      {mobileHandoffOpen && (
        <MobileHandoffModal
          open
          chatId={mobileHandoffChatId}
          onClose={() => {
            setMobileHandoffOpen(false);
            setMobileHandoffChatId(null);
          }}
          mobileModeEnabled={mobileModeEnabled}
          nativeHost={mobileModeHost}
          mobileModeError={mobileModeError}
          onMobileModeChange={setMobileModeEnabled}
        />
      )}

      {chatDeepLinkPending && (
        <div className="workspace-deeplink-pending" role="status">
          <span className="workspace-deeplink-pending__spinner" aria-hidden />
          Opening chat…
        </div>
      )}
    </FamiliarStudioProvider>
  );
}
