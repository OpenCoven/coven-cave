"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  consumeSurfaceHistoryTop,
  recordSurfaceHistory,
  registerSurfaceHistoryLevel,
} from "./surface-history";

export type SurfaceHistoryOptions<T> = {
  /** Stable identity for the level, e.g. "chat:scope". */
  id: string;
  initial: T;
  /**
   * Collapse a burst of moves on this level into one entry. Leave at 0 for a
   * tab strip, where every pick is a destination. Raise it for a filter or a
   * search box, where a burst is one intent and should cost one Back press.
   */
  coalesceMs?: number;
};

export type SurfaceHistory<T> = {
  value: T;
  /**
   * A user-initiated move to another value — records it, so Back returns to
   * where they were. This is what a tab strip's onChange calls.
   */
  select: (next: T) => void;
  /**
   * A programmatic landing: a deep link, a cross-surface handoff, a restored
   * preference. Records nothing, so Back does not have to step through a
   * destination the user never chose.
   */
  show: (next: T) => void;
};

/**
 * Track a level whose value already lives somewhere else — a persisted
 * surface preference, a store, a parent's state.
 *
 * Returns the `select` to call instead of the raw setter on a user-initiated
 * move. Programmatic landings keep using the raw setter and record nothing,
 * which is the same `select`/`show` split as {@link useSurfaceHistory}.
 */
export function useTrackedSurfaceValue<T>({
  id,
  value,
  onRestore,
  coalesceMs = 0,
}: {
  id: string;
  value: T;
  onRestore: (value: T) => void;
  coalesceMs?: number;
}): (next: T) => void {
  const valueRef = useRef(value);
  valueRef.current = value;
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;

  useEffect(() => {
    return registerSurfaceHistoryLevel({
      id,
      apply: (restored) => restoreRef.current(restored as T),
    });
  }, [id]);

  return useCallback(
    (next: T) => {
      const prev = valueRef.current;
      if (Object.is(prev, next)) return;
      restoreRef.current(next);
      recordSurfaceHistory(id, prev, next, coalesceMs);
    },
    [id, coalesceMs],
  );
}

/**
 * Make Back close an overlay instead of navigating.
 *
 * Opening records an entry. Dismissing — Escape, the close button, a backdrop
 * click — consumes that entry when it is still the most recent move, so Back
 * does not reopen what the user just shut. If they navigated in between, the
 * entry is no longer on top and the close simply happens.
 *
 * Not for every overlay: a gated flow that owns its own stepper, a live call,
 * or a destructive confirmation should stay off the journal, where a stray
 * Back cannot dismiss it.
 */
export function useOverlayHistory({
  id,
  open,
  setOpen,
}: {
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}): { openOverlay: () => void; closeOverlay: () => void } {
  const openRef = useRef(open);
  openRef.current = open;
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    return registerSurfaceHistoryLevel({
      id,
      apply: (restored) => setOpenRef.current(Boolean(restored)),
    });
  }, [id]);

  const openOverlay = useCallback(() => {
    if (openRef.current) return;
    setOpenRef.current(true);
    recordSurfaceHistory(id, false, true);
  }, [id]);

  const closeOverlay = useCallback(() => {
    if (!openRef.current) return;
    // Our own entry on top means they dismissed us rather than navigating
    // past us — drop it, so Forward cannot resurrect a closed modal.
    if (consumeSurfaceHistoryTop(id)) return;
    setOpenRef.current(false);
  }, [id]);

  return { openOverlay, closeOverlay };
}

/**
 * Give a surface's tab strip, section picker, or filter its own navigation
 * level.
 *
 * The distinction that matters is `select` vs `show`. A handoff that also moves
 * a level the Workspace already tracks — opening a session, following a
 * `?mode=` alias onto a specific tab — must `show`, or one user action costs
 * two Back presses.
 */
export function useSurfaceHistory<T>({
  id,
  initial,
  coalesceMs = 0,
}: SurfaceHistoryOptions<T>): SurfaceHistory<T> {
  const [value, setValue] = useState<T>(initial);
  const valueRef = useRef<T>(initial);
  valueRef.current = value;

  const select = useCallback(
    (next: T) => {
      const prev = valueRef.current;
      if (Object.is(prev, next)) return;
      valueRef.current = next;
      setValue(next);
      recordSurfaceHistory(id, prev, next, coalesceMs);
    },
    [id, coalesceMs],
  );

  const show = useCallback((next: T) => {
    if (Object.is(valueRef.current, next)) return;
    valueRef.current = next;
    setValue(next);
  }, []);

  useEffect(() => {
    return registerSurfaceHistoryLevel({
      id,
      apply: (restored) => {
        valueRef.current = restored as T;
        setValue(restored as T);
      },
    });
  }, [id]);

  return { value, select, show };
}
