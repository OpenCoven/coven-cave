"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type AnnounceLevel = "polite" | "assertive";

type AnnouncerContextValue = {
  announce: (message: string, level?: AnnounceLevel) => void;
};

const AnnouncerContext = createContext<AnnouncerContextValue | null>(null);

/**
 * Mount once at the root. Renders two visually-hidden live regions (polite
 * and assertive). The polite region is for status updates; the assertive
 * region is for errors and time-critical alerts.
 *
 * Messages are cleared 250ms after being set so re-announcing the same
 * string actually triggers an AT announcement (regions debounce identical
 * strings otherwise).
 */
export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const politeClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assertiveClear = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((message: string, level: AnnounceLevel = "polite") => {
    if (!message) return;
    if (level === "assertive") {
      if (assertiveClear.current) clearTimeout(assertiveClear.current);
      setAssertive(message);
      assertiveClear.current = setTimeout(() => setAssertive(""), 250);
    } else {
      if (politeClear.current) clearTimeout(politeClear.current);
      setPolite(message);
      politeClear.current = setTimeout(() => setPolite(""), 250);
    }
  }, []);

  // Cancel any pending clear so we don't fire setState on an unmounted tree.
  useEffect(() => {
    return () => {
      if (politeClear.current) clearTimeout(politeClear.current);
      if (assertiveClear.current) clearTimeout(assertiveClear.current);
    };
  }, []);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {polite}
      </div>
      <div
        className="sr-only"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

/**
 * `const { announce } = useAnnouncer()` then call `announce("Saved.")` or
 * `announce("Failed to save", "assertive")`. Throws if no provider is in
 * scope — that's a programmer error to catch early.
 */
export function useAnnouncer(): AnnouncerContextValue {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) {
    throw new Error("useAnnouncer must be used within a LiveRegionProvider");
  }
  return ctx;
}
