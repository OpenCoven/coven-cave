"use client";

/**
 * Resizable, collapsible Desk panes.
 *
 * The handoff makes both Desk rails draggable and collapsible to a vertical
 * spine, with the widths remembered. Two rules keep it honest:
 *
 * - the width is clamped on read as well as on write, so a hand-edited or
 *   stale localStorage value can never wedge a rail off screen;
 * - drag is pointer-based and captures the pointer, so releasing outside the
 *   window still ends the drag (a mouse-only listener leaves the rail stuck to
 *   the cursor).
 *
 * Keyboard parity is not optional: the separator is focusable and arrow keys
 * resize it, because a drag handle no keyboard can reach is a rail no keyboard
 * user can size.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type ResearchPaneOptions = {
  /** localStorage key; widths are per-surface, not per-familiar. */
  storageKey: string;
  min: number;
  max: number;
  initial: number;
  /**
   * 1 when the pane grows as the pointer moves right (a left rail), -1 when it
   * grows as the pointer moves left (a right rail).
   */
  direction: 1 | -1;
};

/** How much one arrow-key press moves a separator. */
const KEYBOARD_STEP = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth({ storageKey, min, max, initial }: ResearchPaneOptions): number {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return initial;
    const parsed = Number(raw);
    // NaN, Infinity and out-of-range values all fall back to a usable width
    // rather than being written straight into a grid track.
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : initial;
  } catch {
    return initial;
  }
}

export type ResearchPane = {
  width: number;
  collapsed: boolean;
  setCollapsed(next: boolean): void;
  /** Bind to the separator element. */
  separatorProps: {
    role: "separator";
    tabIndex: 0;
    "aria-orientation": "vertical";
    "aria-valuenow": number;
    "aria-valuemin": number;
    "aria-valuemax": number;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  };
};

export function useResearchPane(options: ResearchPaneOptions): ResearchPane {
  const { storageKey, min, max, direction } = options;
  // SSR renders the default; the stored width lands on mount so server and
  // client markup agree (this surface is ssr:false, but the guard keeps the
  // module import-safe under node --test).
  const [width, setWidth] = useState(options.initial);
  const [collapsed, setCollapsed] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    setWidth(readStoredWidth(optionsRef.current));
  }, [storageKey]);

  const persist = useCallback((next: number) => {
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      // Private mode / quota — the width still applies for this visit.
    }
  }, [storageKey]);

  const commit = useCallback((next: number) => {
    const clamped = clamp(next, min, max);
    setWidth(clamped);
    return clamped;
  }, [min, max]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Only a primary-button drag resizes; right-click belongs to the browser.
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let latest = startWidth;

    const move = (moveEvent: PointerEvent) => {
      latest = commit(startWidth + direction * (moveEvent.clientX - startX));
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      persist(latest);
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width, commit, direction, persist]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.key === "ArrowLeft" ? -KEYBOARD_STEP : event.key === "ArrowRight" ? KEYBOARD_STEP : 0;
    if (step === 0) {
      if (event.key === "Home") {
        event.preventDefault();
        persist(commit(min));
      } else if (event.key === "End") {
        event.preventDefault();
        persist(commit(max));
      }
      return;
    }
    event.preventDefault();
    persist(commit(width + direction * step));
  }, [width, commit, direction, min, max, persist]);

  return {
    width,
    collapsed,
    setCollapsed,
    separatorProps: {
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "vertical",
      "aria-valuenow": width,
      "aria-valuemin": min,
      "aria-valuemax": max,
      onPointerDown,
      onKeyDown,
    },
  };
}
