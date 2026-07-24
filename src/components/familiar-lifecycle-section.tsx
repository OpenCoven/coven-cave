"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UndoToast } from "@/components/ui/undo-toast";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  archiveFamiliar,
  unarchiveFamiliar,
  useArchivedFamiliars,
} from "@/lib/cave-familiar-archive";
import { relativeTime } from "@/lib/relative-time";
import { useUndoDelete } from "@/lib/use-undo-delete";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  familiar: ResolvedFamiliar;
  /** Re-fetch the roster after a remove/restore lands server-side. */
  onRosterChanged?: () => void;
};

type RemovedFamiliarSummary = { id: string; displayName: string; removedAt: string };

/**
 * Archive + remove controls for the selected familiar, plus the shared
 * "Recently removed" restore shelf. Distilled from the retired Lifecycle tab:
 * roster reordering moved out with the tab, so archive and remove — the only
 * lifecycle verbs left — now live at the bottom of the Identity tab.
 */
export function FamiliarLifecycleSection({ familiar, onRosterChanged }: Props) {
  const archived = useArchivedFamiliars();
  const { announce } = useAnnouncer();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removedEntries, setRemovedEntries] = useState<RemovedFamiliarSummary[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Ids whose DELETE has committed but whose roster refresh hasn't landed yet —
  // keeps the controls from flashing back between commit and re-fetch.
  const [removedLocally, setRemovedLocally] = useState<Set<string>>(new Set());
  const {
    pending: pendingRemove,
    scheduleDelete,
    undo: undoRemove,
    commit: commitRemove,
  } = useUndoDelete<ResolvedFamiliar>();

  const isArchived = familiar.id in archived;
  // A familiar pending removal loses its archive/remove controls during the
  // undo window — the UndoToast is its only handle until the delete commits or
  // is undone (same optimistic pattern as board/vault/journal).
  const pendingRemoveId = pendingRemove?.item.id ?? null;
  const hidden = familiar.id === pendingRemoveId || removedLocally.has(familiar.id);

  useEffect(() => {
    setConfirmRemove(false);
  }, [familiar.id]);

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
    setConfirmRemove(false);
    scheduleDelete(f, f.display_name, async () => {
      setRemovedLocally((prev) => new Set(prev).add(f.id));
      try {
        const res = await fetch(`/api/familiars/${encodeURIComponent(f.id)}`, { method: "DELETE" });
        const json = await res.json().catch(() => null);
        if (!res.ok || json?.ok === false) {
          throw new Error(typeof json?.error === "string" ? json.error : `remove failed (${res.status})`);
        }
        window.dispatchEvent(new Event("cave:familiars-refresh"));
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
      window.dispatchEvent(new Event("cave:familiars-refresh"));
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
    <section className="familiar-studio-lifecycle" aria-label="Lifecycle">
      <div>
        <h3 className="familiar-studio-lifecycle__heading">Lifecycle</h3>
        <p className="familiar-studio-lifecycle__hint">
          Archive hides a familiar from switchers but keeps it bound — unarchive anytime. Remove
          detaches it from your Cave; chats, memory, and workspace files stay on
          your disk, and a removal can be undone from Recently removed.
        </p>
      </div>
      {!hidden ? (
        <div className="familiar-studio-lifecycle__actions">
          {isArchived ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon="ph:arrow-counter-clockwise"
              onClick={() => unarchiveFamiliar(familiar.id)}
              aria-label={`Unarchive ${familiar.display_name}`}
              title="Unarchive — return to the active roster"
            >
              Unarchive
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon="ph:archive"
              onClick={() => archiveFamiliar(familiar.id)}
              aria-label={`Archive ${familiar.display_name}`}
              title="Archive — hide from switchers; stays bound, unarchive anytime"
            >
              Archive
            </Button>
          )}
          {!confirmRemove ? (
            <Button
              variant="danger"
              size="sm"
              leadingIcon="ph:trash"
              onClick={() => setConfirmRemove(true)}
              aria-label={`Remove ${familiar.display_name}`}
              title="Remove — detach from your Cave (undo-safe); chats and memory stay on disk"
            >
              Remove…
            </Button>
          ) : null}
        </div>
      ) : null}
      {confirmRemove && !hidden ? (
        <RemoveConfirm
          familiar={familiar}
          onConfirm={() => performRemove(familiar)}
          onCancel={() => setConfirmRemove(false)}
        />
      ) : null}

      {removedEntries.length > 0 ? (
        <div className="familiar-studio-lifecycle__section">
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
        </div>
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
    </section>
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
