"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/lib/icon";

type Props = {
  /** The toast body (e.g. "Deleted <strong>X</strong>" or "Moved X to Y"). */
  message: ReactNode;
  onUndo: () => void;
  onDismiss: () => void;
  /** Leading icon (default a trash glyph for the common delete-undo case). */
  icon?: IconName;
  /** Lifetime of the countdown progress bar, in ms. */
  durationMs?: number;
  /** Accessible label for the Undo button. */
  undoAriaLabel?: string;
  /** Call onDismiss when the progress bar empties (self-dismissing toasts).
   *  Off by default — callers whose own controller owns the timer (e.g.
   *  useUndoDelete) animate the bar but dismiss themselves. */
  autoDismiss?: boolean;
};

/**
 * Bottom-center undo toast with a countdown progress bar and an Undo / dismiss
 * pair. Shared by delete and move flows.
 */
export function UndoToast({
  message,
  onUndo,
  onDismiss,
  icon = "ph:trash",
  durationMs = 4000,
  undoAriaLabel = "Undo",
  autoDismiss = false,
}: Props) {
  // The countdown bar is a single CSS width transition (100% → 0% over
  // durationMs) rather than a per-frame requestAnimationFrame loop, so the toast
  // doesn't re-render every frame for a decorative bar. autoDismiss is a single
  // setTimeout — which, unlike rAF, still fires in a backgrounded tab.
  const [collapsed, setCollapsed] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    // Flip to 0% on the next frame so the mounted-at-100% bar animates down.
    const raf = requestAnimationFrame(() => setCollapsed(true));
    const timer = autoDismiss
      ? window.setTimeout(() => dismissRef.current(), durationMs)
      : undefined;
    return () => {
      cancelAnimationFrame(raf);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [durationMs, autoDismiss]);

  return (
    <div className="ui-undo-toast" role="status" aria-live="polite" aria-atomic="true">
      <div className="ui-undo-toast__content">
        <Icon name={icon} className="ui-undo-toast__icon" aria-hidden />
        <span className="ui-undo-toast__label">{message}</span>
        <button className="ui-undo-toast__undo" onClick={onUndo} aria-label={undoAriaLabel}>
          Undo
          {/* The same action is bound to ⌘Z while the toast is up (useUndoDelete). */}
          <kbd className="ui-undo-toast__kbd" aria-hidden>⌘Z</kbd>
        </button>
        <button className="ui-undo-toast__dismiss" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="ph:x-bold" aria-hidden />
        </button>
      </div>
      <div
        className="ui-undo-toast__progress"
        style={{ width: collapsed ? "0%" : "100%", transitionDuration: `${durationMs}ms` }}
        aria-hidden
      />
    </div>
  );
}
