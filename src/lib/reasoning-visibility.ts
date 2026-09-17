// Global "show thinking" preference for the chat transcript.
//
// Reasoning (`<thinking>`/`<reasoning>`) blocks open by default so a reply's
// working is read alongside its answer (#5454). A single global toggle lets the
// user fold every reasoning block at once — the preference is persisted in
// localStorage and broadcast via a custom event so the toggle control and all
// on-screen ReasoningBlocks (which live deep inside memoised turn rows) stay in
// sync without threading state through every parent. Only a stored "0" hides
// them; an absent or unrecognised value falls back to the default.

"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "cave:chat:show-thinking";
const EVENT = "cave:show-thinking-change";

/** Reasoning blocks are open unless the user has folded them. */
export const DEFAULT_SHOW_THINKING = true;

export function readShowThinking(): boolean {
  if (typeof window === "undefined") return DEFAULT_SHOW_THINKING;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
    return DEFAULT_SHOW_THINKING;
  } catch {
    return DEFAULT_SHOW_THINKING;
  }
}

export function writeShowThinking(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* private mode / quota — fall back to in-memory broadcast only */
  }
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: value }));
}

/**
 * Subscribe to the global show-thinking preference. Returns the current value
 * and a setter that persists + broadcasts the change to every subscriber.
 */
export function useShowThinking(): [boolean, (value: boolean) => void] {
  const [show, setShow] = useState(DEFAULT_SHOW_THINKING);

  useEffect(() => {
    setShow(readShowThinking());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      setShow(typeof detail === "boolean" ? detail : readShowThinking());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setShow(readShowThinking());
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [show, writeShowThinking];
}
