"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-step destructive click: the first click arms (caller swaps the label to
 * a "Really …?" variant), the second fires. Arming auto-disarms after `ms`.
 * For one-click removals that have neither confirm nor undo (cave-5lsj) in an
 * app that otherwise trains users to expect undo.
 */
export function useArmedConfirm(ms = 4000): {
  armed: boolean;
  /** First call arms; a second call within the window disarms and runs `fire`. */
  trigger: (fire: () => void) => void;
  disarm: () => void;
} {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => {
      armedRef.current = false;
      setArmed(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [armed, ms]);

  const trigger = useCallback((fire: () => void) => {
    if (armedRef.current) {
      armedRef.current = false;
      setArmed(false);
      fire();
      return;
    }
    armedRef.current = true;
    setArmed(true);
  }, []);

  const disarm = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
  }, []);

  return { armed, trigger, disarm };
}
