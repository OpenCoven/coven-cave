"use client";

import { useCallback, useEffect } from "react";

/**
 * Persist a composer's in-progress text so a page reload doesn't eat a
 * half-written message.
 *
 * Why this exists: the chat composer (chat-view.tsx) and the home composer
 * (home-composer.tsx) each hand-rolled the identical draft plumbing — a lazy
 * read for the initial state, a debounced write so mobile typing doesn't hit
 * localStorage per keystroke, and remove-on-empty so sent prompts don't
 * reappear on reload. Only the storage key differs; one implementation keeps
 * the semantics from drifting.
 *
 * `clearNow` writes the empty draft synchronously. The send paths need it
 * because a send can unmount the composer (mode switch / navigation), which
 * cancels the debounced writer before it can flush the cleared text —
 * otherwise the sent prompt resurrects as an unsent draft on return.
 */

export function readComposerDraft(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeComposerDraft(key: string, text: string) {
  if (typeof window === "undefined") return;
  try {
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    /* best effort */
  }
}

export function useDraftPersistence(
  key: string,
  value: string,
  delayMs = 250,
): { clearNow: () => void } {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeComposerDraft(key, value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, delayMs]);

  const clearNow = useCallback(() => writeComposerDraft(key, ""), [key]);
  return { clearNow };
}
