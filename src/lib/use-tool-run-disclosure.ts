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
 *  • A one-call shell stays open and inert so its ToolBlock remains mounted
 *    when a second same-name call turns the shell into a repeated subgroup.
 */
export function useToolRunDisclosure(
  statuses: readonly RunStatus[],
  collapsible = true,
): ToolRunDisclosure {
  const isRunning = statuses.some((s) => s === "running");
  const [open, setOpen] = useState(!collapsible || isRunning);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const prevRunning = useRef(isRunning);
  const prevCollapsible = useRef(collapsible);
  const pendingCollapse = useRef(false);

  useEffect(() => {
    if (!collapsible || isRunning) {
      pendingCollapse.current = false;
      setOpen(true);
      if (detailsRef.current) {
        detailsRef.current.open = true;
      }
    } else if (!prevCollapsible.current || prevRunning.current) {
      const activeEl = globalThis.document?.activeElement ?? null;
      const details = detailsRef.current;
      if (details && activeEl && details.contains(activeEl)) {
        pendingCollapse.current = true;
      } else {
        setOpen(false);
      }
    }
    prevRunning.current = isRunning;
    prevCollapsible.current = collapsible;
  }, [collapsible, isRunning]);

  const effectiveOpen = !collapsible || isRunning || open;

  const onToggle = (nextOpen: boolean) => {
    if ((!collapsible || isRunning) && !nextOpen) {
      if (detailsRef.current) {
        detailsRef.current.open = true;
      }
      return;
    }
    // Ignore redundant/programmatic events: native <details> emits toggle
    // events for programmatic `open` attribute writes, so a delayed forced-open
    // echo can arrive after settlement carrying the same value that is already
    // controlled.  Only a real state change clears pendingCollapse.
    if (nextOpen === effectiveOpen) return;
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

  return { open: effectiveOpen, detailsRef, onToggle, onBlurCapture };
}
