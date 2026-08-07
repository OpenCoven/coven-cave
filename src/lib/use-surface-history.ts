"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canMoveWorkspaceNavigation,
  createWorkspaceNavigationHistory,
  moveWorkspaceNavigation,
  pushWorkspaceNavigation,
  replaceWorkspaceNavigation,
  type NavigationKeyOf,
} from "./workspace-navigation-history";
import { notifySurfaceHistoryChanged, registerSurfaceHistoryLevel } from "./surface-history";

export type SurfaceHistoryOptions<T> = {
  /** Stable identity for the level, e.g. "chat:scope". */
  id: string;
  /** Larger is deeper — the Workspace traverses the deepest movable level. */
  depth: number;
  initial: T;
  keyOf?: NavigationKeyOf<T>;
};

export type SurfaceHistory<T> = {
  value: T;
  /**
   * A user-initiated move to another value — records a history entry, so Back
   * returns to where they were. This is what a tab strip's onChange calls.
   */
  select: (next: T) => void;
  /**
   * A programmatic landing: a deep link, a cross-surface handoff, a restored
   * preference. Updates the current entry in place so Back does not have to
   * step through a destination the user never chose.
   */
  show: (next: T) => void;
};

/**
 * Give a surface's tab strip its own history level.
 *
 * The distinction that matters is `select` vs `show`. A handoff that also
 * moves a level the Workspace already tracks — opening a session, following a
 * `?mode=` alias onto a specific tab — must `show`, or one user action costs
 * two Back presses.
 */
export function useSurfaceHistory<T>({
  id,
  depth,
  initial,
  keyOf,
}: SurfaceHistoryOptions<T>): SurfaceHistory<T> {
  const [value, setValue] = useState<T>(initial);
  const historyRef = useRef(createWorkspaceNavigationHistory<T>(initial));
  const valueRef = useRef<T>(initial);
  valueRef.current = value;
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;

  const select = useCallback((next: T) => {
    const key = keyOfRef.current;
    const updated = pushWorkspaceNavigation(historyRef.current, next, key);
    historyRef.current = updated;
    setValue(next);
    notifySurfaceHistoryChanged();
  }, []);

  const show = useCallback((next: T) => {
    const key = keyOfRef.current;
    const updated = replaceWorkspaceNavigation(historyRef.current, next, key);
    historyRef.current = updated;
    setValue(next);
    notifySurfaceHistoryChanged();
  }, []);

  useEffect(() => {
    return registerSurfaceHistoryLevel({
      id,
      depth,
      canMove: (direction) =>
        canMoveWorkspaceNavigation(historyRef.current, direction, keyOfRef.current),
      move: (direction) => {
        const current = historyRef.current;
        const updated = moveWorkspaceNavigation(current, direction, keyOfRef.current);
        if (updated.index === current.index) return false;
        historyRef.current = updated;
        setValue(updated.entries[updated.index]);
        return true;
      },
    });
  }, [id, depth]);

  return { value, select, show };
}
