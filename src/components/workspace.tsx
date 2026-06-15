"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SidebarMinimal } from "@/components/sidebar-minimal";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { WorkspaceMode as WorkspaceModeFromDaemon } from "@/lib/workspace-mode";
import { CommandPalette, type PaletteIntent } from "@/components/command-palette";
import { BoardView } from "@/components/board-view";
import { CalendarView } from "@/components/calendar-view";
import { OnboardingOverlay } from "@/components/onboarding-overlay";
import { InboxEscalationsView } from "@/components/inbox-escalations-view";
import { NewReminderModal, draftFromSlashArgs } from "@/components/new-reminder-modal";
import { slashSaveParse } from "@/lib/slash-save-parser";
import { InboxToastStack, toastFromItem, type Toast } from "@/components/inbox-toast";
import { FamiliarGlyphPicker } from "@/components/familiar-glyph-picker";
import { Shell, type ShellHandle } from "@/components/shell";
import { MobileBottomTabs } from "@/components/mobile-bottom-tabs";
import { Icon } from "@/lib/icon";
import { FamiliarStudioProvider } from "@/lib/familiar-studio-context";
import { FamiliarStudio } from "@/components/familiar-studio";
import { CompanionRail, type CompanionTab } from "@/components/companion-rail";
import { RailInspector } from "@/components/inspector-pane";
import { FamiliarsView } from "@/components/familiars-view";
import { RailMemoryList } from "@/components/familiars-memory-view";
import {
  getActiveFamiliar,
  setActiveFamiliar,
  getLastSurface,
  setLastSurface,
  getRailOpen,
  setRailOpen,
} from "@/lib/familiar-memory";
import { ChooserModal, type ChooserOption } from "@/components/ui/chooser-modal";
import { FamiliarPanel } from "@/components/familiar-panel";
import { BrowserPane, type BrowserPaneHandle } from "@/components/browser-pane";
import { ComuxView } from "@/components/comux-view";
import { GitHubView } from "@/components/github-view";
import { LibraryView } from "@/components/library-view";
import { CapabilitiesViewSurface } from "@/components/capabilities-view";
import { PluginsView } from "@/components/plugins-view";
import { WorkflowsView } from "@/components/workflows-view";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import { HomeComposer } from "@/components/home-composer";
import { ChatSurface, type RightPanelKind } from "@/components/chat-surface";
import { SalemChatPanel } from "@/components/salem/salem-widget";
import { MobileHandoffModal } from "@/components/mobile-handoff-modal";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
import { nativeNotify } from "@/lib/native-notify";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import type { Familiar, SessionRow } from "@/lib/types";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { DEMO_FAMILIARS } from "@/lib/demo-seed";
import {
  DEMO_MODE_EVENT,
  demoModeFetchHeaders,
  isDemoModeEnabled,
  persistDemoModeLaunchFlag,
} from "@/lib/demo-mode";
import { useShellBanners } from "@/lib/shell-banners";
import { TopBar } from "@/components/top-bar";
import type { PendingChatAction } from "@/lib/pending-chat-action";

type WorkspaceMode = WorkspaceModeFromDaemon;

// CHAT-D13-05 (axe page-has-heading-one): the shell renders no visible page
// title, so the detail pane carries a visually-hidden h1 naming the active
// surface. Labels mirror the sidebar's vocabulary.
const WORKSPACE_MODE_TITLES: Record<WorkspaceMode, string> = {
  agents: "Familiars",
  home: "Home",
  chat: "Chat",
  board: "Board",
  calendar: "Calendar",
  inbox: "Automations",
  library: "Library",
  browser: "Browser",
  terminal: "Terminal",
  github: "GitHub",
  roles: "Roles",
  workflows: "Workflows",
  capabilities: "Capabilities",
};

// Chat deep links (CHAT-D9-01): `#chat-<sessionId>` re-enters a specific
// thread, same in-app hash idiom as `#card-<id>` and `library:projects`.
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

export function Workspace() {
  const nextRouter = useRouter();
  const routerRef = useRef<ChatRouterHandle | null>(null);
  const shellRef = useRef<ShellHandle | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => getActiveFamiliar());
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const [familiarsError, setFamiliarsError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(() => isDemoModeEnabled());
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  // false until the first /api/sessions/list fetch settles — lets the chat
  // list show a skeleton instead of flashing its empty state on boot.
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [daemonRunning, setDaemonRunning] = useState<boolean>(false);
  const { pushBanner, dismissBanner } = useShellBanners();
  const [responseNeeded, setResponseNeeded] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("home");
  // Pending Workflow Studio deep link (set when opening a workflow from Roles).
  const [workflowDeepLink, setWorkflowDeepLink] = useState<string | null>(null);
  const browserPaneRef = useRef<BrowserPaneHandle>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanelKind | null>(null);
  const [railTab, setRailTab] = useState<CompanionTab>(() => {
    if (typeof window === "undefined") return "chat";
    return (window.localStorage.getItem("cave:rail.tab") as CompanionTab) ?? "chat";
  });
  const [familiarPanelOpen, setFamiliarPanelOpen] = useState(false);
  const [pendingProjectChatRoot, setPendingProjectChatRoot] = useState<string | null>(null);
  const [pendingChatAction, setPendingChatAction] = useState<PendingChatAction>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [escalationsUnresolved, setEscalationsUnresolved] = useState(0);
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [glyphPickerFor, setGlyphPickerFor] = useState<Familiar | null>(null);
  const [addChooserOpen, setAddChooserOpen] = useState(false);
  const [mobileHandoffOpen, setMobileHandoffOpen] = useState(false);
  const [addons, setAddons] = useState<{ github?: boolean; library?: boolean }>({});
  const responseNeededRef = useRef(responseNeeded);
  responseNeededRef.current = responseNeeded;
  // Deep-link target captured at mount, held until the async sessions fetch
  // settles (loadSessions → sessionsLoaded) so the restore can resolve it.
  const pendingChatDeepLinkRef = useRef<string | null>(readChatHash());
  // Refs for the popstate listener — sessions repoll every 4s and mode flips
  // often; the listener should not resubscribe on either.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const sessionsLoadedRef = useRef(sessionsLoaded);
  sessionsLoadedRef.current = sessionsLoaded;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const refreshDaemonStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/daemon/status", { cache: "no-store" });
      const json = (await res.json()) as { running?: boolean };
      setDaemonRunning(json.running === true);
    } catch {
      setDaemonRunning(false);
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
      await refreshDaemonStatus();
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
    persistDemoModeLaunchFlag();
    const syncDemoMode = () => setDemoMode(isDemoModeEnabled());
    syncDemoMode();
    window.addEventListener(DEMO_MODE_EVENT, syncDemoMode);
    return () => window.removeEventListener(DEMO_MODE_EVENT, syncDemoMode);
  }, []);

  useEffect(() => {
    setActiveFamiliar(activeId);
  }, [activeId]);

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

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("cave:rail.tab", railTab);
  }, [railTab]);

  useEffect(() => {
    const openSalem = () => {
      setRailTab("salem");
      requestAnimationFrame(() => shellRef.current?.openFamiliar());
    };
    window.addEventListener("cave:salem-open", openSalem);
    return () => window.removeEventListener("cave:salem-open", openSalem);
  }, []);

  useEffect(() => {
    if (railTab !== "salem") {
      window.dispatchEvent(new CustomEvent("cave:salem-undock"));
    }
  }, [railTab]);

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; config?: { addons?: { github?: boolean; library?: boolean } } }) => {
        if (j.ok && j.config?.addons) setAddons(j.config.addons);
      })
      .catch(() => {/* keep defaults */});
  }, []);

  // Daemon status poll (previously lived on DaemonBar before chrome consolidation)
  useEffect(() => {
    void refreshDaemonStatus();
    const t = setInterval(() => { void refreshDaemonStatus(); }, 5000);
    return () => { clearInterval(t); };
  }, [refreshDaemonStatus]);

  // Push / dismiss the daemon-offline banner into the shared shell channel so
  // it appears at the top of every surface, not just Chat.
  useEffect(() => {
    if (daemonRunning) {
      dismissBanner("daemon-offline");
      dismissBanner("daemon-start-error");
    } else {
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
  }, [daemonRunning, pushBanner, dismissBanner, startDaemon]);

  const loadFamiliars = useCallback(async () => {
    try {
      const res = await fetch("/api/familiars", {
        cache: "no-store",
        headers: demoModeFetchHeaders(demoMode),
      });
      const json = await res.json();
      if (!json.ok) {
        const fallback = demoMode ? DEMO_FAMILIARS : [];
        setFamiliars(fallback);
        setFamiliarsError(demoMode ? null : (json.error ?? "daemon offline"));
        return;
      }
      setFamiliarsError(null);
      const list = (json.familiars ?? []) as Familiar[];
      // In demo mode, merge demo familiars for any ids not returned by daemon.
      const merged = demoMode
        ? [...list, ...DEMO_FAMILIARS.filter((d) => !list.find((l) => l.id === d.id))]
        : list;
      setFamiliars(merged);
    } catch (err) {
      const fallback = demoMode ? DEMO_FAMILIARS : [];
      setFamiliars(fallback);
      setFamiliarsError(demoMode ? null : (err instanceof Error ? err.message : "fetch failed"));
    }
  }, [demoMode]);

  const selectFamiliarScope = useCallback((id: string | null) => {
    setActiveId(id);
    if (!id) return;
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

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions/list", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setSessions((json.sessions ?? []) as SessionRow[]);
    } catch {
      /* transient */
    } finally {
      setSessionsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadFamiliars();
    loadSessions();
    const t = setInterval(loadSessions, 4000);
    return () => clearInterval(t);
  }, [loadFamiliars, loadSessions]);

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

  // Poll Inbox for unresolved-escalations count — drives the
  // sidebar/daemon-bar Inbox badge. Cheap GET every 30s; the route
  // already de-dupes via reconcileEscalations().
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/escalations", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
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
    };
    void tick();
    const t = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

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

  const openFamiliarSession = useCallback((sessionId: string, familiarId?: string | null) => {
    if (familiarId) setActiveId(familiarId);
    setPendingChatAction({
      kind: "open",
      sessionId,
      familiarId,
      nonce: Date.now(),
    });
    setMode("chat");
  }, []);

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

  useEffect(() => {
    const SURFACE_ORDER: WorkspaceMode[] = [
      "home", "chat", "board", "calendar", "inbox", "library", "browser", "terminal",
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
  }, [familiars, activeId, mode, selectFamiliar, startFamiliarChat]);

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
    if (toast.sessionId) {
      openFamiliarSession(toast.sessionId, toast.familiarId);
    } else {
      setMode("inbox");
    }
  }, [openFamiliarSession]);

  const toggleFamiliarPanel = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        code: "KeyJ",
        metaKey: true,
        bubbles: true,
      }),
    );
  }, []);

  const onPaletteIntent = (intent: PaletteIntent) => {
    if (intent.kind === "switch-familiar") {
      setActiveId(intent.familiarId);
      showFamiliarChatList();
      return;
    }
    if (intent.kind === "open-session") {
      openFamiliarSession(intent.sessionId, intent.familiarId);
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
      case "/chats":
      case "/agents":
      case "/chat":
        showFamiliarChatList();
        return true;
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
    setRailTab(tab);
    if (familiarPanelOpen && railTab === tab) {
      shellRef.current?.closeFamiliar();
      return;
    }
    requestAnimationFrame(() => shellRef.current?.openFamiliar());
  }, [familiarPanelOpen, railTab]);

  const openProjectChat = useCallback((projectRoot: string) => {
    startFamiliarChat(activeId, projectRoot);
  }, [activeId, startFamiliarChat]);

  const sidebar = (
    <SidebarMinimal
      mode={mode}
      sessions={sessions}
      activeSessionId={routerRef.current?.currentSessionId() ?? null}
      addons={addons}
      onNewChat={() => {
        startFamiliarChat(activeId);
        shellRef.current?.closeNav();
      }}
      onToggleSidebar={() => shellRef.current?.toggleNav()}
      onOpenSettings={() => {
        shellRef.current?.closeNav();
        nextRouter.push("/settings");
      }}
      onModeChange={(m) => {
        if (m === "browser") {
          setMode("browser");
          shellRef.current?.closeNav();
          return;
        }
        setMode(m as WorkspaceMode);
        shellRef.current?.closeNav();
      }}
      onOpenSession={(id) => {
        openFamiliarSession(id);
        shellRef.current?.closeList();
      }}
      inboxItems={inboxItemsWithEphemeral}
      inboxPrefs={inboxPrefs}
      familiars={resolvedFamiliars}
      activeFamiliarId={activeId}
      onFamiliarScopeChange={selectFamiliarScope}
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
      />
    ) : mode === "library" ? (
      <LibraryView
        onOpenUrl={(url) => {
          setMode("browser");
          // Give the pane one frame to mount/become active, then navigate
          requestAnimationFrame(() => browserPaneRef.current?.navigateTo(url));
        }}
        sessions={sessions}
        onOpenSession={openFamiliarSession}
        onNewProjectChat={openProjectChat}
      />
    ) : mode === "board" ? (
      <BoardView
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={activeId}
        onOpenUrl={(url) => {
          setMode("browser");
          requestAnimationFrame(() => browserPaneRef.current?.navigateTo(url));
        }}
        onJumpToSession={(sessionId, familiarId) => {
          openFamiliarSession(sessionId, familiarId);
        }}
      />
    ) : mode === "inbox" ? (
      <InboxEscalationsView
        onOpenSource={(item) => {
          if (item.sourceSessionKey) {
            openFamiliarSession(item.sourceSessionKey);
          } else if (item.sourceUrl) {
            window.open(item.sourceUrl, "_blank", "noopener");
          }
        }}
        familiars={familiars}
        activeFamiliarId={activeId}
        onNewReminder={() => openReminderModal()}
        onOpenSession={(sessionId, familiarId) => {
          openFamiliarSession(sessionId, familiarId);
        }}
      />
    ) : mode === "browser" ? (
      <BrowserPane ref={browserPaneRef} label="main" activeFamiliarId={active?.id ?? null} />
    ) : mode === "github" ? (
      <GitHubView
        onJumpToSession={openFamiliarSession}
        onFocusCard={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
      />
    ) : mode === "roles" ? (
      <PluginsView
        tabs={["roles", "workflows", "plugins", "skills"]}
        initialTab="roles"
        familiars={resolvedFamiliars}
        onOpenChat={() => setMode("chat")}
        onOpenWorkflow={(id) => { setWorkflowDeepLink(id); setMode("workflows"); }}
        onCreateSkill={() => setMode("capabilities")}
        onCreatePlugin={() => setMode("capabilities")}
      />
    ) : mode === "workflows" ? (
      <WorkflowsView
        initialWorkflowId={workflowDeepLink}
        onDeepLinkConsumed={() => setWorkflowDeepLink(null)}
      />
    ) : mode === "capabilities" ? (
      <CapabilitiesViewSurface activeHarness={active?.harness ?? null} />
    ) : mode === "calendar" ? (
      <CalendarView
        items={inboxItems}
        familiars={familiars}
        activeFamiliarId={activeId}
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
          } else {
            setMode("inbox");
          }
        }}
        onComplete={completeInboxItem}
        onDismiss={dismissInboxItem}
        onSnooze={snoozeInboxItem}
      />
    ) : (
      <HomeComposer
        familiars={familiars}
        activeFamiliarId={activeId}
        sessions={sessions}
        onSetActiveFamiliar={setActiveId}
        onStartChat={(prompt, fid) => startFamiliarChat(fid, null, prompt)}
        onNavigateToBoard={() => setMode("board")}
        onNavigateToInbox={() => setMode("inbox")}
        onToast={pushToast}
        onSlash={(command, args) => onPaletteIntent({ kind: "slash", command, args })}
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

  return (
    <FamiliarStudioProvider>
      <Shell
        ref={shellRef}
        mobileTabs={mobileTabs}
        onFamiliarOpenChange={(open) => {
          setFamiliarPanelOpen(open);
          if (activeId) setRailOpen(activeId, open);
        }}
        topBar={({ navDrawerOpen, listDrawerOpen, familiarDrawerOpen }) => (
          <TopBar
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenInbox={() => setMode("inbox")}
            onOpenSettings={() => nextRouter.push("/settings")}
            onOpenMobileHandoff={() => setMobileHandoffOpen(true)}
            inboxItems={inboxItemsWithEphemeral}
            familiars={familiars}
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
                    openCompanionTab("salem");
                  }
                : undefined
            }
          />
        )}
        familiarPanelRail={showCompanionRail ? (
          <aside className="familiar-trigger-rail familiar-trigger-rail--stacked" aria-label="Right panel tabs">
            <button
              type="button"
              className="familiar-trigger-rail__toggle"
              aria-label="Toggle Salem"
              title="Toggle Salem (⌘J)"
              onClick={() => openCompanionTab("salem")}
            >
              <span className="edge-rail-chip">
                <Icon name="ph:cat" width={14} />
              </span>
            </button>
          </aside>
        ) : undefined}
        nav={sidebar}
        list={list}
        detail={detail}
        agent={
          showCompanionRail ? (
            <CompanionRail
              familiar={active}
              defaultTab={railTab}
              activeTab={railTab}
              onTabChange={setRailTab}
              daemonRunning={daemonRunning}
              onCreateFamiliar={openOnboarding}
              hideChatTab={mode === "chat"}
              // Chat surface already shows a "Choose a familiar" CTA in the
              // detail panel — suppress the rail's duplicate prompt there.
              suppressEmpty={mode === "chat"}
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
              inspectorSlot={
                <RailInspector familiar={active} />
              }
              memorySlot={
                <RailMemoryList
                  familiar={active}
                  familiars={familiars}
                  onOpenFullView={() => setMode("agents")}
                />
              }
              browserSlot={
                <BrowserPane label="companion" activeFamiliarId={active?.id ?? null} />
              }
              salemSlot={<SalemChatPanel />}
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
        onIntent={onPaletteIntent}
      />

      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <OnboardingOverlay open={onboardingOpen} onDismiss={closeOnboarding} />

      <NewReminderModal
        open={reminderModalOpen}
        onClose={() => setReminderModalOpen(false)}
        familiars={familiars}
        defaultFamiliarId={activeId}
        defaultFireAt={reminderModalDefaults.fireAt}
        defaultWhenText={reminderModalDefaults.whenText}
        defaultTitle={reminderModalDefaults.title}
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

      <FamiliarStudio familiars={familiars} />
      <MobileHandoffModal
        open={mobileHandoffOpen}
        onClose={() => setMobileHandoffOpen(false)}
      />
    </FamiliarStudioProvider>
  );
}
