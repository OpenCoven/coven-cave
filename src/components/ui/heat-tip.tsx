"use client";

/**
 * useHeatTip — instant GitHub-style hover tooltip for heatmap grids. The
 * native `title` attribute is slow (~1s OS delay) and unstyled; this shows
 * the cell's value immediately in the `.ui-tooltip` primitive.
 *
 * Event-delegated: spread `gridProps` on the grid container and put the
 * label on each cell as `data-tip`. The single tooltip element is portaled
 * to document.body so overflow/transform ancestors (both heatmaps scroll
 * horizontally) can never clip it, and it persists across cell-to-cell
 * moves so the enter animation only plays when the pointer first arrives.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type HeatTipState = {
  text: string;
  /** Viewport x of the hovered cell's horizontal center. */
  x: number;
  /** Viewport y of the hovered cell's top edge. */
  y: number;
  /** Viewport y of the hovered cell's bottom edge. */
  bottom: number;
};

const EDGE_GAP = 8;
const CELL_GAP = 6;

export function useHeatTip() {
  const [tipState, setTipState] = useState<HeatTipState | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const hide = useCallback(() => setTipState(null), []);

  const onPointerOver = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    const cell = target?.closest?.("[data-tip]");
    const text = cell?.getAttribute("data-tip");
    if (!cell || !text) {
      setTipState(null);
      return;
    }
    const rect = cell.getBoundingClientRect();
    setTipState({ text, x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom });
  }, []);

  // Fixed positioning goes stale the moment the page (or the grid's own
  // horizontal overflow) scrolls; just dismiss.
  useEffect(() => {
    if (!tipState) return;
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [tipState, hide]);

  // Position after paint via the ref (measured width lets us center the tip
  // on the cell and clamp it inside the viewport, GitHub-style).
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tipState) return;
    const width = el.offsetWidth;
    const half = width / 2;
    const left = Math.min(Math.max(tipState.x, EDGE_GAP + half), window.innerWidth - EDGE_GAP - half);
    el.style.left = `${Math.round(left - half)}px`;
    const above = tipState.y - CELL_GAP - el.offsetHeight;
    // Flip below the cell when the row is flush with the viewport top.
    el.style.top = `${Math.round(above >= EDGE_GAP ? above : tipState.bottom + CELL_GAP)}px`;
  }, [tipState]);

  const tip =
    tipState === null
      ? null
      : createPortal(
          <div ref={tipRef} className="ui-tooltip" aria-hidden>
            {tipState.text}
          </div>,
          document.body,
        );

  return {
    tip,
    gridProps: { onPointerOver, onPointerLeave: hide, onPointerDown: hide },
  } as const;
}
