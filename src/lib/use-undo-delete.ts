"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const UNDO_WINDOW_MS = 4_000;

export type UndoEntry<T> = {
  id: string;       // unique key for this pending deletion
  item: T;          // the item being deleted, for potential restore
  label: string;    // human-readable name for toast copy
  deleteFn: () => Promise<void>;  // fires the actual DELETE
  timeoutId: ReturnType<typeof setTimeout>;
};

export function useUndoDelete<T>() {
  const [pending, setPending] = useState<UndoEntry<T> | null>(null);
  const pendingRef = useRef<UndoEntry<T> | null>(null);

  // keep ref in sync so cleanup can read the latest
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // flush on unmount — commit any pending delete
  useEffect(() => {
    return () => {
      const p = pendingRef.current;
      if (p) {
        clearTimeout(p.timeoutId);
        void p.deleteFn();
      }
    };
  }, []);

  const scheduleDelete = useCallback(
    (item: T, label: string, deleteFn: () => Promise<void>) => {
      // If there's already a pending delete, commit it immediately before scheduling the new one
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timeoutId);
        void pendingRef.current.deleteFn();
      }

      const id = `undo-${Date.now()}`;
      const timeoutId = setTimeout(() => {
        setPending(null);
        void deleteFn();
      }, UNDO_WINDOW_MS);

      const entry: UndoEntry<T> = { id, item, label, deleteFn, timeoutId };
      setPending(entry);
    },
    [],
  );

  const undo = useCallback(() => {
    if (!pendingRef.current) return;
    clearTimeout(pendingRef.current.timeoutId);
    setPending(null);
  }, []);

  // While a delete is pending, ⌘Z / Ctrl+Z undoes it — the keyboard affordance
  // users reach for. ⌘⇧Z (redo) is left alone, and we defer to native text undo
  // when focus is in an editable field. One handler per active toast; only one
  // surface shows a toast at a time, so there's no cross-surface ambiguity.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, undo]);

  const commit = useCallback(() => {
    if (!pendingRef.current) return;
    clearTimeout(pendingRef.current.timeoutId);
    void pendingRef.current.deleteFn();
    setPending(null);
  }, []);

  return { pending, scheduleDelete, undo, commit };
}
