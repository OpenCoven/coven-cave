"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const avatarListRef = useRef<HTMLUListElement | null>(null);
  useRovingTabIndex({
    containerRef: avatarListRef,
    itemSelector: ".familiar-avatar-rail__avatar:not([disabled])",
    orientation: "vertical",
  });

  // Drag-to-reorder via @dnd-kit. PointerSensor's activation distance lets
  // a quick tap on the avatar select the familiar instead of starting a
  // drag — only deliberate pointer movement (>=5px) crosses the threshold.
  // KeyboardSensor pairs with the existing roving tabindex so keyboard
  // users can still reorder via Space + arrows.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const familiarIds = useMemo(() => familiars.map((f) => f.id), [familiars]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = familiarIds.indexOf(String(active.id));
    const newIndex = familiarIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setFamiliarOrder(arrayMove(familiarIds, oldIndex, newIndex));
  }

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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={familiarIds} strategy={verticalListSortingStrategy}>
          <ul
            ref={avatarListRef}
            className="familiar-avatar-rail__list"
            role="toolbar"
            aria-orientation="vertical"
            aria-label="Familiars"
          >
            {familiars.map((f) => {
              const needsReply = responseNeeded.has(f.id);
              const presence = computePresence({
                familiar: f,
                sessions,
                needsReply,
                harnessInstalled: f.harness ? harnessInstalled?.(f.harness) : undefined,
                isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
              });
              return (
                <SortableAvatarItem
                  key={f.id}
                  familiar={f}
                  active={f.id === activeId}
                  needsReply={needsReply}
                  liveCount={liveCounts.get(f.id) ?? 0}
                  presence={presence}
                  onSelect={() => onSelect(f.id)}
                  onOpenStudio={() => openFamiliarStudio(f.id, "identity")}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>

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

function SortableAvatarItem({
  familiar,
  active,
  needsReply,
  liveCount,
  presence,
  onSelect,
  onOpenStudio,
}: {
  familiar: ResolvedFamiliar;
  active: boolean;
  needsReply: boolean;
  liveCount: number;
  presence: { label: string; dot: string };
  onSelect: () => void;
  onOpenStudio: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: familiar.id,
  });
  // CSS.Translate (not Transform) so the avatar tracks the cursor
  // without rotating or scaling — the rail items are uniformly sized
  // so the simpler transform avoids snap-back artefacts on drop.
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    "--familiar-accent": familiar.color,
  } as CSSProperties;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="familiar-avatar-rail__item"
      data-dragging={isDragging ? "true" : undefined}
      data-drop-target={isOver && !isDragging ? "true" : undefined}
    >
      <button
        type="button"
        data-id={familiar.id}
        className={`familiar-avatar-rail__avatar${active ? " familiar-avatar-rail__avatar--active" : ""}`}
        title={`${familiar.display_name} · ${presence.label}`}
        onClick={onSelect}
        onContextMenu={(e) => { e.preventDefault(); onOpenStudio(); }}
        {...attributes}
        {...listeners}
        aria-label={`${familiar.display_name}${needsReply ? ` — reply needed` : ""}${liveCount ? ` — ${liveCount} live` : ""}`}
        aria-pressed={active}
      >
        <FamiliarAvatar familiar={familiar} size="sm" />
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
        aria-label={`Customize ${familiar.display_name}`}
        title="Customize"
        onClick={(e) => { e.stopPropagation(); onOpenStudio(); }}
      >
        <Icon name="ph:dots-three-bold" width={12} />
      </button>
    </li>
  );
}
