"use client";

import { useRef } from "react";

/** Keep a stationary press on Retry while asynchronous input rendering moves
 * its disclosure. Activation still happens on click, and dragging cancels. */
export function ToolOutputRetry({ onRetry }: { onRetry: () => void }) {
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const clickPointer = useRef<number | null>(null);
  const cancelled = useRef(false);
  const cancel = (id: number) => {
    if (press.current?.id !== id) return;
    press.current = null;
    cancelled.current = true;
  };
  return (
    <button type="button" className="focus-ring underline"
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        // Primary is per pointer type: a pen and mouse can both be primary.
        if (press.current) return;
        cancelled.current = false;
        clickPointer.current = event.pointerId;
        press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        try { event.currentTarget.setPointerCapture(event.pointerId); }
        catch { press.current = null; }
      }}
      onPointerMove={(event) => {
        const start = press.current;
        if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
          cancelled.current = true;
        }
      }}
      onPointerUp={(event) => {
        if (press.current?.id === event.pointerId) press.current = null;
      }}
      onPointerCancel={(event) => cancel(event.pointerId)}
      onLostPointerCapture={(event) => cancel(event.pointerId)}
      onClick={(event) => {
        const pointerId = (event.nativeEvent as PointerEvent | undefined)?.pointerId;
        if (event.detail !== 0 && (press.current || (typeof pointerId === "number"
          && clickPointer.current !== null && pointerId !== clickPointer.current))) return;
        const suppressed = event.detail !== 0 && cancelled.current;
        cancelled.current = false;
        if (!suppressed) onRetry();
      }}
    >Retry</button>
  );
}
