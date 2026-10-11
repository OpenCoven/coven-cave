"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAnnouncer } from "@/components/ui/live-region";

const WIDTH_KEY = "cave:chat-rail:width:v1";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;

/** Owns rail geometry without rerendering the conversation on every drag. */
export function ChatThreadRail({ children, availableWidth }: { children: ReactNode; availableWidth: number | null }) {
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; width: number; preferred: number } | null>(null);
  const id = useId();
  const { announce } = useAnnouncer();
  const max = Math.max(MIN_WIDTH, Math.min(440, (availableWidth ?? 840) - 400));
  const clamp = (value: number) => Math.max(MIN_WIDTH, Math.min(max, value));
  const width = clamp(preferredWidth);

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= 440) setPreferredWidth(stored);
    } catch { /* Storage is optional. */ }
  }, []);

  function commit(value: number) {
    const next = clamp(value);
    setPreferredWidth(next);
    try { localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* Storage is optional. */ }
    announce(`Chat list width ${Math.round(next)} pixels.`);
  }

  function cancelDrag() {
    if (!drag.current) return;
    setPreferredWidth(drag.current.preferred);
    drag.current = null;
    setDragging(false);
  }

  return (
    <aside id={id} className="chat-inner-rail" aria-label="Chat threads" style={{ width }}>
      {children}
      <div
        className="chat-inner-rail__resize focus-ring-inset"
        role="separator"
        tabIndex={0}
        aria-label="Resize chat list"
        aria-orientation="vertical"
        aria-controls={id}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        aria-valuetext={`${Math.round(width)} pixels`}
        title="Drag to resize · arrow keys to adjust · double-click to reset"
        data-dragging={dragging || undefined}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, width, preferred: preferredWidth };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (active?.id === event.pointerId) setPreferredWidth(clamp(active.width + event.clientX - active.x));
        }}
        onPointerUp={(event) => {
          const active = drag.current;
          if (active?.id !== event.pointerId) return;
          drag.current = null;
          setDragging(false);
          commit(active.width + event.clientX - active.x);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onDoubleClick={() => commit(DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            cancelDrag();
            return;
          }
          const step = event.shiftKey ? 64 : 16;
          const next = event.key === "ArrowLeft" ? width - step
            : event.key === "ArrowRight" ? width + step
            : event.key === "Home" ? MIN_WIDTH
            : event.key === "End" ? max
            : event.key === "Enter" ? DEFAULT_WIDTH : null;
          if (next === null) return;
          event.preventDefault();
          commit(next);
        }}
      />
    </aside>
  );
}
