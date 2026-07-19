"use client";

// Persisted open/closed state for the home hearth card's disclosure sections
// ("Open work", "Prompt snippets"). The preference is read AFTER mount (same
// SSR-determinism pattern as the hero greeting): the server always renders the
// default state, then the stored preference lands in an effect, so hydration
// can never mismatch on aria-expanded.

import { useCallback, useEffect, useState } from "react";

export function readDisclosurePref(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* storage unavailable — stay on the default */
  }
  return fallback;
}

export function useHomeDisclosure(
  key: string,
  defaultOpen: boolean,
): [boolean, () => void] {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(readDisclosurePref(key, defaultOpen));
  }, [key, defaultOpen]);
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* storage unavailable — session-only toggle */
      }
      return next;
    });
  }, [key]);
  return [open, toggle];
}
