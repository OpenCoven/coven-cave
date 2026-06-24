"use client";

import { UndoToast } from "@/components/ui/undo-toast";

type Props = {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
};

/**
 * Delete-undo toast for the library surfaces. Thin wrapper over the shared
 * {@link UndoToast}; the surrounding useUndoDelete controller owns the commit
 * timer, so this only animates the countdown (no self-dismiss).
 */
export function LibraryUndoToast({ label, onUndo, onDismiss, durationMs = 4000 }: Props) {
  return (
    <UndoToast
      message={<>Deleted <strong>{label}</strong></>}
      icon="ph:trash"
      undoAriaLabel={`Undo delete ${label}`}
      onUndo={onUndo}
      onDismiss={onDismiss}
      durationMs={durationMs}
    />
  );
}
