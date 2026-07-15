"use client";

import { useCallback, useEffect, type RefObject } from "react";

/**
 * Auto-grow a composer textarea with its content: start at one line, grow to
 * the CSS max-height, then hand overflow to an internal scrollbar.
 *
 * Why this exists: the chat composer (chat-view.tsx) and the home composer
 * (home-composer.tsx) each hand-rolled the identical resize routine — read the
 * computed CSS max-height (so responsive breakpoints win), fall back to the
 * 13-row desktop cap when it can't be parsed, and only enable `overflow-y`
 * once the cap is hit. One implementation keeps the two composers' feel from
 * drifting.
 *
 * The resize runs automatically whenever `value` changes; `resize()` is also
 * returned for imperative callers that swap the textarea's value outside of
 * React's data flow (e.g. the enhance-prompt timers).
 */

/** Fallback cap when the computed CSS max-height can't be read; kept in sync
 *  with the composer input rules (13 lines: 13*24 + 20px padding). */
const AUTOGROW_FALLBACK_MAX_HEIGHT = 332;

export function useAutogrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  opts?: { fallbackMaxHeight?: number },
): { resize: () => void } {
  const fallbackMaxHeight = opts?.fallbackMaxHeight ?? AUTOGROW_FALLBACK_MAX_HEIGHT;

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const computedMaxHeight = Number.parseFloat(window.getComputedStyle(el).maxHeight);
    const maxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : fallbackMaxHeight;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    const isOverflowing = el.scrollHeight > maxHeight;
    el.style.overflowY = isOverflowing ? "auto" : "hidden";
  }, [ref, fallbackMaxHeight]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return { resize };
}
