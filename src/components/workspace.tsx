"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { FamiliarRail } from "@/components/familiar-rail";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { InspectorPane } from "@/components/inspector-pane";
import { DaemonBar } from "@/components/daemon-bar";
import { CommandPalette, type PaletteIntent } from "@/components/command-palette";
import type { Familiar, SessionRow } from "@/lib/types";

export function Workspace() {
  const leftRef = usePanelRef();
  const rightRef = usePanelRef();
  const routerRef = useRef<ChatRouterHandle | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [familiarsError, setFamiliarsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [daemonRunning, setDaemonRunning] = useState<boolean>(false);
  const [responseNeeded, setResponseNeeded] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        const target = e.shiftKey ? rightRef.current : leftRef.current;
        if (!target) return;
        if (target.isCollapsed()) target.expand();
        else target.collapse();
        return;
      }
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftRef, rightRef]);

  const setFamiliarResponse = useCallback((familiarId: string, needed: boolean) => {
    void familiarId;
    void needed;
    setResponseNeeded((prev) => prev);
  }, []);
  void setFamiliarResponse;

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
    if (intent.kind === "slash") {
      // Map slash commands directly to local actions
      switch (intent.command) {
        case "/new":
          routerRef.current?.newChat();
          return;
        case "/sessions":
          routerRef.current?.goToList();
          return;
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
  const handleClass =
    "w-px bg-zinc-800 transition-colors hover:bg-violet-500/60 data-[resize-handle-state=drag]:bg-violet-500";

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100">
      <DaemonBar
        onDaemonStarted={loadFamiliars}
        sessions={sessions}
        responseNeededCount={responseNeeded.size}
        onRunningChange={setDaemonRunning}
      />

      <Group orientation="horizontal" className="flex-1 min-h-0 flex">
        <Panel
          panelRef={leftRef}
          id="rail"
          defaultSize="22%"
          minSize="18%"
          maxSize="34%"
          collapsible
          collapsedSize="0%"
        >
          <FamiliarRail
            familiars={familiars}
            activeId={activeId}
            onSelect={setActiveId}
            error={familiarsError}
            sessions={sessions}
            responseNeeded={responseNeeded}
          />
        </Panel>

        <Separator className={handleClass} />

        <Panel id="chat" defaultSize="50%" minSize="28%">
          <ChatRouter
            ref={routerRef}
            familiar={active}
            sessions={sessions}
            daemonRunning={daemonRunning}
            onSessionStarted={loadSessions}
          />
        </Panel>

        <Separator className={handleClass} />

        <Panel
          panelRef={rightRef}
          id="inspector"
          defaultSize="28%"
          minSize="22%"
          maxSize="42%"
          collapsible
          collapsedSize="0%"
        >
          <InspectorPane familiar={active} />
        </Panel>
      </Group>

      <footer className="flex items-center justify-between border-t border-zinc-800 px-3 py-1 text-[10px] text-zinc-500">
        <span>CovenCave · v0</span>
        <span>⌘K palette · ⌘B rail · ⇧⌘B inspector · / slash commands</span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        familiars={familiars}
        sessions={sessions}
        activeFamiliarId={activeId}
        onIntent={onPaletteIntent}
      />
    </div>
  );
}
