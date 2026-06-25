"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { useFamiliarPins } from "@/lib/use-familiar-quick-switch";
import { setPins, togglePin } from "@/lib/familiar-quick-switch";
import type { Familiar } from "@/lib/types";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Settings control for the order pinned familiars appear in the top-bar avatar
 * strip. Pinned familiars are drag-to-reorder (persisted via `setPins`); each
 * can be unpinned, and any unpinned familiar can be pinned from the chip row.
 *
 * Standalone like the other Settings panels — it sources its own familiar
 * roster (resolved with cave overrides) rather than relying on workspace state.
 */
export function FamiliarPinOrder() {
  const [rawFamiliars, setRawFamiliars] = useState<Familiar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const resolved = useResolvedFamiliars(rawFamiliars);
  const pins = useFamiliarPins();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/familiars", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setRawFamiliars((json.familiars ?? []) as Familiar[]);
      } catch {
        /* transient — keep last good list */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, ResolvedFamiliar>();
    resolved.forEach((f) => m.set(f.id, f));
    return m;
  }, [resolved]);

  // Pinned, in pin order, dropping any that no longer exist.
  const pinned = useMemo(
    () => pins.map((id) => byId.get(id)).filter((f): f is ResolvedFamiliar => Boolean(f)),
    [pins, byId],
  );
  const unpinned = useMemo(
    () => resolved.filter((f) => !pins.includes(f.id)),
    [resolved, pins],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pinnedIds = useMemo(() => pinned.map((f) => f.id), [pinned]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pinnedIds.indexOf(String(active.id));
    const newIndex = pinnedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setPins(arrayMove(pinnedIds, oldIndex, newIndex));
  }

  if (!loaded) {
    return <p className="familiar-pin-order__hint" role="status" aria-busy="true">Loading familiars…</p>;
  }

  return (
    <div className="familiar-pin-order">
      {pinned.length > 0 ? (
        <DndContext id="familiar-pin-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
            <ul className="familiar-pin-order__list" aria-label="Reorder pinned familiars">
              {pinned.map((f) => (
                <SortablePinRow key={f.id} familiar={f} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="familiar-pin-order__hint">
          No pinned familiars yet — pin one below to keep it at the front of the avatar strip.
        </p>
      )}

      {unpinned.length > 0 ? (
        <div className="familiar-pin-order__add">
          <span className="familiar-pin-order__add-label">Add a pin</span>
          <ul className="familiar-pin-order__chips" aria-label="Pin a familiar">
            {unpinned.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="familiar-pin-order__chip focus-ring"
                  style={{ ["--familiar-accent" as string]: f.color } as CSSProperties}
                  onClick={() => togglePin(f.id)}
                  aria-label={`Pin ${f.display_name}`}
                  title={`Pin ${f.display_name}`}
                >
                  <FamiliarAvatar familiar={f} size="sm" />
                  <span className="familiar-pin-order__chip-name">{f.display_name}</span>
                  <Icon name="ph:push-pin" width={11} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SortablePinRow({ familiar }: { familiar: ResolvedFamiliar }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: familiar.id,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    ["--familiar-accent" as string]: familiar.color,
  } as CSSProperties;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="familiar-pin-order__row"
      data-dragging={isDragging || undefined}
    >
      <button
        type="button"
        className="familiar-pin-order__handle"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${familiar.display_name}`}
      >
        <Icon name="ph:dots-six-vertical" width={13} className="familiar-pin-order__grip" aria-hidden />
        <span className="familiar-pin-order__avatar">
          <FamiliarAvatar familiar={familiar} size="sm" />
        </span>
        <span className="familiar-pin-order__name">{familiar.display_name}</span>
        {familiar.role ? <span className="familiar-pin-order__role">{familiar.role}</span> : null}
      </button>
      <button
        type="button"
        className="familiar-pin-order__unpin focus-ring"
        onClick={() => togglePin(familiar.id)}
        aria-label={`Unpin ${familiar.display_name}`}
        title="Unpin from quick switch"
      >
        <Icon name="ph:push-pin-fill" width={12} aria-hidden />
      </button>
    </li>
  );
}
