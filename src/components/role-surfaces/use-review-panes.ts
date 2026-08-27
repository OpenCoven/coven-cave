"use client";

/**
 * use-review-panes — the cockpit's two draggable rails.
 *
 * Width lives in state rather than CSS so the same numbers can be clamped
 * against the surface's own width and fed to the file rail, which decides how
 * many chips fit from the measured centre width.
 *
 * It measures the STAGE, not the window. The deck's responsive contract is a
 * container query, so it can render inside a workspace pane that is a fraction
 * of the window — a half-width split. Clamping a rail to 26% of the *window*
 * there lets it take most of a much narrower pane, and hands the file rail a
 * centre width that does not exist, so it shows chips that cannot fit.
 *
 * Pointer events, not mouse: a trackpad drag and a touch drag both have to
 * work. The move/up listeners live on `window` rather than on the handle, so a
 * cursor that outruns the 4px gutter keeps dragging.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampPaneWidth,
  INSPECTOR_PANE,
  QUEUE_PANE,
} from "./review-cockpit";

const QUEUE_SHARE = 0.26;
const INSPECTOR_SHARE = 0.3;
/** Fallback until the first measurement lands; SSR has no layout. */
const ASSUMED_WIDTH = 1440;
/**
 * One source of truth for the gutter. The grid track is
 * `--rd-gutter: var(--space-1)`, so the centre-width arithmetic has to
 * subtract the same 4px — it subtracted 5 while the handle was still the
 * frame's 5px, which quietly shrank the measured centre and could drop a file
 * chip that did fit.
 */
const GUTTER_PX = 4;

export type ReviewPanes = {
  /** Attach to the stage; its measured width is what the rails clamp against. */
  stageRef: React.RefObject<HTMLDivElement | null>;
  queueWidth: number;
  inspectorWidth: number;
  /** What the diff column actually gets, once both rails are subtracted. */
  centreWidth: number;
  queueOpen: boolean;
  inspectorOpen: boolean;
  dragQueue: (event: React.PointerEvent) => void;
  dragInspector: (event: React.PointerEvent) => void;
  toggleQueue: () => void;
  toggleInspector: () => void;
  setQueueOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
};

export function useReviewPanes(): ReviewPanes {
  const [queueWidth, setQueueWidth] = useState<number>(QUEUE_PANE.initial);
  const [inspectorWidth, setInspectorWidth] = useState<number>(INSPECTOR_PANE.initial);
  const [queueOpen, setQueueOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [available, setAvailable] = useState(ASSUMED_WIDTH);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ pane: "queue" | "inspector"; startX: number; startWidth: number } | null>(
    null,
  );

  // Observe the stage itself. A window `resize` listener misses the case that
  // matters most here — the window staying put while the surface's own pane is
  // dragged narrower beside it.
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setAvailable(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const clampedQueue = clampPaneWidth(queueWidth, QUEUE_PANE, available, QUEUE_SHARE);
  const clampedInspector = clampPaneWidth(
    inspectorWidth,
    INSPECTOR_PANE,
    available,
    INSPECTOR_SHARE,
  );

  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    // The inspector grows leftward, so its delta is inverted.
    const delta =
      drag.pane === "queue"
        ? event.clientX - drag.startX
        : drag.startX - event.clientX;
    const next = drag.startWidth + delta;
    if (drag.pane === "queue") setQueueWidth(next);
    else setInspectorWidth(next);
  }, []);

  const endDrag = useCallback(() => {
    dragging.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    document.body.removeAttribute("data-rd-resizing");
  }, [onPointerMove]);

  useEffect(() => endDrag, [endDrag]);

  const startDrag = useCallback(
    (pane: "queue" | "inspector", event: React.PointerEvent) => {
      event.preventDefault();
      dragging.current = {
        pane,
        startX: event.clientX,
        startWidth: pane === "queue" ? clampedQueue : clampedInspector,
      };
      // A text selection started mid-drag makes the whole surface flash blue.
      document.body.setAttribute("data-rd-resizing", "true");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    },
    [clampedInspector, clampedQueue, endDrag, onPointerMove],
  );

  return {
    stageRef,
    queueWidth: clampedQueue,
    inspectorWidth: clampedInspector,
    centreWidth: Math.max(
      0,
      available -
        (queueOpen ? clampedQueue + GUTTER_PX : 0) -
        (inspectorOpen ? clampedInspector + GUTTER_PX : 0),
    ),
    queueOpen,
    inspectorOpen,
    dragQueue: (event) => startDrag("queue", event),
    dragInspector: (event) => startDrag("inspector", event),
    toggleQueue: () => setQueueOpen((open) => !open),
    toggleInspector: () => setInspectorOpen((open) => !open),
    setQueueOpen,
    setInspectorOpen,
  };
}
