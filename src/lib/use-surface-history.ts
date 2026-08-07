"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordSurfaceHistory, registerSurfaceHistoryLevel } from "./surface-history";

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
 * Give a surface's tab strip, section picker, filter, or overlay its own
 * navigation level.
 *
 * The distinction that matters is `select` vs `show`. A handoff that also moves
 * a level the Workspace already tracks — opening a session, following a
 * `?mode=` alias onto a specific tab — must `show`, or one user action costs
 * two Back presses.
 */
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
