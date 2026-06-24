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
 * pair. Shared by the library delete-undo surfaces and the Projects move-undo.
 * Styles live in the `.library-undo-toast*` rules in src/styles/library.css.
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
    <div className="library-undo-toast" role="status" aria-live="polite" aria-atomic="true">
      <div className="library-undo-toast-content">
        <Icon name={icon} className="library-undo-toast-icon" aria-hidden />
        <span className="library-undo-toast-label">{message}</span>
        <button className="library-undo-toast-undo" onClick={onUndo} aria-label={undoAriaLabel}>
          Undo
          {/* The same action is bound to ⌘Z while the toast is up (useUndoDelete). */}
          <kbd className="library-undo-toast-kbd" aria-hidden>⌘Z</kbd>
        </button>
        <button className="library-undo-toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="ph:x-bold" aria-hidden />
        </button>
      </div>
      <div
        className="library-undo-toast-progress"
        style={{ width: collapsed ? "0%" : "100%", transitionDuration: `${durationMs}ms` }}
        aria-hidden
      />
    </div>
  );
}
