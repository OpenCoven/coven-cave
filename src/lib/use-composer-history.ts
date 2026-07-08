"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { readComposerHistory, writeComposerHistory } from "@/lib/composer-history";

/**
 * Persisted ↑/↓ prompt-history recall for a composer textarea.
 *
 * Why this exists: the chat composer (chat-view.tsx) and the home composer
 * (home-composer.tsx) each hand-rolled the identical recall stack — lazy read
 * from localStorage (composer-history.ts), persist-on-change, ↑ recalls only
 * from an empty input (never clobbers a draft), ↓ walks back toward the empty
 * composer. Only the storage key differs.
 *
 * `push` stays a call-site decision: home records slash commands in history,
 * chat deliberately does not (its slash intents return before the push).
 *
 * `handleArrowKey` returns true when it consumed the event, so each composer's
 * keyboard handler keeps its own branch ordering around it (chat: after the
 * inline-menu branches, before the IME-guarded Enter-send).
 */
export function useComposerHistory(storageKey: string): {
  push: (entry: string) => void;
  handleArrowKey: (
    e: KeyboardEvent<HTMLTextAreaElement>,
    text: string,
    setText: (t: string) => void,
  ) => boolean;
} {
  const [history, setHistory] = useState<string[]>(() => readComposerHistory(storageKey));
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  // Persist the ↑/↓ prompt-history so past prompts survive a reload.
  useEffect(() => {
    writeComposerHistory(storageKey, history);
  }, [storageKey, history]);

  const push = useCallback((entry: string) => {
    setHistory((prev) => [...prev, entry]);
    setHistoryIdx(-1);
  }, []);

  const handleArrowKey = useCallback(
    (
      e: KeyboardEvent<HTMLTextAreaElement>,
      text: string,
      setText: (t: string) => void,
    ): boolean => {
      if (e.key === "ArrowUp" && text === "" && history.length > 0) {
        e.preventDefault();
        const idx = historyIdx < history.length - 1 ? historyIdx + 1 : historyIdx;
        setHistoryIdx(idx);
        setText(history[history.length - 1 - idx] ?? "");
        return true;
      }
      if (e.key === "ArrowDown" && historyIdx > 0) {
        e.preventDefault();
        const idx = historyIdx - 1;
        setHistoryIdx(idx);
        setText(history[history.length - 1 - idx] ?? "");
        return true;
      }
      if (e.key === "ArrowDown" && historyIdx === 0) {
        e.preventDefault();
        setHistoryIdx(-1);
        setText("");
        return true;
      }
      return false;
    },
    [history, historyIdx],
  );

  return { push, handleArrowKey };
}
