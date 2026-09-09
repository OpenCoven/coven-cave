"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

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

/** Home composer's draft key. Shared so surfaces that hand a prompt off to
 *  Home (marketplace "Try it") write to the exact slot Home reads at mount. */
export const HOME_DRAFT_KEY = "cave:home-composer-draft:v1";

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
  // Latest key/value for the unmount flush below, kept current by the
  // debounce effect (which runs after every value change) and by clearNow.
  const latestRef = useRef({ key, value });

  useEffect(() => {
    latestRef.current = { key, value };
    const timer = window.setTimeout(() => {
      if (latestRef.current.key === key) writeComposerDraft(key, latestRef.current.value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, delayMs]);

  // Flush on unmount or key change: debounce cleanup CANCELS a pending write, so
  // unmounting within delayMs of the last keystroke dropped the draft's tail
  // (pane-set remounts, mode switches). Safe against sent-prompt
  // resurrection: send paths call clearNow before any same-tick unmount, and
  // clearNow updates latestRef, so the flush writes "" — never pre-send text.
  useEffect(
    () => () => writeComposerDraft(latestRef.current.key, latestRef.current.value),
    [key],
  );

  const clearNow = useCallback(() => {
    if (latestRef.current.key !== key) return;
    latestRef.current = { key, value: "" };
    writeComposerDraft(key, "");
  }, [key]);
  return { clearNow };
}

/** A reused composer must switch text and persistence ownership together. */
export function useComposerDraft(key: string, delayMs = 250) {
  const [draft, setDraft] = useState(() => ({ key, value: readComposerDraft(key) }));
  const committedDraft = useRef(draft);
  useEffect(() => { committedDraft.current = draft; }, [draft]);
  if (draft.key !== key) {
    setDraft({ key, value: readComposerDraft(key) });
  }
  const setValue = useCallback((next: SetStateAction<string>) => {
    setDraft((current) => {
      // Async work started on another thread must not change this draft.
      if (current.key !== key) return current;
      return { key, value: typeof next === "function" ? next(current.value) : next };
    });
  }, [key]);
  const value = draft.key === key ? draft.value : "";
  const { clearNow } = useDraftPersistence(key, value, delayMs);
  const transferTo = useCallback((destination: string) => {
    if (committedDraft.current.key !== key || destination === key) return;
    writeComposerDraft(destination, committedDraft.current.value);
    clearNow();
  }, [key, clearNow]);
  return { value, setValue, clearNow, transferTo };
}

export function chatComposerDraftKey(
  namespace: string,
  context: { familiarId: string; sessionId: string | null; project: string; host: string },
): string {
  return `${namespace}:scoped:${JSON.stringify(
    context.sessionId
      ? ["session", context.familiarId, context.sessionId]
      : ["compose", context.familiarId, context.project, context.host],
  )}`;
}
