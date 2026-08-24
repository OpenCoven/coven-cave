"use client";

/**
 * use-review-panes — the cockpit's two draggable rails.
 *
 * Width lives in state rather than CSS so the same numbers can be clamped
 * against the live window (a rail dragged wide on a large display must not
 * swallow the diff when the window shrinks) and fed to the file rail, which
 * decides how many chips fit from the measured centre width.
 *
 * Pointer events, not mouse: a trackpad drag and a touch drag both have to
 * work, and pointer capture keeps the drag alive when the cursor outruns the
 * 5px handle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampPaneWidth,
  INSPECTOR_PANE,
  QUEUE_PANE,
} from "./review-cockpit";

const QUEUE_SHARE = 0.26;
const INSPECTOR_SHARE = 0.3;
/** Fallback until the first measurement lands; SSR has no window. */
const ASSUMED_WIDTH = 1440;

export type ReviewPanes = {
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
  const [viewport, setViewport] = useState(ASSUMED_WIDTH);
  const dragging = useRef<{ pane: "queue" | "inspector"; startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    const measure = () => setViewport(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const clampedQueue = clampPaneWidth(queueWidth, QUEUE_PANE, viewport, QUEUE_SHARE);
  const clampedInspector = clampPaneWidth(
    inspectorWidth,
    INSPECTOR_PANE,
    viewport,
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
      // A cursor that outruns the handle must not leave the drag behind, and a
      // text selection started mid-drag makes the whole surface flash blue.
      document.body.setAttribute("data-rd-resizing", "true");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    },
    [clampedInspector, clampedQueue, endDrag, onPointerMove],
  );

  return {
    queueWidth: clampedQueue,
    inspectorWidth: clampedInspector,
    centreWidth: Math.max(
      0,
      viewport -
        (queueOpen ? clampedQueue + 5 : 0) -
        (inspectorOpen ? clampedInspector + 5 : 0),
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
