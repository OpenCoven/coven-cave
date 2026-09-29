"use client";

import { useEffect } from "react";
import { prefetchConversation } from "./conversation-cache.ts";

/** Rail rows whose transcripts are warmed ahead of a click. */
export const THREAD_WARMUP_LIMIT = 4;

type WarmupDeps = {
  prefetch: (sessionId: string) => Promise<unknown>;
  scheduleIdle: (callback: () => void) => () => void;
};

/**
 * Warm the top rail rows' transcripts one at a time, each in its own idle
 * slot, so the first click on a visible chat paints from cache instead of
 * waiting on the network. Sequential on purpose: a transcript can be large,
 * and parsing several at once would itself be the jank this avoids. Rows
 * already fresh in the cache resolve without a request. Returns a cancel.
 */
export function warmThreadTranscripts(sessionIds: readonly string[], deps: WarmupDeps): () => void {
  let cancelled = false;
  let cancelIdle = () => {};
  const queue = sessionIds.slice(0, THREAD_WARMUP_LIMIT);
  const next = () => {
    const sessionId = queue.shift();
    if (cancelled || !sessionId) return;
    cancelIdle = deps.scheduleIdle(() => {
      if (cancelled) return;
      void deps.prefetch(sessionId).catch(() => null).then(next);
    });
  };
  next();
  return () => {
    cancelled = true;
    cancelIdle();
  };
}

function scheduleIdle(callback: () => void): () => void {
  const idle = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idle.requestIdleCallback) {
    const id = idle.requestIdleCallback(callback, { timeout: 2_000 });
    return () => idle.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 250);
  return () => window.clearTimeout(id);
}

/** Warms the given rows' transcripts while the browser is idle. */
export function useThreadWarmup(sessionIds: readonly string[], enabled: boolean): void {
  const key = sessionIds.slice(0, THREAD_WARMUP_LIMIT).join("\n");
  useEffect(() => {
    if (!enabled || !key || typeof window === "undefined") return;
    // A constrained connection keeps its bandwidth for what the user clicks.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    return warmThreadTranscripts(key.split("\n"), { prefetch: prefetchConversation, scheduleIdle });
  }, [enabled, key]);
}
