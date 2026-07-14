"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SidebarMinimal } from "@/components/sidebar-minimal";
import { stampFirstOpenOnce } from "@/lib/first-run-stamps";
import { groupInboxFeed, unreadInboxCount } from "@/lib/inbox-feed";
import { parseGitHubItemUrl, type GitHubItemTarget } from "@/lib/github-item-url";
import { sameSessionList } from "@/lib/session-list-equal";
import { invalidateConversation } from "@/lib/conversation-cache";
import { arrayContentEqual } from "@/lib/array-content-equal";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { WorkspaceMode as WorkspaceModeFromDaemon } from "@/lib/workspace-mode";
import { CommandPalette, type PaletteIntent } from "@/components/command-palette";
// Journal retired as an in-shell surface (redirects to Settings → Familiars),
// so JournalView is gone; Grimoire is a new in-shell surface from main.
import { GrimoireView, type GrimoireViewKind } from "@/components/grimoire-view";
import type { CalendarDeadline } from "@/components/calendar-view";
import { OnboardingOverlay } from "@/components/onboarding-overlay";
import { CaveBackdropLayer } from "@/components/cave-backdrop-layer";
import { readMobileModeEnabled, writeMobileModeEnabled } from "@/lib/mobile-mode-pref";
import {
  shouldAutoOpenOnboarding,
  type OnboardingStatusPayload,
} from "@/lib/onboarding-gate";
import { InboxEscalationsView } from "@/components/inbox-escalations-view";
import { NewReminderModal, draftFromSlashArgs } from "@/components/new-reminder-modal";
import { InboxToastStack, toastFromItem, type Toast } from "@/components/inbox-toast";
import { MagicTriggers } from "@/components/magic-triggers";
import { FamiliarGlyphPicker } from "@/components/familiar-glyph-picker";
import { Shell, type ShellHandle } from "@/components/shell";
import type { DetailSplitTile } from "@/components/detail-split-host";
import { MobileBottomTabs } from "@/components/mobile-bottom-tabs";
import { Icon } from "@/lib/icon";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { FamiliarStudioProvider, openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import { RailInspector } from "@/components/inspector-pane";
import { useAnnouncer } from "@/components/ui/live-region";
import { SalemChatPanel } from "@/components/salem/salem-widget";
import { FamiliarsView } from "@/components/familiars-view";
import {
  getFamiliarScope,
  setFamiliarScope,
  getLastSurface,
  setLastSurface,
} from "@/lib/familiar-memory";
import { toggleFamiliarSelection } from "@/lib/familiar-multiselect";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { BrowserPaneHandle } from "@/components/browser-pane";
// Heavy, mode-gated surfaces are code-split via @/components/lazy-surfaces so
// their chunks (and deps like @xyflow/react, @uiw/react-codemirror) load on
// first open instead of shipping in the main bundle. See lazy-surfaces.tsx.
import {
  BoardView,
  BrowserPane,
  CalendarView,
  FamiliarWorkQueueView,
  GitHubView,
  MarketplaceView,
} from "@/components/lazy-surfaces";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { OpenCovenSubmissionPage } from "@/components/opencoven-submission-page";
import { CHAT_OPEN_PROJECTS_EVENT, CHAT_FOCUS_PROJECT_EVENT, CHAT_OPEN_COVEN_EVENT, markCovenTabPending, markProjectsTabPending } from "@/lib/chat-tab-events";
import { HomeComposer } from "@/components/home-composer";
import { ChatSurface } from "@/components/chat-surface";
import { MobileHandoffModal } from "@/components/mobile-handoff-modal";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
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
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { useShellBanners } from "@/lib/shell-banners";
import { TopBar } from "@/components/top-bar";
import { FamiliarMenuBar } from "@/components/familiar-menu-bar";
import type { PendingChatAction } from "@/lib/pending-chat-action";
import type { PendingCodeRailOpen } from "@/lib/pending-code-rail-open";
import type { ChatAttachment } from "@/lib/chat-attachments";
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

// CHAT-D13-05 (axe page-has-heading-one): the shell renders no visible page
// title, so the detail pane carries a visually-hidden h1 naming the active
// surface. Labels mirror the sidebar's vocabulary.
const WORKSPACE_MODE_TITLES: Record<WorkspaceMode, string> = {
  agents: "Familiars",
  home: "Home",
  chat: "Familiars",
  groupchat: "Group Chat",
  board: "Tasks",
  calendar: "Rituals",
  inbox: "Rituals",
  browser: "Browser",
  github: "GitHub",
  roles: "Roles",
  marketplace: "Marketplace",
  flow: "Flow",
  submissions: "Submissions",
  capabilities: "Capabilities",
  "familiar-work-queue": "Queue",
  journal: "Journal",
  grimoire: "Memories",
};

// Chat deep links (CHAT-D9-01): `#chat-<sessionId>` re-enters a specific
// thread, same in-app hash idiom as `#card-<id>`.
// ChatRouter writes the hash (syncUrlHash); Workspace owns restore + popstate.
const CHAT_HASH_PREFIX = "#chat-";

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

// Mode deep links: workspace modes live inside this SPA shell and aren't
// URL-addressable on their own. A `?mode=<WorkspaceMode>` query param lets
// external links land directly on a surface.
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
      // The sessions list's server-side enrichment (gh pr view) carries the
      // real PR state (open/merged/closed/draft) — never clobber it with the
      // GitHub task's lifecycle word.
      pullRequest: session.pullRequest ?? {
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
  // ⌘J quick-chat launcher (cave-xsq.6): a ref so the global keydown effect
  // (declared above startFamiliarChat) can call it without a TDZ, and without
  // workspace self-dispatching a chat-nav event. Assigned in an effect below.
  const quickChatLaunchRef = useRef<() => void>(() => {});
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
  // false until the first /api/familiars fetch settles (success or error) —
  // lets the chat boot view hold a quiet frame instead of flashing the
  // "choose a familiar" empty-state copy while the roster is in flight.
  const [familiarsLoaded, setFamiliarsLoaded] = useState(false);
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
  const [daemonRunning, setDaemonRunning] = useState<boolean>(false);
  const { pushBanner, dismissBanner } = useShellBanners();
  const [responseNeeded, setResponseNeeded] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [topSearchQuery, setTopSearchQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Chat-first boot (cave-hsa6): the app opens on the conversation — the chat
  // surface with the thread sidebar (a fresh session lands on the task-aware
  // empty state). Home stays one step away (⌘1 / nav / the chat Back control,
  // whose lastNonChatMode below still defaults to "home"). Deep links (?mode=,
  // #chat-…) and cave:navigate-mode override this as before.
  const [mode, setModeRaw] = useState<CaveMode>("chat");
  // Which tab the Grimoire surface shows. Lifted here so the Journal nav row can
  // route straight into Grimoire's Journal tab (see the setMode `journal` branch)
  // and so the choice persists across Grimoire remounts within a session.
  const [grimoireView, setGrimoireView] = useState<GrimoireViewKind>("docs");
  // Group Chat retired its standalone page — it's now a tab inside the Chat
  // surface. Any request for the legacy `groupchat` mode (nav, deep link,
  // palette, keyboard, drag-to-split) is redirected to chat and opens the Group
  // tab, so `mode` is never actually "groupchat" and the surface never flashes.
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
  // Chat mode swaps the left nav for the ChatSidebar (project-grouped threads).
  // Its back control returns to the surface the user came from.
  const [lastNonChatMode, setLastNonChatMode] = useState<CaveMode>("home");
  // Whether the first daemon status poll has resolved. Until it has, the daemon
  // state is *unknown* (not "offline"), so the offline banner must stay hidden.
  const [daemonStatusResolved, setDaemonStatusResolved] = useState(false);
  // Sticky offline signal for the banner. A crash-looping / codesigning-zombie
  // daemon flaps: it briefly answers health (running:true) then dies again. The
  // banner keys off this instead of the raw per-poll status so a single transient
  // "running" doesn't flicker it away — it shows on the first failed poll and
  // only clears after the daemon is *consistently* healthy (see the streak ref).
  const [daemonOffline, setDaemonOffline] = useState(false);
  // The access-token gate rejected our credential (401 on the status poll).
  // Distinct from daemonOffline: the daemon may be fine — WE can't see it, and
  // the fix is re-auth (reload to the gate page), not "Start daemon" (cave-wkp5).
  const [authExpired, setAuthExpired] = useState(false);
  const daemonHealthyStreakRef = useRef(0);
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
    setSplitSide(side);
    setSplitTargets((prev) => addSecondaryWorkspaceTile(prev, target, splitTargetKey));
  }, []);
  const [pendingProjectChatRoot, setPendingProjectChatRoot] = useState<string | null>(null);
  const [pendingChatAction, setPendingChatAction] = useState<PendingChatAction>(null);
  const [pendingCodeRailOpen, setPendingCodeRailOpen] = useState<PendingCodeRailOpen | null>(null);
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
  // notification's PR/issue). Cleared on leaving the surface so a later manual
  // visit doesn't re-open a stale item.
  const [githubTarget, setGithubTarget] = useState<GitHubItemTarget | null>(null);
  useEffect(() => {
    if (mode !== "github" && githubTarget) setGithubTarget(null);
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

  useEffect(() => {
    if (mode !== "chat") setLastNonChatMode(mode);
  }, [mode]);

  const exitChatMode = useCallback(() => {
    setMode(lastNonChatMode === "chat" ? "home" : lastNonChatMode);
    shellRef.current?.dismissNavMobile();
  }, [lastNonChatMode]);

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

  // Reconcile only when mobile mode is (or just was) enabled. With the pref
  // off there is nothing to stop — an unconditional boot-time POST meant
  // every plain-web session hit /api/mobile-handoff, got the expected 503
  // (the route needs the packaged app's signed token), and logged a console
  // error + a misleading "Mobile mode unavailable" state for a feature the
  // user never touched. Turning the toggle OFF still posts app-stop because
  // the state change re-runs this effect while wasEnabledRef is set.
  const mobileModeWasEnabledRef = useRef(false);
  useEffect(() => {
    if (!mobileModeEnabled && !mobileModeWasEnabledRef.current) return;
    mobileModeWasEnabledRef.current = mobileModeEnabled;
    void reconcileMobileMode(mobileModeEnabled);
  }, [mobileModeEnabled, reconcileMobileMode]);
  // Recurring reconcile only while mobile mode is on; usePausablePoll pauses it
  // in a hidden tab and refreshes on return.
  usePausablePoll(() => void reconcileMobileMode(mobileModeEnabled), 60_000, {
    enabled: mobileModeEnabled,
  });

  const refreshDaemonStatus = useCallback(async (opts?: { trusted?: boolean }) => {
    let running = false;
    let authRejected = false;
    try {
      const res = await fetch("/api/daemon/status", { cache: "no-store" });
      if (res.status === 401) {
        // The access-token gate rejected US — the daemon may be perfectly
        // healthy; we just can't see it. Attributing this to the daemon put
        // users in front of a "Daemon offline" banner whose "Start daemon"
        // CTA also 401s (cave-wkp5). Surface re-auth instead, and leave the
        // daemon state untouched.
        authRejected = true;
      } else {
        const json = (await res.json()) as { running?: boolean };
        running = json.running === true;
        setDaemonRunning(running);
        // A real (non-401) answer proves the credential is accepted again.
        setAuthExpired(false);
      }
    } catch {
      if (!authRejected) setDaemonRunning(false);
    } finally {
      if (authRejected) {
        setAuthExpired(true);
        setDaemonStatusResolved(true);
      } else {
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
    const openCreate = () => setOnboardingOpen(true);
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

  // File/diff links target ChatSurface's code rail. ChatSurface only mounts in
  // chat mode, so preserve event detail from non-chat surfaces until it mounts.
  useEffect(() => {
    const enqueue = (kind: PendingCodeRailOpen["kind"], e: Event) => {
      if (modeRef.current === "chat") return;
      const detail = (e as CustomEvent<{ path?: string; line?: number }>).detail;
      if (!detail?.path) return;
      setPendingCodeRailOpen(
        kind === "files"
          ? { kind, path: detail.path, line: detail.line, nonce: Date.now() }
          : { kind, path: detail.path, nonce: Date.now() },
      );
      setMode("chat");
    };
    const onOpenProjectFile = (e: Event) => enqueue("files", e);
    const onOpenFileDiff = (e: Event) => enqueue("changes", e);
    // Projects hub → "Browse files": carries a project ROOT (not a file path);
    // ChatSurface browses that root with nothing selected (cave-z44).
    const onBrowseProjectFiles = (e: Event) => {
      if (modeRef.current === "chat") return;
      const detail = (e as CustomEvent<{ root?: string }>).detail;
      if (!detail?.root) return;
      setPendingCodeRailOpen({ kind: "files", root: detail.root, nonce: Date.now() });
      setMode("chat");
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
  }, [daemonOffline, daemonStatusResolved, authExpired, pushBanner, dismissBanner, startDaemon]);

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
        return;
      }
      setFamiliarsError(null);
      setFamiliars((json.familiars ?? []) as Familiar[]);
    } catch (err) {
      setFamiliarsError(err instanceof Error ? err.message : "fetch failed");
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
  const selectFamiliarScope = useCallback((id: string | null, opts?: { multi?: boolean }) => {
    setScopeIds((prev) => (id == null ? new Set<string>() : toggleFamiliarSelection(prev, id, opts?.multi ?? false)));
    if (!id) return;
    // A multi-toggle shouldn't yank the surface around — only a plain single
    // select restores that familiar's last-viewed surface.
    if (opts?.multi) return;
    const last = getLastSurface(id);
    // Guard against retired/unknown persisted modes (e.g. the removed
    // "projects" standalone surface). Only restore if the stored string is
    // still a valid WorkspaceMode; otherwise fall back to the default.
    const VALID_MODES = new Set<string>(Object.keys(WORKSPACE_MODE_TITLES));
    if (last === "flow") setMode("inbox");
    // A persisted Role Surface mode restores too — if this familiar no longer
    // holds the role, the visibility effect below falls back generically.
    // ("journal" restores fine: setMode remaps it to Grimoire's Journal tab —
    // the old no-op predated that remap; cave-nwi8.)
    else if (last && (VALID_MODES.has(last) || isRoleSurfaceMode(last))) setMode(last as CaveMode);
  }, []);

  const selectFamiliar = useCallback((id: string) => {
    selectFamiliarScope(id);
  }, [selectFamiliarScope]);

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
      const githubTasksPromise = fetch("/api/github/tasks", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      try {
        // Scope the session list to the active familiar's granted projects so
        // every surface fed by `sessions` enforces the familiar→projects map.
        // With "All familiars" (activeId null) the unscoped list is returned.
        const scope = activeId ? `?familiarId=${encodeURIComponent(activeId)}` : "";
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
        const baseSessions = (json.sessions ?? []) as SessionRow[];
        // The 4s poll rebuilds a fresh array each tick; keep the previous
        // reference when nothing changed so an unchanged list doesn't re-render
        // every sessions consumer (chat list, rails, badges) for nothing.
        setSessions((prev) => (sameSessionList(prev, baseSessions) ? prev : baseSessions));
        setSessionsLoaded(true);
        baseSessionsApplied = true;

        const githubTasksJson = await githubTasksPromise;
        if (githubTasksJson && isCurrent()) {
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
        if (isCurrent()) setSessionsError(true); // transient — poll retries
      } finally {
        if (!baseSessionsApplied && isCurrent()) setSessionsLoaded(true);
      }
    })();
  }, [activeId]);

  useEffect(() => {
    loadFamiliars();
    loadSessions();
  }, [loadFamiliars, loadSessions]);
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
      if (e.type === "snapshot") {
        // Reconnect snapshots usually carry what we already have — keep the
        // reference so inboxItemsWithEphemeral consumers don't re-render
        // (companion to #2762's content-equal guard on `updated` echoes).
        setInboxItems((prev) => (arrayContentEqual(prev, e.items) ? prev : e.items));
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

  const openOnboarding = useCallback(() => setOnboardingOpen(true), []);
  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    void loadFamiliars();
    // Familiar creation lives in the app now (the Summoning Circle on the
    // Familiars surface), not in the wizard. A user who leaves setup with a
    // live daemon and an empty roster can't chat yet — walk them to the
    // circle's invitation instead of dropping them on a familiar-less Home.
    if (daemonRunning && familiars.length === 0) setMode("agents");
  }, [loadFamiliars, daemonRunning, familiars.length, setMode]);

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
    if (skipped) return;
    void (async () => {
      try {
        const res = await fetch("/api/onboarding/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as OnboardingStatusPayload;
        if (shouldAutoOpenOnboarding(json)) setOnboardingOpen(true);
      } catch {
        /* ignore — the daemon-offline banner surfaces transport issues */
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
      // "code" was retired — redirect to the most-recent repo session in chat.
      if (targetMode === "code") {
        const repoSession = [...sessionsRef.current]
          .filter((s) => s.project_root)
          .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at))[0];
        if (repoSession) {
          openFamiliarSession(repoSession.id, repoSession.familiarId);
        } else {
          setMode("chat");
        }
        return;
      }
      if (targetMode === "flow") {
        setMode("inbox");
        return;
      }
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
    if (familiarId) setActiveId(familiarId);
    setPendingProjectChatRoot(projectRoot ?? null);
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
    return () => window.removeEventListener("cave:agents-new-chat", onAgentsNewChat);
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
      if (!m || m === mode) return;
      addSplitTarget({ kind: "page", mode: m as WorkspaceMode }, side);
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

  const active = familiars.find((f) => f.id === activeId) ?? null;
  const calendarFamiliarId = activeId ?? familiars[0]?.id ?? null;

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
    activeSessionId: routerRef.current?.currentSessionId() ?? null,
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
      activeSessionId={routerRef.current?.currentSessionId() ?? null}
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
        shellRef.current?.dismissListMobile();
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
      activeSessionId={routerRef.current?.currentSessionId() ?? null}
      responseNeeded={responseNeeded}
      onSelectFamiliar={selectFamiliarScope}
      onOpenSession={(session) => {
        openFamiliarSession(session.id, session.familiarId);
        shellRef.current?.dismissNavMobile();
      }}
      onNewChat={(projectRoot) => {
        startFamiliarChat(activeId, projectRoot);
        shellRef.current?.dismissNavMobile();
      }}
      onDeleteSession={async (session) => {
        await fetch(`/api/chat/conversation/${encodeURIComponent(session.id)}`, { method: "DELETE" });
        invalidateConversation(session.id);
        await loadSessions();
      }}
      scheduledCount={scheduleNeedsCount}
      onOpenSettings={() => {
        shellRef.current?.dismissNavMobile();
        nextRouter.push("/settings");
      }}
    />
  );

  const list = undefined;

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
        pendingCodeRailOpen={pendingCodeRailOpen}
        onSetActiveFamiliar={setActiveId}
        onClearPendingProjectRoot={() => setPendingProjectChatRoot(null)}
        onPendingChatActionHandled={() => setPendingChatAction(null)}
        onPendingCodeRailOpenHandled={() => setPendingCodeRailOpen(null)}
        onSessionStarted={loadSessions}
        onSlashFromChat={handleSlashIntent}
        onOpenOnboarding={openOnboarding}
        onSessionsChanged={loadSessions}
        onOpenTask={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
        onOpenUrl={openUrlInAppBrowser}
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
        initialTab={mode === "calendar" ? "calendar" : "inbox"}
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
    ) : mode === "github" ? (
      <GitHubView
        onJumpToSession={openFamiliarSession}
        onFocusCard={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
        initialTarget={githubTarget}
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
    ) : (
      <HomeComposer
        familiars={familiars}
        activeFamiliarId={activeId}
        sessions={sessions}
        onStartChat={(prompt, fid, projectRoot, opts) =>
          startFamiliarChat(fid, projectRoot, prompt, opts?.initialControls ?? null, opts?.initialAttachments ?? null)
        }
        onNavigateToBoard={() => setMode("board")}
        onToast={pushToast}
        onSlash={(command, args) => onPaletteIntent({ kind: "slash", command, args })}
        onOpenSession={(sessionId, familiarId) => openFamiliarSession(sessionId, familiarId)}
        needsYou={inboxNeedsYou}
        onOpenInboxItem={openInspectorInboxItem}
        onOpenSchedules={() => setMode("inbox")}
      />
    );

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
      {renderSurface(mode)}
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
          store (cave-backdrop.ts). */}
      <CaveBackdropLayer active={mode === "home" || mode === "chat"} />
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
        topBar={({ navDrawerOpen, listDrawerOpen }) => (
          <>
            <FamiliarMenuBar
              activeFamiliarId={activeId}
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
              onToggleList={list ? () => shellRef.current?.toggleList() : undefined}
              navDrawerOpen={navDrawerOpen}
            listDrawerOpen={listDrawerOpen}
          />
          </>
        )}
        nav={mode === "chat" ? chatSidebar : sidebar}
        list={list}
        detail={detail}
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

      <InboxToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onExpire={expireToast}
        onSnooze={snoozeToast}
        onOpen={openToastTarget}
      />

      <MagicTriggers />

      <FamiliarGlyphPicker
        open={glyphPickerFor !== null}
        familiar={glyphPickerFor}
        onClose={() => setGlyphPickerFor(null)}
      />

      <MobileHandoffModal
        open={mobileHandoffOpen}
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

      {chatDeepLinkPending && (
        <div className="workspace-deeplink-pending" role="status">
          <span className="workspace-deeplink-pending__spinner" aria-hidden />
          Opening chat…
        </div>
      )}
    </FamiliarStudioProvider>
  );
}
