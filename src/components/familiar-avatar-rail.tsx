"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
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
  sidebarOpen?: boolean;
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
  sidebarOpen,
}: Props) {
  const { openFamiliarStudio, openFamiliarStudioListView } = useFamiliarStudio();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const avatarListRef = useRef<HTMLUListElement | null>(null);
  useRovingTabIndex({
    containerRef: avatarListRef,
    itemSelector: ".familiar-avatar-rail__avatar:not([disabled])",
    orientation: "vertical",
  });

  // Dismiss the + context menu on outside click or Esc.
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".familiar-avatar-rail__add-menu")) return;
      if (target?.closest(".familiar-avatar-rail__add")) return;
      setAddMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [addMenuOpen]);

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
      <ul
        ref={avatarListRef}
        className="familiar-avatar-rail__list"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Familiars"
      >
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
                <Icon name="ph:dots-three-bold" width={12} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="familiar-avatar-rail__add-wrap">
        <button
          type="button"
          className="familiar-avatar-rail__add"
          aria-label="Add familiar"
          aria-haspopup="menu"
          aria-expanded={addMenuOpen ? "true" : undefined}
          title="Add familiar (right-click for more)"
          onClick={onAddFamiliar}
          onContextMenu={(e) => {
            e.preventDefault();
            setAddMenuOpen((open) => !open);
          }}
        >
          <Icon name="ph:plus-bold" width={12} />
        </button>
        {addMenuOpen ? (
          <div
            role="menu"
            className="familiar-avatar-rail__add-menu"
            aria-label="Familiar actions"
          >
            <button
              type="button"
              role="menuitem"
              className="familiar-avatar-rail__add-menu-item"
              onClick={() => {
                setAddMenuOpen(false);
                onAddFamiliar();
              }}
            >
              <Icon name="ph:plus-bold" width={12} />
              <span>New familiar</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="familiar-avatar-rail__add-menu-item"
              onClick={() => {
                setAddMenuOpen(false);
                openFamiliarStudioListView();
              }}
            >
              <Icon name="ph:list-bullets" width={12} />
              <span>Manage familiars…</span>
            </button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="familiar-avatar-rail__toggle"
        aria-label="Toggle sidebar"
        aria-expanded={sidebarOpen ?? true}
        title="Toggle sidebar (⌘B)"
        onClick={onToggleSidebar}
      >
        <Icon name="ph:sidebar-simple" width={14} />
      </button>
    </aside>
  );
}
