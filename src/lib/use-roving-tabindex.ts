"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type Orientation = "horizontal" | "vertical" | "both";

type Options = {
  /** Container element holding the items. */
  containerRef: RefObject<HTMLElement | null>;
  /** CSS selector for the items inside the container. */
  itemSelector: string;
  /** Which arrow keys move focus. Default "both". */
  orientation?: Orientation;
  /** Wrap from last → first / first → last. Default false. */
  loop?: boolean;
};

/**
 * Roving tabindex per WAI-ARIA APG. One item in the set has tabindex=0 (the
 * "tab stop"), every other is tabindex=-1. Arrow keys move the tab stop and
 * focus the new item. Home/End jump to ends. The container is the keydown
 * target — items themselves don't need handlers.
 *
 * Returns `setActiveIndex` so the caller can programmatically jump (e.g.,
 * after selecting an item to restore the tab stop).
 */
export function useRovingTabIndex({
  containerRef,
  itemSelector,
  orientation = "both",
  loop = false,
}: Options) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = activeIndex;

  const getItems = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(itemSelector))
      // Don't rove onto disabled controls.
      .filter((el) => !el.hasAttribute("disabled"))
      // Don't rove onto hidden elements. offsetParent === null catches
      // display:none and visibility:hidden ancestors. We keep the currently
      // focused element in the set even if hidden, to avoid yanking focus
      // mid-keystroke if a list animation hides it for a frame.
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, [containerRef, itemSelector]);

  // Sync tabindex on items whenever they change or active moves. Also clamp
  // activeIndex if the list shrunk below it — without this, a dynamic list
  // can leave the tab stop out of range (next ArrowDown lands on nothing).
  useEffect(() => {
    const items = getItems();
    if (items.length === 0) return;
    if (activeRef.current >= items.length) {
      const clamped = Math.min(items.length - 1, activeRef.current);
      setActiveIndex(clamped);
      return; // State update re-triggers this effect; let it land properly.
    }
    items.forEach((item, i) => {
      if (i === activeRef.current) {
        item.tabIndex = 0;
      } else {
        item.tabIndex = -1;
      }
    });
  }, [getItems, activeIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const horiz = orientation !== "vertical";
    const vert = orientation !== "horizontal";

    function move(delta: number) {
      const items = getItems();
      if (items.length === 0) return;
      let next = activeRef.current + delta;
      if (loop) {
        next = (next + items.length) % items.length;
      } else {
        next = Math.max(0, Math.min(items.length - 1, next));
      }
      setActiveIndex(next);
      items[next]?.focus();
    }

    function jumpTo(i: number) {
      const items = getItems();
      if (items.length === 0) return;
      const next = Math.max(0, Math.min(items.length - 1, i));
      setActiveIndex(next);
      items[next]?.focus();
    }

    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          if (!vert) return;
          e.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          if (!vert) return;
          e.preventDefault();
          move(-1);
          break;
        case "ArrowRight":
          if (!horiz) return;
          e.preventDefault();
          move(1);
          break;
        case "ArrowLeft":
          if (!horiz) return;
          e.preventDefault();
          move(-1);
          break;
        case "Home":
          e.preventDefault();
          jumpTo(0);
          break;
        case "End":
          e.preventDefault();
          jumpTo(getItems().length - 1);
          break;
      }
    }

    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [containerRef, getItems, loop, orientation]);

  return { activeIndex, setActiveIndex };
}
