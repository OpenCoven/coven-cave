"use client";

import { useEffect, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { FamiliarRail } from "@/components/familiar-rail";
import { ChatPane } from "@/components/chat-pane";
import { InspectorPane } from "@/components/inspector-pane";
import { DaemonBar } from "@/components/daemon-bar";
import type { Familiar } from "@/lib/types";

export function Workspace() {
  const leftRef = usePanelRef();
  const rightRef = usePanelRef();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [familiarsError, setFamiliarsError] = useState<string | null>(null);

  const loadFamiliars = async () => {
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
  };

  useEffect(() => {
    loadFamiliars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "b") return;
      e.preventDefault();
      const target = e.shiftKey ? rightRef.current : leftRef.current;
      if (!target) return;
      if (target.isCollapsed()) target.expand();
      else target.collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftRef, rightRef]);

  const active = familiars.find((f) => f.id === activeId) ?? null;
  const handleClass =
    "w-px bg-zinc-800 transition-colors hover:bg-violet-500/60 data-[resize-handle-state=drag]:bg-violet-500";

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100">
      <DaemonBar onDaemonStarted={loadFamiliars} />

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
          />
        </Panel>

        <Separator className={handleClass} />

        <Panel id="chat" defaultSize="50%" minSize="28%">
          <ChatPane familiar={active} />
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
        <span>⌘B rail · ⇧⌘B inspector · drag edges to resize</span>
      </footer>
    </div>
  );
}
