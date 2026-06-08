"use client";

import { useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type Options = {
  /** Called on Escape. Caller usually closes the dialog. Identity-stable
   *  internally (we keep it in a ref) so passing an inline arrow is fine. */
  onEscape?: () => void;
  /** Focus the first focusable element on activate (default true). If no
   *  focusable child exists, focuses the container itself — caller MUST give
   *  the container `tabIndex={-1}` so this is reachable. */
  focusFirst?: boolean;
};

/**
 * Trap focus inside `containerRef` while `active` is true. Saves the
 * previously-focused element on activate→deactivate and restores it on
 * deactivate. Tab/Shift+Tab cycle through focusable descendants. Escape
 * calls onEscape.
 *
 * `onEscape` is stored in a ref so the effect deps don't include it — that
 * prevents tear-down/re-run loops when callers pass an inline arrow each
 * render. (Without this, returnFocusRef gets re-captured on every render and
 * deactivate restores focus to inside the modal, not to the trigger.)
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  { onEscape, focusFirst = true }: Options = {},
) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);

  // Keep the latest callback reachable from the keydown handler without
  // making it a useEffect dep.
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    if (focusFirst) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      if (first) {
        first.focus();
      } else {
        // Fallback: focus the container so Tab/Esc still hit. Caller must
        // set tabIndex={-1} on the container element for this to land.
        container.focus();
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }
      if (e.key === "Tab" && container) {
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocusRef.current?.focus();
    };
  }, [active, containerRef, focusFirst]); // intentionally no onEscape
}
