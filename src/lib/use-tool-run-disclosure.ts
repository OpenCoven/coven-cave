"use client";

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";

type RunStatus = "running" | "ok" | "error";

export type ToolRunDisclosure = {
  open: boolean;
  detailsRef: RefObject<HTMLDetailsElement | null>;
  onToggle: (nextOpen: boolean) => void;
  onBlurCapture: (event: FocusEvent<HTMLDetailsElement>) => void;
};

export type FocusSafeToolRelocation = {
  keepToolsInline: boolean;
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
};

const INLINE_TOOL_RUNS_SELECTOR = "[data-inline-tool-runs]";

function isInlineToolTarget(target: EventTarget | null): boolean {
  const closest = (target as { closest?: (selector: string) => Element | null } | null)?.closest;
  return typeof closest === "function" && closest.call(target, INLINE_TOOL_RUNS_SELECTOR) != null;
}

/**
 * Keeps the streaming tool subtree in place across turn settlement while it
 * owns focus. Once focus leaves, the caller can relocate tools into the
 * settled rollup without disrupting keyboard interaction.
 */
export function useFocusSafeToolRelocation(pending: boolean): FocusSafeToolRelocation {
  const [inlineToolsFocused, setInlineToolsFocused] = useState(false);

  const onFocusCapture = (event: FocusEvent<HTMLElement>) => {
    if (isInlineToolTarget(event.target)) {
      setInlineToolsFocused(true);
    }
  };

  const onBlurCapture = (event: FocusEvent<HTMLElement>) => {
    if (!isInlineToolTarget(event.relatedTarget)) {
      setInlineToolsFocused(false);
    }
  };

  return {
    keepToolsInline: pending || inlineToolsFocused,
    onFocusCapture,
    onBlurCapture,
  };
}

/**
 * Controls the open/closed state of a <details> element that wraps a repeated
 * tool run group.  Rules:
 *
 *  • Initialises open when any status is running.
 *  • Forces open while running; manual collapse attempts are ignored and the
 *    DOM `open` attribute is restored when a details ref is provided.
 *  • On transition from running → settled, collapses unless focus currently
 *    lives inside the referenced details element.
 *  • If focus is inside at settlement, defers the collapse until focus leaves
 *    the subtree (detected via onBlurCapture).
 *  • While settled, manual open/close via onToggle works normally.
 */
export function useToolRunDisclosure(statuses: readonly RunStatus[]): ToolRunDisclosure {
  const isRunning = statuses.some((s) => s === "running");
  const [open, setOpen] = useState(isRunning);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const prevRunning = useRef(isRunning);
  const pendingCollapse = useRef(false);

  useEffect(() => {
    if (isRunning) {
      pendingCollapse.current = false;
      setOpen(true);
      if (detailsRef.current) {
        detailsRef.current.open = true;
      }
    } else if (prevRunning.current) {
      // Transition from running to settled.
      const activeEl = globalThis.document?.activeElement ?? null;
      const details = detailsRef.current;
      if (details && activeEl && details.contains(activeEl)) {
        // Defer collapse until focus leaves.
        pendingCollapse.current = true;
      } else {
        setOpen(false);
      }
    }
    prevRunning.current = isRunning;
  }, [isRunning]);

  const onToggle = (nextOpen: boolean) => {
    if (isRunning && !nextOpen) {
      // Refuse manual collapse while running and restore the DOM attribute.
      if (detailsRef.current) {
        detailsRef.current.open = true;
      }
      return;
    }
    // Ignore redundant/programmatic events: native <details> emits toggle
    // events for programmatic `open` attribute writes, so a delayed forced-open
    // echo can arrive after settlement carrying the same value that is already
    // controlled.  Only a real state change clears pendingCollapse.
    if (nextOpen === open) return;
    // A settled manual toggle resolves any deferred collapse: the user has
    // explicitly stated where they want the group, so pending blur-collapse
    // must not override that later.
    pendingCollapse.current = false;
    setOpen(nextOpen);
  };

  const onBlurCapture = (event: FocusEvent<HTMLDetailsElement>) => {
    if (!pendingCollapse.current) return;
    const details = detailsRef.current;
    const relatedTarget = event.relatedTarget as Node | null;
    if (!details || !details.contains(relatedTarget)) {
      pendingCollapse.current = false;
      setOpen(false);
    }
  };

  return { open, detailsRef, onToggle, onBlurCapture };
}
