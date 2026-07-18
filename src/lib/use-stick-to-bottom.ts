"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Stick-to-bottom follow behavior for small streaming transcripts (quick-chat
 * tray, group chat), ported from the main chat's intent-release pattern
 * (CHAT-D10-01 / PR #2659, cave-o8si):
 *
 * - While stuck, pins are INSTANT and rAF-coalesced — never a queued smooth
 *   scroll per streamed chunk, which also satisfies prefers-reduced-motion.
 * - Only USER intent releases the stick: wheel-up, a downward touch drag,
 *   PageUp/Home/ArrowUp, or an upward scrollbar drag. The old position
 *   threshold (`gap < 48` on every scroll event) is gone — it re-stuck a
 *   reader who paused just above the bottom, so the next streamed token
 *   yanked them back down.
 * - Re-stick happens only at the true bottom (≤4px). While stuck that check
 *   is a no-op, so the pin's own scroll events can never count as intent.
 *
 * The caller keeps ownership of *when* to pin (call `schedulePin()` from its
 * data effects) and of programmatic re-engagement (`stick()` on send / jump /
 * conversation switch). The main chat keeps its own inline copy — it carries
 * extra machinery (FAB wiring, ResizeObserver re-pins for long markdown
 * transcripts) and heavy test pins; these overlays re-pin on every data
 * mutation and cap at ~46vh, where late-layout drift hasn't been an issue.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  opts?: {
    /** Observe stick/release flips (e.g. to show a "jump to latest" pill). */
    onStickChange?: (stuck: boolean) => void;
  },
): { stuckRef: RefObject<boolean>; schedulePin: () => void; stick: () => void } {
  const stuckRef = useRef(true);
  const pinFrameRef = useRef<number | null>(null);
  const onStickChangeRef = useRef(opts?.onStickChange);
  onStickChangeRef.current = opts?.onStickChange;

  const setStuck = useCallback((next: boolean) => {
    if (stuckRef.current === next) return;
    stuckRef.current = next;
    onStickChangeRef.current?.(next);
  }, []);

  const schedulePin = useCallback(() => {
    if (!stuckRef.current) return;
    if (pinFrameRef.current !== null) return;
    pinFrameRef.current = requestAnimationFrame(() => {
      pinFrameRef.current = null;
      const el = scrollRef.current;
      if (!el || !stuckRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
  }, [scrollRef]);

  const stick = useCallback(() => {
    setStuck(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollRef, setStuck]);

  useEffect(() => () => {
    if (pinFrameRef.current !== null) {
      cancelAnimationFrame(pinFrameRef.current);
      // MUST null: StrictMode/Suspense re-run effects while refs persist —
      // a cancelled-but-not-nulled id wedges the coalescing guard and the
      // pin never runs again for this component instance (the rAF-wedge bug
      // fixed in the main chat, PR #2659).
      pinFrameRef.current = null;
    }
  }, []);

  // Release on intent + re-stick at the true bottom. Programmatic pins emit
  // scroll events but never wheel/touch/key/scrollbar-grab events, so they
  // are structurally excluded from intent detection.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastTouchY: number | null = null;
    // A transcript that doesn't overflow can't be scrolled away from the
    // bottom — releasing there would strand the surface with no scroll event
    // to ever re-stick it.
    const scrollable = () => el.scrollHeight - el.clientHeight > 1;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && stuckRef.current && scrollable()) setStuck(false);
    };
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      // Finger moving down the screen drags content down = scrolling up.
      if (lastTouchY !== null && y > lastTouchY && stuckRef.current && scrollable()) {
        setStuck(false);
      }
      lastTouchY = y;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "PageUp" || e.key === "Home" || e.key === "ArrowUp") && stuckRef.current) {
        setStuck(false);
      }
    };
    // Scrollbar drags emit no wheel/touch/key events. A grab lands on the
    // scroller itself with its X past the content box (the gutter, LTR); only
    // an actual upward move during the grab releases.
    let scrollbarGrab = false;
    const onMouseDown = (e: MouseEvent) => {
      if (e.target === el && e.offsetX >= el.clientWidth) scrollbarGrab = true;
    };
    const onMouseUp = () => {
      scrollbarGrab = false;
    };
    const onScroll = () => {
      if (stuckRef.current) {
        if (scrollbarGrab && el.scrollHeight - el.scrollTop - el.clientHeight > 4) setStuck(false);
        return;
      }
      // Released: re-stick only when the user returns to the true bottom.
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 4) setStuck(true);
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, setStuck]);

  return { stuckRef, schedulePin, stick };
}
