"use client";

import { useState, type CSSProperties } from "react";
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
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import {
  archiveFamiliar,
  unarchiveFamiliar,
  useArchivedFamiliars,
} from "@/lib/cave-familiar-archive";
import { clearAllFamiliarOverrides } from "@/lib/cave-familiar-overrides";
import { clearGlyphOverride } from "@/lib/cave-glyph-overrides";
import { clearFamiliarImage } from "@/lib/cave-familiar-images";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  familiar: ResolvedFamiliar | null;
  allResolved: ResolvedFamiliar[];
};

export function FamiliarStudioLifecycleTab({ familiar, allResolved }: Props) {
  const archived = useArchivedFamiliars();
  const { openFamiliarStudio } = useFamiliarStudio();
  const [confirmReset, setConfirmReset] = useState(false);

  // The full roster (active + archived) with reorder + archive — this is the
  // manager that used to live in the standalone "Manage familiars" page. It now
  // renders here so Settings → Familiars is the single source of truth, with the
  // selected familiar's per-familiar controls (reset) below it.
  const active = allResolved.filter((f) => !(f.id in archived));
  const archivedList = allResolved.filter((f) => f.id in archived);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Rebuild the full roster order from a reordered active list, keeping archived
  // familiars in their existing slots — the same order model the up/down arrows
  // persist through.
  function reorderTo(activeIds: string[]) {
    let ai = 0;
    const fullIds = allResolved.map((f) => (f.id in archived ? f.id : activeIds[ai++]));
    setFamiliarOrder(fullIds);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const ids = active.map((f) => f.id);
    const oldIndex = ids.indexOf(String(dragged.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorderTo(arrayMove(ids, oldIndex, newIndex));
  }

  function move(id: string, direction: "up" | "down") {
    const ids = allResolved.map((f) => f.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= ids.length) return;
    // Only swap within the active group — refuse to move past an archived neighbor.
    const swapId = ids[swapIdx];
    if (swapId in archived) return;
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    setFamiliarOrder(ids);
  }

  function resetAll() {
    if (!familiar) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    clearAllFamiliarOverrides(familiar.id);
    clearGlyphOverride(familiar.id);
    void clearFamiliarImage(familiar.id);
    void fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiars: { [familiar.id]: null } }),
    });
    setConfirmReset(false);
  }

  return (
    <div className="familiar-studio-lifecycle">
      <section>
        <h3 className="familiar-studio-lifecycle__heading">Active</h3>
        <p className="familiar-studio-lifecycle__hint">
          Sets the roster order across the app. The avatar strip's pinned order
          is separate —{" "}
          <button
            type="button"
            className="familiar-studio-lifecycle__hint-link focus-ring"
            onClick={() => {
              window.location.hash = "appearance";
            }}
          >
            set it in Appearance
          </button>
          .
        </p>
        <DndContext
          id="familiar-lifecycle-order"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={active.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            {active.map((f, i) => (
              <SortableFamiliarRow
                key={f.id}
                familiar={f}
                canMoveUp={i > 0}
                canMoveDown={i < active.length - 1}
                onSelect={() => openFamiliarStudio(f.id, "identity")}
                onArchive={() => archiveFamiliar(f.id)}
                onUnarchive={() => unarchiveFamiliar(f.id)}
                onMoveUp={() => move(f.id, "up")}
                onMoveDown={() => move(f.id, "down")}
              />
            ))}
          </SortableContext>
        </DndContext>
      </section>
      {archivedList.length > 0 ? (
        <section>
          <h3 className="familiar-studio-lifecycle__heading">Archived</h3>
          {archivedList.map((f) => (
            <FamiliarRow
              key={f.id}
              familiar={f}
              isArchived={true}
              canMoveUp={false}
              canMoveDown={false}
              onSelect={() => openFamiliarStudio(f.id, "identity")}
              onArchive={() => archiveFamiliar(f.id)}
              onUnarchive={() => unarchiveFamiliar(f.id)}
              onMoveUp={() => { /* no-op */ }}
              onMoveDown={() => { /* no-op */ }}
            />
          ))}
        </section>
      ) : null}

      {familiar ? (
        <section className="familiar-studio-lifecycle__section">
          <h3 className="familiar-studio-lifecycle__heading">Reset overrides</h3>
          <p className="familiar-studio-lifecycle__hint">
            Clears {familiar.display_name}&apos;s identity / look / brain customizations and
            reverts it to its daemon defaults.
          </p>
          <button
            onClick={resetAll}
            className={`familiar-studio-lifecycle__btn familiar-studio-lifecycle__btn--danger${confirmReset ? " familiar-studio-lifecycle__btn--confirm" : ""}`}
          >
            <Icon name="ph:trash" width={14} />
            {confirmReset ? "Click again to confirm" : "Reset all overrides"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

// Active rows are draggable; the sortable wrapper feeds the drag handle +
// transform down into the shared FamiliarRow.
function SortableFamiliarRow(props: {
  familiar: ResolvedFamiliar;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.familiar.id,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <FamiliarRow
      {...props}
      isArchived={false}
      dragRef={setNodeRef}
      dragStyle={style}
      isDragging={isDragging}
      dragHandle={{ ...attributes, ...listeners }}
    />
  );
}

function FamiliarRow({
  familiar,
  isArchived,
  canMoveUp,
  canMoveDown,
  onSelect,
  onArchive,
  onUnarchive,
  onMoveUp,
  onMoveDown,
  dragRef,
  dragStyle,
  isDragging,
  dragHandle,
}: {
  familiar: ResolvedFamiliar;
  isArchived: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: CSSProperties;
  isDragging?: boolean;
  dragHandle?: Record<string, unknown>;
}) {
  return (
    <div
      ref={dragRef}
      style={dragStyle}
      data-dragging={isDragging || undefined}
      className="familiar-studio-lifecycle__row"
    >
      {dragHandle ? (
        <button
          type="button"
          className="familiar-studio-lifecycle__grip focus-ring"
          aria-label={`Drag to reorder ${familiar.display_name}`}
          {...dragHandle}
        >
          <Icon name="ph:dots-six-vertical" width={13} aria-hidden />
        </button>
      ) : null}
      <button type="button" onClick={onSelect} className="familiar-studio-lifecycle__row-main">
        <FamiliarAvatar familiar={familiar} size="sm" />
        <span>{familiar.display_name}</span>
      </button>
      {!isArchived ? (
        <>
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label={`Move ${familiar.display_name} up`}
            className="familiar-studio-lifecycle__row-action"
          >
            <Icon name="ph:arrow-up-bold" width={12} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label={`Move ${familiar.display_name} down`}
            className="familiar-studio-lifecycle__row-action"
          >
            <Icon name="ph:arrow-down-bold" width={12} />
          </button>
        </>
      ) : null}
      {isArchived ? (
        <button onClick={onUnarchive} aria-label="Unarchive" className="familiar-studio-lifecycle__row-action">
          <Icon name="ph:arrow-counter-clockwise" width={12} />
        </button>
      ) : (
        <button onClick={onArchive} aria-label="Archive" className="familiar-studio-lifecycle__row-action">
          <Icon name="ph:archive" width={12} />
        </button>
      )}
    </div>
  );
}
