"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Props = {
  familiars: ResolvedFamiliar[];
  activeId: string | null;
  sessions: SessionRow[];
  responseNeeded: Set<string>;
  harnessInstalled?: (harnessId: string) => boolean | undefined;
  onSelect: (id: string) => void;
  onAddFamiliar: () => void;
  onToggleSidebar: () => void;
};

export function FamiliarAvatarRail({
  familiars,
  activeId,
  sessions,
  responseNeeded,
  harnessInstalled,
  onSelect,
  onAddFamiliar,
  onToggleSidebar,
}: Props) {
  const { openFamiliarStudio, openFamiliarStudioListView } = useFamiliarStudio();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function onDragStart(id: string) {
    return (e: React.DragEvent) => {
      setDraggingId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    };
  }

  function onDragOver(id: string) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (id !== draggingId) setDropTargetId(id);
    };
  }

  function onDrop(targetId: string) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/plain") || draggingId;
      setDraggingId(null);
      setDropTargetId(null);
      if (!sourceId || sourceId === targetId) return;
      const ids = familiars.map((f) => f.id);
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      setFamiliarOrder(ids);
    };
  }

  function onDragEnd() {
    setDraggingId(null);
    setDropTargetId(null);
  }

  useEffect(() => {
    if (!activeId) return;
    const el = document.querySelector(
      `.familiar-avatar-rail__avatar[data-id="${activeId}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (!s.familiarId || s.status !== "running") continue;
      m.set(s.familiarId, (m.get(s.familiarId) ?? 0) + 1);
    }
    return m;
  }, [sessions]);

  return (
    <aside
      className="familiar-avatar-rail"
      aria-label="Familiars"
    >
      <ul className="familiar-avatar-rail__list">
        {familiars.map((f) => {
          const active = f.id === activeId;
          const needsReply = responseNeeded.has(f.id);
          const presence = computePresence({
            familiar: f,
            sessions,
            needsReply,
            harnessInstalled: f.harness ? harnessInstalled?.(f.harness) : undefined,
            isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
          });
          const liveCount = liveCounts.get(f.id) ?? 0;
          return (
            <li
              key={f.id}
              className="familiar-avatar-rail__item"
              draggable
              onDragStart={onDragStart(f.id)}
              onDragOver={onDragOver(f.id)}
              onDrop={onDrop(f.id)}
              onDragEnd={onDragEnd}
              data-dragging={draggingId === f.id ? "true" : undefined}
              data-drop-target={dropTargetId === f.id ? "true" : undefined}
            >
              <button
                type="button"
                data-id={f.id}
                className={`familiar-avatar-rail__avatar${active ? " familiar-avatar-rail__avatar--active" : ""}`}
                style={{ "--familiar-accent": f.color } as React.CSSProperties}
                aria-label={`${f.display_name}${needsReply ? ` — reply needed` : ""}${liveCount ? ` — ${liveCount} live` : ""}`}
                aria-pressed={active}
                title={`${f.display_name} · ${presence.label}`}
                onClick={() => onSelect(f.id)}
                onContextMenu={(e) => { e.preventDefault(); openFamiliarStudio(f.id, "identity"); }}
              >
                <FamiliarAvatar familiar={f} size="sm" />
                <span
                  className={`familiar-avatar-rail__presence ${presence.dot}`}
                  aria-hidden
                />
                {needsReply ? (
                  <span
                    className="familiar-avatar-rail__unread"
                    aria-hidden
                  />
                ) : null}
              </button>
              <button
                type="button"
                className="familiar-avatar-rail__edit"
                aria-label={`Customize ${f.display_name}`}
                title="Customize"
                onClick={(e) => { e.stopPropagation(); openFamiliarStudio(f.id, "identity"); }}
              >
                <Icon name="ph:dots-three-bold" width={10} />
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="familiar-avatar-rail__add"
        aria-label="Add familiar"
        title="Add familiar (right-click to manage)"
        onClick={onAddFamiliar}
        onContextMenu={(e) => {
          e.preventDefault();
          openFamiliarStudioListView();
        }}
      >
        <Icon name="ph:plus-bold" width={12} />
      </button>

      <button
        type="button"
        className="familiar-avatar-rail__toggle"
        aria-label="Toggle sidebar"
        title="Toggle sidebar (⌘B)"
        onClick={onToggleSidebar}
      >
        <Icon name="ph:sidebar-simple" width={14} />
      </button>
    </aside>
  );
}
