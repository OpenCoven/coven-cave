"use client";

/**
 * use-review-toast — the deck's visible confirmation channel.
 *
 * Pairs with `useAnnouncer` rather than replacing it. The announcer writes into
 * an `sr-only` live region, so assistive tech hears every verdict; before this
 * hook a sighted reviewer got nothing but a closing dialog after approving or
 * merging. Same message, two channels: `say()` speaks AND shows.
 *
 * The toast itself is `aria-hidden` (see `ReviewToast`) — the announcer already
 * owns the assistive reading, and announcing the same sentence twice is its own
 * defect.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a confirmation stays up. The frame's own dwell. */
export const REVIEW_TOAST_MS = 2_600;

export type ReviewToast = {
  /** The message on screen, or null when nothing is showing. */
  message: string | null;
  /** Show a confirmation. Replaces any message still on screen. */
  show: (message: string) => void;
  /** Drop the current message immediately (selection changed, unmounting). */
  clear: () => void;
};

export function useReviewToast(durationMs: number = REVIEW_TOAST_MS): ReviewToast {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    stop();
    setMessage(null);
  }, [stop]);

  const show = useCallback(
    (next: string) => {
      // Restart the dwell rather than letting the previous timer cut the new
      // message short — two verdicts in quick succession is ordinary use.
      stop();
      setMessage(next);
      timer.current = setTimeout(() => {
        timer.current = null;
        setMessage(null);
      }, durationMs);
    },
    [durationMs, stop],
  );

  useEffect(() => stop, [stop]);

  return { message, show, clear };
}
