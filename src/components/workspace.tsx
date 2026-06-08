"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SidebarMinimal, FOLDER_MODES, UTILITY_MODES } from "@/components/sidebar-minimal";
import { Icon } from "@/lib/icon";
import type { ChatRouterHandle } from "@/components/chat-router";
import type { WorkspaceMode as WorkspaceModeFromDaemon } from "@/lib/workspace-mode";
import { CommandPalette, type PaletteIntent } from "@/components/command-palette";
import { BoardView } from "@/components/board-view";
import { PluginsView } from "@/components/plugins-view";
import { CalendarView } from "@/components/calendar-view";
import { OnboardingOverlay } from "@/components/onboarding-overlay";
import { InboxEscalationsView } from "@/components/inbox-escalations-view";
import { NewReminderModal, draftFromSlashArgs } from "@/components/new-reminder-modal";
import { InboxToastStack, toastFromItem, type Toast } from "@/components/inbox-toast";
import { FamiliarGlyphPicker } from "@/components/familiar-glyph-picker";
import { Shell, type ShellHandle } from "@/components/shell";
import { FamiliarAvatarRail } from "@/components/familiar-avatar-rail";
import {
  getActiveFamiliar,
  setActiveFamiliar,
  getLastSurface,
  setLastSurface,
} from "@/lib/familiar-memory";
import { ChooserModal, type ChooserOption } from "@/components/ui/chooser-modal";
import { AgentPanel } from "@/components/agent-panel";
import { BrowserPane, type BrowserPaneHandle } from "@/components/browser-pane";
import { AutomationsView } from "@/components/automations-view";
import { ComuxView } from "@/components/comux-view";
import { GitHubView } from "@/components/github-view";
import { LibraryView } from "@/components/library-view";
import { HomeComposer } from "@/components/home-composer";
import { AgentsView } from "@/components/agents-view";
import { SessionsView } from "@/components/sessions-view";
import { nativeNotify } from "@/lib/native-notify";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import type { Familiar, SessionRow } from "@/lib/types";
import { DEMO_MODE, DEMO_FAMILIARS } from "@/lib/demo-seed";

type WorkspaceMode = WorkspaceModeFromDaemon;

// Icon-only nav strip shown when the sidebar is collapsed
function IconNavStrip({
  mode,
  onModeChange,
}: {
  mode: string;
  onModeChange: (m: string) => void;
}) {
  return (
    <>
      {FOLDER_MODES.map((fm) => {
        return (
          <button
            key={fm.id}
            type="button"
            title={fm.label}
            aria-label={fm.label}
            onClick={() => onModeChange(fm.id)}
            className={`shell-nav-tab-icon-btn${mode === fm.id ? " shell-nav-tab-icon-btn--active" : ""}`}
          >
            <Icon name={fm.iconName} width={15} />
          </button>
        );
      })}
      <span className="my-1 h-px w-5 bg-[var(--border-hairline)]" />
      {UTILITY_MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          onClick={() => onModeChange(item.id)}
        >
          <Icon name={item.iconName} width={15} />
        </button>
      ))}
    </>
  );
}

export function Workspace() {
  const nextRouter = useRouter();
  const routerRef = useRef<ChatRouterHandle | null>(null);
  const shellRef = useRef<ShellHandle | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => getActiveFamiliar());
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [familiarsError, setFamiliarsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [daemonRunning, setDaemonRunning] = useState<boolean>(false);
  const [responseNeeded, setResponseNeeded] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<WorkspaceMode>("home");
  const browserPaneRef = useRef<BrowserPaneHandle>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<"inspector" | "chat" | null>(null);
  const [shellAgentPane, setShellAgentPane] = useState<"browser" | "chat">("browser");
  // "browser" = top locks to browser; "chat" = top locks to chat
  const [stripLock, setStripLock] = useState<"browser" | "chat">("browser");
  const [pendingProjectChatRoot, setPendingProjectChatRoot] = useState<string | null>(null);
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
  const [addons, setAddons] = useState<{ github?: boolean; library?: boolean }>({});
  const responseNeededRef = useRef(responseNeeded);
  responseNeededRef.current = responseNeeded;

  useEffect(() => {
    setActiveFamiliar(activeId);
  }, [activeId]);

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
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/daemon/status", { cache: "no-store" });
        const json = (await res.json()) as { running?: boolean };
        if (!cancelled) setDaemonRunning(json.running === true);
      } catch {
        if (!cancelled) setDaemonRunning(false);
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const loadFamiliars = useCallback(async () => {
    try {
      const res = await fetch("/api/familiars", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        const fallback = DEMO_MODE ? DEMO_FAMILIARS : [];
        setFamiliars(fallback);
        setFamiliarsError(DEMO_MODE ? null : (json.error ?? "daemon offline"));
        if (DEMO_MODE) setActiveId((curr) => curr ?? fallback[0]?.id ?? null);
        return;
      }
      setFamiliarsError(null);
      const list = (json.familiars ?? []) as Familiar[];
      // In demo mode, merge demo familiars for any ids not returned by daemon.
      const merged = DEMO_MODE
        ? [...list, ...DEMO_FAMILIARS.filter((d) => !list.find((l) => l.id === d.id))]
        : list;
      setFamiliars(merged);
      setActiveId((curr) => curr ?? merged[0]?.id ?? null);
    } catch (err) {
      const fallback = DEMO_MODE ? DEMO_FAMILIARS : [];
      setFamiliars(fallback);
      setFamiliarsError(DEMO_MODE ? null : (err instanceof Error ? err.message : "fetch failed"));
      if (DEMO_MODE) setActiveId((curr) => curr ?? fallback[0]?.id ?? null);
    }
  }, []);

  const selectFamiliar = useCallback((id: string) => {
    setActiveId(id);
    const last = getLastSurface(id);
    if (last) setMode(last as WorkspaceMode);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions/list", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setSessions((json.sessions ?? []) as SessionRow[]);
    } catch {
      /* transient */
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
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
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

  const openAgentSession = useCallback((sessionId: string, familiarId?: string | null) => {
    if (familiarId) setActiveId(familiarId);
    setMode("agents");
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("cave:agents-open-session", {
          detail: { sessionId, familiarId },
        }),
      );
    }, 0);
  }, []);

  const openInspectorInboxItem = useCallback((item: InboxItem) => {
    const sessionId =
      item.sessionId ?? (item.link?.kind === "session" ? item.link.ref : null);
    if (sessionId) {
      openAgentSession(sessionId, item.familiarId);
      return;
    }
    if (item.familiarId) setActiveId(item.familiarId);
    setMode("schedules");
  }, [openAgentSession]);

  const startAgentChat = useCallback((familiarId?: string | null, projectRoot?: string | null) => {
    if (familiarId) setActiveId(familiarId);
    setPendingProjectChatRoot(projectRoot ?? null);
    setMode("agents");
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("cave:agents-new-chat", {
          detail: { familiarId, projectRoot },
        }),
      );
    }, 0);
  }, []);

  const showAgentChatList = useCallback(() => {
    setMode("agents");
    setTimeout(() => window.dispatchEvent(new CustomEvent("cave:agents-list")), 0);
  }, []);

  const openToastTarget = useCallback((toast: Toast) => {
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    if (toast.sessionId) {
      openAgentSession(toast.sessionId, toast.familiarId);
    } else {
      setMode("inbox");
    }
  }, [openAgentSession]);

  const toggleAgentPanel = useCallback(() => {
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
      showAgentChatList();
      return;
    }
    if (intent.kind === "open-session") {
      openAgentSession(intent.sessionId, intent.familiarId);
      return;
    }
    if (intent.kind === "new-chat") {
      startAgentChat(intent.familiarId);
      return;
    }
    if (intent.kind === "back-to-list") {
      showAgentChatList();
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
      // The board doesn't currently expose an imperative API; instead we use
      // a URL hash that BoardView can listen for in a future polish pass.
      window.location.hash = `card-${intent.cardId}`;
      return;
    }
    if (intent.kind === "open-memory-file") {
      // Switch to Agents view (memory inspector lives in the right pane), and
      // surface the path via a hash that InspectorPane can wire to in a
      // follow-up commit; for now this is a no-op visual placeholder.
      setMode("agents");
      window.location.hash = `memory:${encodeURIComponent(intent.path)}`;
      return;
    }
    if (intent.kind === "slash") {
      // Map slash commands directly to local actions
      switch (intent.command) {
        case "/new":
          startAgentChat(activeId);
          return;
        case "/board":
          setMode("board");
          return;
        case "/chats":
        case "/agents":
          showAgentChatList();
          return;
        case "/inbox":
          setMode("inbox");
          return;
        case "/remind": {
          const args = (intent.args ?? "").trim();
          const { title, whenText } = args
            ? draftFromSlashArgs(args)
            : { title: "", whenText: "" };
          openReminderModal(title, whenText);
          return;
        }
        case "/palette":
          setPaletteOpen(true);
          return;
        case "/terminal":
          setMode("terminal");
          return;
        case "/projects":
          setMode("projects");
          return;
        case "/library":
          setMode("library");
          return;
        case "/toggle-agent":
          toggleAgentPanel();
          return;
        case "/quit":
          showAgentChatList();
          return;
        case "/sessions":
          setMode("sessions");
          return;
        case "/familiar": {
          const name = (intent.args ?? "").trim().toLowerCase();
          if (name) {
            const match = familiars.find(
              (f) => f.id === name || f.display_name.toLowerCase() === name,
            );
            if (match) {
              setActiveId(match.id);
              showAgentChatList();
              return;
            }
          }
          setPaletteOpen(true);
          return;
        }
        case "/attach": {
          const sid = (intent.args ?? "").trim();
          if (!sid) {
            setPaletteOpen(true);
            return;
          }
          // Find which familiar this session belongs to so we surface the right rail row
          const target = sessions.find((s) => s.id === sid);
          openAgentSession(sid, target?.familiarId);
          return;
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
          return;
        }
        case "/clear":
          routerRef.current?.clearTranscript();
          return;
        case "/help":
        case "/familiar":
        case "/run":
        case "/codex":
        case "/claude":
          // These need composer context; route to the chat view's slash handler.
          routerRef.current?.runSlash(intent.command);
          return;
      }
    }
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
  //   list  = unused by Agents; Inbox/Board/Plugins
  //           are full-width detail surfaces — they have their own list
  //           UI baked in and we don't want to double-list.
  //   detail = the active view. Agents mode renders an inline inspector
  //           rail on its right edge so we keep the inspector affordance
  //           without spawning a 4th pane.
  // Inbox badge counts unresolved escalations (Inbox is now the
  // primary Inbox surface). "new" + "acknowledged" + "snoozed-due" all
  // count as needing attention; resolved/dismissed do not.
  const inboxBadgeCount = escalationsUnresolved;

  const openProjectChat = useCallback((projectRoot: string) => {
    startAgentChat(activeId, projectRoot);
  }, [activeId, startAgentChat]);

  const sidebar = (
    <SidebarMinimal
      mode={mode}
      sessions={sessions}
      activeSessionId={routerRef.current?.currentSessionId() ?? null}
      addons={addons}
      onNewChat={() => {
        startAgentChat(activeId);
      }}
      onOpenSearch={() => setPaletteOpen(true)}
      onOpenSettings={() => nextRouter.push("/settings")}
      onModeChange={(m) => {
        if (m === "browser") {
          setMode("browser");
          return;
        }
        setMode(m as WorkspaceMode);
      }}
      onOpenSession={(id) => {
        openAgentSession(id);
      }}
      inboxItems={inboxItemsWithEphemeral}
      inboxPrefs={inboxPrefs}
      familiars={familiars}
      notificationBadgeCount={inboxBadgeCount}
      onOpenInbox={() => setMode("inbox")}
      onOpenInboxItem={(item) => {
        if (item.sessionId) {
          openAgentSession(item.sessionId, item.familiarId);
        } else {
          setMode("inbox");
        }
      }}
      onNotificationPrefsChanged={refreshPrefs}
    />
  );

  const iconNav = (
    <IconNavStrip
      mode={mode}
      onModeChange={(m) => {
        shellRef.current?.openNav();
        if (m === "browser") { setMode("browser"); return; }
        setMode(m as WorkspaceMode);
      }}
    />
  );

  const list = undefined;

  const detail = (
    <div key={mode} className="cave-mode-fade h-full flex flex-col">
      {mode === "home" ? (
      <HomeComposer
        familiars={familiars}
        activeFamiliarId={activeId}
        sessions={sessions}
        onNavigateToChat={(sessionId, fid) => {
          openAgentSession(sessionId, fid);
        }}
        onNavigateToBoard={() => setMode("board")}
        onNavigateToInbox={() => setMode("inbox")}
        onToast={pushToast}
      />
    ) : mode === "agents" ? (
      <AgentsView
        familiars={familiars}
        sessions={sessions}
        activeFamiliar={active}
        activeFamiliarId={activeId}
        activeSessionId={routerRef.current?.currentSessionId() ?? null}
        daemonRunning={daemonRunning}
        routerRef={routerRef}
        inboxItems={inboxItemsWithEphemeral}
        inspectorOpen={inspectorOpen}
        rightPanel={rightPanel}
        pendingProjectRoot={pendingProjectChatRoot}
        onSetInspectorOpen={setInspectorOpen}
        onSetRightPanel={setRightPanel}
        onSetActiveFamiliar={setActiveId}
        onClearPendingProjectRoot={() => setPendingProjectChatRoot(null)}
        onSessionStarted={loadSessions}
        onSlashFromChat={(command, args) => {
          onPaletteIntent({ kind: "slash", command, args });
          return true;
        }}
        onOpenOnboarding={openOnboarding}
        onOpenInbox={() => setMode("schedules")}
        onCreateReminder={openReminderForFamiliar}
        onOpenInboxItem={openInspectorInboxItem}
        onInboxItemChanged={refreshInbox}
        onOpenMode={(nextMode) => setMode(nextMode as WorkspaceMode)}
      />
    ) : mode === "sessions" ? (
      <SessionsView
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={null}
        activeSessionId={routerRef.current?.currentSessionId() ?? null}
        onOpenSession={(sessionId, familiarId) => {
          openAgentSession(sessionId, familiarId);
        }}
        onNewChat={(familiarId) => {
          startAgentChat(familiarId ?? activeId);
        }}
        onSessionsChanged={loadSessions}
      />
    ) : mode === "library" ? (
      <LibraryView onOpenUrl={(url) => {
        setMode("browser");
        // Give the pane one frame to mount/become active, then navigate
        requestAnimationFrame(() => browserPaneRef.current?.navigateTo(url));
      }} />
    ) : mode === "board" ? (
      <BoardView
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={activeId}
        onJumpToSession={(sessionId, familiarId) => {
          openAgentSession(sessionId, familiarId);
        }}
      />
    ) : mode === "inbox" ? (
      <InboxEscalationsView
        onOpenSource={(item) => {
          if (item.sourceSessionKey) {
            openAgentSession(item.sourceSessionKey);
          } else if (item.sourceUrl) {
            window.open(item.sourceUrl, "_blank", "noopener");
          }
        }}
      />
    ) : mode === "schedules" ? (
      <AutomationsView
        familiars={familiars}
        onNewReminder={() => openReminderModal()}
        onOpenSession={(sessionId, familiarId) => {
          openAgentSession(sessionId, familiarId);
        }}
      />
    ) : mode === "browser" ? (
      <BrowserPane ref={browserPaneRef} label="main" activeFamiliarId={active?.id ?? null} />
    ) : mode === "terminal" ? (
      <ComuxView
        view="terminal"
        sessions={sessions}
        onOpenSession={(sessionId, familiarId) => {
          openAgentSession(sessionId, familiarId);
        }}
        onNewChat={openProjectChat}
      />
    ) : mode === "projects" ? (
      <ComuxView
        view="projects"
        sessions={sessions}
        onOpenSession={(sessionId, familiarId) => {
          openAgentSession(sessionId, familiarId);
        }}
        onNewChat={openProjectChat}
      />
    ) : mode === "github" ? (
      <GitHubView />
    ) : mode === "calendar" ? (
      <CalendarView
        items={inboxItems}
        familiars={familiars}
        onAddEntry={(defaults) => {
          openReminderModal(
            defaults?.title ?? "",
            defaults?.whenText ?? "",
            defaults?.fireAt ?? "",
          );
        }}
        onOpenItem={(item) => {
          if (item.sessionId) {
            openAgentSession(item.sessionId, item.familiarId);
          } else {
            setMode("inbox");
          }
        }}
      />
    ) : (
      <PluginsView
        onOpenChat={() => {
          startAgentChat(activeId);
        }}
        onCreateSkill={() => {
          startAgentChat(activeId);
        }}
        onCreatePlugin={() => {
          startAgentChat(activeId);
        }}
        familiars={familiars.map((f) => ({ id: f.id, display_name: f.display_name }))}
      />
    )}
    </div>
  );

  return (
    <>
      <Shell
        ref={shellRef}
        familiarRail={
          <FamiliarAvatarRail
            familiars={familiars}
            activeId={activeId}
            sessions={sessions}
            responseNeeded={responseNeeded}
            onSelect={selectFamiliar}
            onAddFamiliar={openOnboarding}
            onToggleSidebar={() => shellRef.current?.toggleNav()}
          />
        }
        nav={sidebar}
        iconNav={iconNav}
        list={list}
        detail={detail}
        agent={
          mode === "browser" ? undefined : shellAgentPane === "chat" ? (
            <AgentPanel
              familiar={active}
              familiars={familiars}
              activeId={activeId}
              sessions={sessions}
              daemonRunning={daemonRunning}
              onSessionStarted={loadSessions}
              onSlashFromChat={(command, args) => {
                onPaletteIntent({ kind: "slash", command, args });
                return true;
              }}
              onOpenOnboarding={openOnboarding}
              onFamiliarSelect={setActiveId}
            />
          ) : (
            <BrowserPane label="default" activeFamiliarId={active?.id ?? null} />
          )
        }
        agentLabel={stripLock === "chat" ? "Chat" : "Browser"}
        agentIcon={stripLock === "chat" ? "ph:chats" : "ph:globe"}
        agentExtra={
          <>
            {/* Drag-handle between buttons: drag up → lock browser, drag down → lock chat */}
            <div
              className="shell-agent-strip-drag"
              title={stripLock === "browser" ? "Drag ↓ to lock Chat" : "Drag ↑ to lock Browser"}
              onPointerDown={(e) => {
                const startY = e.clientY;
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                let committed = false;
                const onMove = (ev: PointerEvent) => {
                  if (committed) return;
                  const dy = ev.clientY - startY;
                  if (dy < -14) { setStripLock("browser"); committed = true; }
                  else if (dy > 14) { setStripLock("chat"); committed = true; }
                };
                const onUp = () => {
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onUp);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
              }}
            >
              <span className={`shell-agent-strip-lock-dot${stripLock === "chat" ? " shell-agent-strip-lock-dot--down" : " shell-agent-strip-lock-dot--up"}`} />
            </div>
            {/* Bottom chat button */}
            <button
              type="button"
              className={`shell-agent-strip-btn shell-agent-strip-btn--bottom${shellAgentPane === "chat" ? " shell-agent-strip-btn--active" : ""}`}
              title={stripLock === "chat" ? "Toggle Chat (locked)" : "Open Chat"}
              aria-label={shellAgentPane === "chat" ? "Close chat panel" : "Open chat panel"}
              onClick={() => {
                if (shellAgentPane === "chat") {
                  shellRef.current?.closeAgent();
                  setShellAgentPane("browser");
                } else {
                  setShellAgentPane("chat");
                  shellRef.current?.openAgent();
                }
              }}
            >
              <Icon name="ph:chats" width={15} />
            </button>
          </>
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

    </>
  );
}
