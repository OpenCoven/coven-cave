// Global "show thinking" preference for the chat transcript.
//
// Reasoning (`<thinking>`/`<reasoning>`) blocks default to collapsed so the
// transcript reads as clean prose. A single global toggle lets the user expand
// every reasoning block at once — the preference is persisted in localStorage
// and broadcast via a custom event so the toggle control and all on-screen
// ReasoningBlocks (which live deep inside memoised turn rows) stay in sync
// without threading state through every parent.

"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "cave:chat:show-thinking";
const EVENT = "cave:show-thinking-change";

export function readShowThinking(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
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
  const [show, setShow] = useState(false);

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
