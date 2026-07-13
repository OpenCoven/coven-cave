"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { UndoToast } from "@/components/ui/undo-toast";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  archiveFamiliar,
  unarchiveFamiliar,
  useArchivedFamiliars,
} from "@/lib/cave-familiar-archive";
import { clearAllFamiliarOverrides } from "@/lib/cave-familiar-overrides";
import { clearGlyphOverride } from "@/lib/cave-glyph-overrides";
import { clearFamiliarImage } from "@/lib/cave-familiar-images";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { relativeTime } from "@/lib/relative-time";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { useUndoDelete } from "@/lib/use-undo-delete";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  familiar: ResolvedFamiliar | null;
  allResolved: ResolvedFamiliar[];
  /** Re-fetch the roster after a remove/restore lands server-side. */
  onRosterChanged?: () => void;
};

type RemovedFamiliarSummary = { id: string; displayName: string; removedAt: string };

export function FamiliarStudioLifecycleTab({ familiar, allResolved, onRosterChanged }: Props) {
  const archived = useArchivedFamiliars();
  const { openFamiliarStudio } = useFamiliarStudio();
  const { announce } = useAnnouncer();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ResolvedFamiliar | null>(null);
  const [removedEntries, setRemovedEntries] = useState<RemovedFamiliarSummary[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Ids whose DELETE has committed but whose roster refresh hasn't landed yet —
  // keeps the row from flashing back between commit and re-fetch.
  const [removedLocally, setRemovedLocally] = useState<Set<string>>(new Set());
  const {
    pending: pendingRemove,
    scheduleDelete,
    undo: undoRemove,
    commit: commitRemove,
  } = useUndoDelete<ResolvedFamiliar>();

  // The full roster (active + archived) with reorder + archive — this is the
  // manager that used to live in the standalone "Manage familiars" page. It now
  // renders here so Settings → Familiars is the single source of truth, with the
  // selected familiar's per-familiar controls (reset) below it.
  //
  // A familiar pending removal hides from BOTH lists during the undo window —
  // the UndoToast is its only handle until the delete commits or is undone
  // (same optimistic pattern as board/vault/journal).
  const pendingRemoveId = pendingRemove?.item.id ?? null;
  const hidden = (f: ResolvedFamiliar) => f.id === pendingRemoveId || removedLocally.has(f.id);
  const active = allResolved.filter((f) => !(f.id in archived) && !hidden(f));
  const archivedList = allResolved.filter((f) => f.id in archived && !hidden(f));

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

  const removedCtlRef = useRef<AbortController | null>(null);
  const loadRemoved = useCallback(async () => {
    removedCtlRef.current?.abort();
    const ctl = new AbortController();
    removedCtlRef.current = ctl;
    try {
      const res = await fetch("/api/familiars/removed", { cache: "no-store", signal: ctl.signal });
      const json = await res.json().catch(() => null);
      if (ctl.signal.aborted) return;
      if (json?.ok) setRemovedEntries((json.removed ?? []) as RemovedFamiliarSummary[]);
    } catch {
      /* transient (or aborted) — keep the last list */
    }
  }, []);

  useEffect(() => {
    void loadRemoved();
    return () => removedCtlRef.current?.abort();
  }, [loadRemoved]);

  // Remove ≠ Archive: it detaches the familiar server-side (roster entry +
  // agent binding), while chats, memory, and workspace files stay on disk.
  // The DELETE is deferred through useUndoDelete, so Undo/⌘Z during the toast
  // window means nothing was ever sent.
  function performRemove(f: ResolvedFamiliar) {
    setConfirmRemove(null);
    scheduleDelete(f, f.display_name, async () => {
      setRemovedLocally((prev) => new Set(prev).add(f.id));
      try {
        const res = await fetch(`/api/familiars/${encodeURIComponent(f.id)}`, { method: "DELETE" });
        const json = await res.json().catch(() => null);
        if (!res.ok || json?.ok === false) {
          throw new Error(typeof json?.error === "string" ? json.error : `remove failed (${res.status})`);
        }
        announce(`Removed ${f.display_name}. Restore it from Recently removed.`);
      } catch (err) {
        setRemovedLocally((prev) => {
          const next = new Set(prev);
          next.delete(f.id);
          return next;
        });
        announce(
          `Could not remove ${f.display_name}: ${err instanceof Error ? err.message : "unknown error"}`,
          "assertive",
        );
      } finally {
        void loadRemoved();
        onRosterChanged?.();
      }
    });
  }

  async function restoreRemoved(entry: RemovedFamiliarSummary) {
    setRestoringId(entry.id);
    try {
      const res = await fetch("/api/familiars/removed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) {
        throw new Error(typeof json?.error === "string" ? json.error : `restore failed (${res.status})`);
      }
      setRemovedLocally((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
      announce(`Restored ${entry.displayName}.`);
      onRosterChanged?.();
    } catch (err) {
      announce(
        `Could not restore ${entry.displayName}: ${err instanceof Error ? err.message : "unknown error"}`,
        "assertive",
      );
    } finally {
      setRestoringId(null);
      void loadRemoved();
    }
  }

  return (
    <div className="familiar-studio-lifecycle">
      <p className="familiar-studio-lifecycle__hint">
        Archive hides a familiar from switchers but keeps it bound — unarchive anytime. Remove
        detaches it from your Cave; chats, memory, and workspace files stay on disk, and a removal
        can be undone from Recently removed.
      </p>
      <section>
        <h3 className="familiar-studio-lifecycle__heading">Active</h3>
        <p className="familiar-studio-lifecycle__hint">
          Sets the roster order across the app. The avatar strip&apos;s pinned order is separate.
        </p>
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          leadingIcon="ph:paint-brush"
          onClick={() => {
            window.location.hash = "appearance";
          }}
        >
          Open Appearance
        </Button>
        <DndContext
          id="familiar-lifecycle-order"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={active.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            {active.map((f, i) => (
              <Fragment key={f.id}>
                <SortableFamiliarRow
                  familiar={f}
                  canMoveUp={i > 0}
                  canMoveDown={i < active.length - 1}
                  onSelect={() => openFamiliarStudio(f.id, "identity")}
                  onArchive={() => archiveFamiliar(f.id)}
                  onUnarchive={() => unarchiveFamiliar(f.id)}
                  onRemove={() => setConfirmRemove(f)}
                  onMoveUp={() => move(f.id, "up")}
                  onMoveDown={() => move(f.id, "down")}
                />
                {confirmRemove?.id === f.id ? (
                  <RemoveConfirm
                    familiar={f}
                    onConfirm={() => performRemove(f)}
                    onCancel={() => setConfirmRemove(null)}
                  />
                ) : null}
              </Fragment>
            ))}
          </SortableContext>
        </DndContext>
      </section>
      {archivedList.length > 0 ? (
        <section>
          <h3 className="familiar-studio-lifecycle__heading">Archived</h3>
          <p className="familiar-studio-lifecycle__hint">
            Hidden from switchers, still bound to their runtimes and memory.
          </p>
          {archivedList.map((f) => (
            <Fragment key={f.id}>
              <FamiliarRow
                familiar={f}
                isArchived={true}
                canMoveUp={false}
                canMoveDown={false}
                onSelect={() => openFamiliarStudio(f.id, "identity")}
                onArchive={() => archiveFamiliar(f.id)}
                onUnarchive={() => unarchiveFamiliar(f.id)}
                onRemove={() => setConfirmRemove(f)}
                onMoveUp={() => { /* no-op */ }}
                onMoveDown={() => { /* no-op */ }}
              />
              {confirmRemove?.id === f.id ? (
                <RemoveConfirm
                  familiar={f}
                  onConfirm={() => performRemove(f)}
                  onCancel={() => setConfirmRemove(null)}
                />
              ) : null}
            </Fragment>
          ))}
        </section>
      ) : null}

      {removedEntries.length > 0 ? (
        <section className="familiar-studio-lifecycle__section">
          <h3 className="familiar-studio-lifecycle__heading">Recently removed</h3>
          <p className="familiar-studio-lifecycle__hint">
            Removed familiars keep their chats, memory, and files on disk. Restore re-registers one
            exactly as it was — kept for 30 days.
          </p>
          {removedEntries.map((entry) => (
            <div key={entry.id} className="familiar-studio-lifecycle__removed-row">
              <span className="familiar-studio-lifecycle__removed-name">{entry.displayName}</span>
              <span className="familiar-studio-lifecycle__removed-when">
                removed {relativeTime(entry.removedAt)}
              </span>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => void restoreRemoved(entry)}
                disabled={restoringId !== null}
                loading={restoringId === entry.id}
                leadingIcon="ph:arrow-counter-clockwise"
              >
                {restoringId === entry.id ? "Restoring…" : "Restore"}
              </Button>
            </div>
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
          <Button
            variant="danger"
            size="sm"
            className="self-start"
            onClick={resetAll}
            leadingIcon="ph:trash"
          >
            {confirmReset ? "Click again to confirm" : "Reset all overrides"}
          </Button>
        </section>
      ) : null}

      {pendingRemove ? (
        <UndoToast
          key={pendingRemove.id}
          message={<>Removed <strong>{pendingRemove.label}</strong></>}
          undoAriaLabel={`Undo removing ${pendingRemove.label}`}
          onUndo={undoRemove}
          onDismiss={commitRemove}
        />
      ) : null}
    </div>
  );
}

// The destructive half of the remove flow: an inline confirm strip that spells
// out detach semantics (what is cleared vs. what survives) before anything is
// scheduled — required in-product copy for the safety constraints of removal.
function RemoveConfirm({
  familiar,
  onConfirm,
  onCancel,
}: {
  familiar: ResolvedFamiliar;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sessions = familiar.active_sessions ?? 0;
  return (
    <div
      className="familiar-studio-lifecycle__confirm"
      role="group"
      aria-label={`Confirm removing ${familiar.display_name}`}
    >
      <p className="familiar-studio-lifecycle__confirm-title">Remove {familiar.display_name}?</p>
      <p className="familiar-studio-lifecycle__confirm-copy">
        This detaches {familiar.display_name} from your Cave — its roster entry and agent binding
        are cleared. The agent itself, past chats, and memory files stay on
        your disk, and you can restore it from Recently removed.
      </p>
      {sessions > 0 ? (
        <p className="familiar-studio-lifecycle__confirm-copy familiar-studio-lifecycle__confirm-warn">
          {familiar.display_name} has {sessions} active session{sessions === 1 ? "" : "s"} — they keep
          running until they finish.
        </p>
      ) : null}
      <div className="familiar-studio-lifecycle__confirm-actions">
        <Button
          variant="danger"
          size="sm"
          onClick={onConfirm}
          leadingIcon="ph:trash"
        >
          Remove familiar
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
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
  onRemove: () => void;
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
  onRemove,
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
  onRemove: () => void;
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
          <IconButton
            icon="ph:arrow-up-bold"
            size="xs"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label={`Move ${familiar.display_name} up`}
          />
          <IconButton
            icon="ph:arrow-down-bold"
            size="xs"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label={`Move ${familiar.display_name} down`}
          />
        </>
      ) : null}
      {isArchived ? (
        <IconButton
          icon="ph:arrow-counter-clockwise"
          size="xs"
          onClick={onUnarchive}
          aria-label={`Unarchive ${familiar.display_name}`}
          title="Unarchive — return to the active roster"
        />
      ) : (
        <IconButton
          icon="ph:archive"
          size="xs"
          onClick={onArchive}
          aria-label={`Archive ${familiar.display_name}`}
          title="Archive — hide from switchers; stays bound, unarchive anytime"
        />
      )}
      <IconButton
        icon="ph:trash"
        size="xs"
        danger
        onClick={onRemove}
        aria-label={`Remove ${familiar.display_name}`}
        title="Remove — detach from your Cave (undo-safe); chats and memory stay on disk"
      />
    </div>
  );
}
