"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FamiliarRail } from "@/components/familiar-rail";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { InspectorPane } from "@/components/inspector-pane";
import { DaemonBar } from "@/components/daemon-bar";
import { CommandPalette, type PaletteIntent } from "@/components/command-palette";
import { BoardView } from "@/components/board-view";
import { PluginsView } from "@/components/plugins-view";
import { OnboardingOverlay } from "@/components/onboarding-overlay";
import { InboxView } from "@/components/inbox-view";
import { ValsInboxView } from "@/components/vals-inbox-view";
import { NewReminderModal, draftFromSlashArgs } from "@/components/new-reminder-modal";
import { InboxToastStack, toastFromItem, type Toast } from "@/components/inbox-toast";
import { FamiliarGlyphPicker } from "@/components/familiar-glyph-picker";
import { Shell, ShellNav, ShellNavHeader, type ShellNavItem } from "@/components/shell";
import { ChooserModal, type ChooserOption } from "@/components/ui/chooser-modal";
import { DockChat } from "@/components/ui/dock-chat";
import { nativeNotify } from "@/lib/native-notify";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import type { Familiar, SessionRow } from "@/lib/types";

type Mode = "chats" | "board" | "plugins" | "inbox" | "vals-inbox";

export function Workspace() {
  const routerRef = useRef<ChatRouterHandle | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [familiarsError, setFamiliarsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [daemonRunning, setDaemonRunning] = useState<boolean>(false);
  const [responseNeeded, setResponseNeeded] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("chats");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxPrefs, setInboxPrefs] = useState<InboxPrefs>({
    version: 1,
    mutedFamiliars: [],
    sound: { mode: "default" },
  });
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [reminderModalDefaults, setReminderModalDefaults] = useState<{
    title: string;
    whenText: string;
  }>({ title: "", whenText: "" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [glyphPickerFor, setGlyphPickerFor] = useState<Familiar | null>(null);
  const [addChooserOpen, setAddChooserOpen] = useState(false);
  const responseNeededRef = useRef(responseNeeded);
  responseNeededRef.current = responseNeeded;

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
      const list = (json.familiars ?? []) as Familiar[];
      setFamiliars(list);
      setActiveId((curr) => curr ?? list[0]?.id ?? null);
    } catch (err) {
      setFamiliars([]);
      setFamiliarsError(err instanceof Error ? err.message : "fetch failed");
    }
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
          setReminderModalDefaults({ title: "", whenText: "" });
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

  const openReminderModal = useCallback((title = "", whenText = "") => {
    setReminderModalDefaults({ title, whenText });
    setReminderModalOpen(true);
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

  const openToastTarget = useCallback((toast: Toast) => {
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    if (toast.sessionId) {
      if (toast.familiarId) setActiveId(toast.familiarId);
      setMode("chats");
      setTimeout(() => routerRef.current?.openSession(toast.sessionId!), 0);
    } else {
      setMode("inbox");
    }
  }, []);

  const onPaletteIntent = (intent: PaletteIntent) => {
    if (intent.kind === "switch-familiar") {
      setActiveId(intent.familiarId);
      routerRef.current?.goToList();
      return;
    }
    if (intent.kind === "open-session") {
      if (intent.familiarId) setActiveId(intent.familiarId);
      // Defer so familiar swap settles, then open session
      setTimeout(() => routerRef.current?.openSession(intent.sessionId), 0);
      return;
    }
    if (intent.kind === "new-chat") {
      if (intent.familiarId) setActiveId(intent.familiarId);
      setTimeout(() => routerRef.current?.newChat(), 0);
      return;
    }
    if (intent.kind === "back-to-list") {
      routerRef.current?.goToList();
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
      // Switch to Chats view (memory inspector lives in the right pane), and
      // surface the path via a hash that InspectorPane can wire to in a
      // follow-up commit; for now this is a no-op visual placeholder.
      setMode("chats");
      window.location.hash = `memory:${encodeURIComponent(intent.path)}`;
      return;
    }
    if (intent.kind === "slash") {
      // Map slash commands directly to local actions
      switch (intent.command) {
        case "/new":
          setMode("chats");
          routerRef.current?.newChat();
          return;
        case "/board":
          setMode("board");
          return;
        case "/chats":
          setMode("chats");
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
        case "/quit":
          setMode("chats");
          routerRef.current?.goToList();
          return;
        case "/sessions":
          setMode("chats");
          routerRef.current?.goToList();
          return;
        case "/familiar": {
          const name = (intent.args ?? "").trim().toLowerCase();
          if (name) {
            const match = familiars.find(
              (f) => f.id === name || f.display_name.toLowerCase() === name,
            );
            if (match) {
              setActiveId(match.id);
              setMode("chats");
              routerRef.current?.goToList();
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
          if (target?.familiarId) setActiveId(target.familiarId);
          setMode("chats");
          setTimeout(() => routerRef.current?.openSession(sid), 0);
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
  //   list  = only in chats mode (familiar rail). Inbox/Board/Plugins
  //           are full-width detail surfaces — they have their own list
  //           UI baked in and we don't want to double-list.
  //   detail = the active view. Chats mode renders an inline inspector
  //           rail on its right edge so we keep the inspector affordance
  //           without spawning a 4th pane.
  const inboxBadgeCount = inboxItemsWithEphemeral.filter(
    (i) =>
      i.status === "fired" ||
      (i.status === "pending" && i.kind === "response-needed"),
  ).length;

  const navSections = [
    {
      items: [
        {
          id: "search",
          label: "Search…",
          icon: "ph:magnifying-glass" as const,
          kbd: "⌘K",
          onClick: () => setPaletteOpen(true),
        },
        {
          id: "new",
          label: "New chat",
          icon: "ph:note-pencil" as const,
          onClick: () => {
            setMode("chats");
            setTimeout(() => routerRef.current?.newChat(), 0);
          },
        },
        {
          id: "add",
          label: "Add…",
          icon: "ph:plus" as const,
          onClick: () => setAddChooserOpen(true),
        },
      ] as ShellNavItem[],
    },
    {
      label: "Workspace",
      items: [
        {
          id: "chats",
          label: "Chats",
          icon: "ph:chat-circle-dots" as const,
          active: mode === "chats",
          onClick: () => setMode("chats"),
        },
        {
          id: "inbox",
          label: "Inbox",
          icon: "ph:tray" as const,
          active: mode === "inbox",
          onClick: () => setMode("inbox"),
          kbd: inboxBadgeCount > 0 ? String(inboxBadgeCount) : undefined,
        },
        {
          id: "vals-inbox",
          label: "Val's Inbox",
          icon: "ph:bell-fill" as const,
          active: mode === "vals-inbox",
          onClick: () => setMode("vals-inbox"),
        },
        {
          id: "board",
          label: "Board",
          icon: "ph:kanban" as const,
          active: mode === "board",
          onClick: () => setMode("board"),
        },
        {
          id: "plugins",
          label: "Plugins",
          icon: "ph:plug" as const,
          active: mode === "plugins",
          onClick: () => setMode("plugins"),
        },
      ] as ShellNavItem[],
    },
    {
      label: "Configure",
      items: [
        {
          id: "settings",
          label: "Settings",
          icon: "ph:gear-six" as const,
          onClick: openOnboarding,
        },
      ] as ShellNavItem[],
    },
  ];

  const list =
    mode === "chats" ? (
      <FamiliarRail
        familiars={familiars}
        activeId={activeId}
        onSelect={setActiveId}
        onEditGlyph={(f) => setGlyphPickerFor(f)}
        error={familiarsError}
        sessions={sessions}
        responseNeeded={responseNeeded}
        onOpenOnboarding={openOnboarding}
      />
    ) : undefined;

  const detail =
    mode === "chats" ? (
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <ChatRouter
            ref={routerRef}
            familiar={active}
            sessions={sessions}
            daemonRunning={daemonRunning}
            onSessionStarted={loadSessions}
            onSlashFromChat={(command, args) => {
              onPaletteIntent({ kind: "slash", command, args });
              return true;
            }}
            onOpenOnboarding={openOnboarding}
          />
        </div>
        <aside
          className="hidden lg:flex flex-col w-[320px] shrink-0 overflow-y-auto"
          style={{ borderLeft: "1px solid var(--border-hairline)" }}
        >
          <InspectorPane
            familiar={active}
            inboxItems={inboxItemsWithEphemeral}
            onOpenInbox={() => setMode("inbox")}
          />
        </aside>
      </div>
    ) : mode === "board" ? (
      <BoardView
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={activeId}
        onJumpToSession={(sessionId, familiarId) => {
          if (familiarId) setActiveId(familiarId);
          setMode("chats");
          setTimeout(() => routerRef.current?.openSession(sessionId), 0);
        }}
      />
    ) : mode === "inbox" ? (
      <InboxView
        items={inboxItemsWithEphemeral}
        familiars={familiars}
        onRefresh={refreshInbox}
        onNewReminder={() => openReminderModal()}
        onOpenSession={(sessionId, familiarId) => {
          if (familiarId) setActiveId(familiarId);
          setMode("chats");
          setTimeout(() => routerRef.current?.openSession(sessionId), 0);
        }}
      />
    ) : mode === "vals-inbox" ? (
      <ValsInboxView
        onOpenSource={(item) => {
          if (item.sourceSessionKey) {
            setMode("chats");
            setTimeout(() => routerRef.current?.openSession(item.sourceSessionKey!), 0);
          } else if (item.sourceUrl) {
            window.open(item.sourceUrl, "_blank", "noopener");
          }
        }}
      />
    ) : (
      <PluginsView
        onOpenChat={() => {
          setMode("chats");
          setTimeout(() => routerRef.current?.newChat(), 0);
        }}
      />
    );

  return (
    <>
      <Shell
        topBar={
          <DaemonBar
            mode={mode}
            onModeChange={setMode}
            inboxBadgeCount={inboxBadgeCount}
            onRunningChange={setDaemonRunning}
            inboxItems={inboxItemsWithEphemeral}
            inboxPrefs={inboxPrefs}
            familiars={familiars}
            onPrefsChanged={refreshPrefs}
            onOpenInbox={() => setMode("inbox")}
            onOpenInboxItem={(item) => {
              if (item.sessionId) {
                if (item.familiarId) setActiveId(item.familiarId);
                setMode("chats");
                setTimeout(
                  () => routerRef.current?.openSession(item.sessionId!),
                  0,
                );
              } else {
                setMode("inbox");
              }
            }}
          />
        }
        nav={
          <ShellNav
            header={<ShellNavHeader initial="C" label="CovenCave" />}
            sections={navSections}
          />
        }
        list={list}
        detail={detail}
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

      <DockChat
        onSubmit={() => {
          setMode("chats");
          setTimeout(() => routerRef.current?.newChat(), 0);
        }}
      />
    </>
  );
}
