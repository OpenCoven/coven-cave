"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { SessionRow } from "@/lib/types";

export type ChatSessionList = {
  sessions: SessionRow[];
  /** True once a first response (or failure) has settled for this scope. */
  loaded: boolean;
  /** The last load failed; `sessions` keeps the last good list. */
  error: boolean;
  refresh: () => Promise<void>;
  /** Drop rows the caller just deleted, ahead of the next poll. */
  removeSessions: (sessionIds: readonly string[]) => void;
};

type CachedList = { scope: string; etag: string; sessions: SessionRow[] };

/**
 * A self-owned, polled read of `/api/sessions/list` for one scope: a single
 * familiar's chats, or every familiar's when `familiarId` is null.
 *
 * The detached Chat window uses this instead of the workspace's session
 * state, so its lists never follow the main window's active familiar. It is
 * the same bounded, serialized, conditional read the right Chat panel makes
 * for a launch (#5594): a 15 s deadline so a stalled request cannot hold the
 * poll, and `If-None-Match` so an unchanged list costs a bodiless 304.
 */
export function useChatSessionList(
  familiarId: string | null,
  options: { enabled: boolean; intervalMs?: number },
): ChatSessionList {
  const { enabled, intervalMs = 4_000 } = options;
  const scope = familiarId ?? "*";
  const [state, setState] = useState<{ scope: string; sessions: SessionRow[]; loaded: boolean; error: boolean }>({
    scope,
    sessions: [],
    loaded: false,
    error: false,
  });
  const generationRef = useRef(0);
  const cacheRef = useRef<CachedList | null>(null);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const params = new URLSearchParams({ classifyFamiliarWorkspace: "1" });
      if (familiarId) params.set("familiarId", familiarId);
      const cached = cacheRef.current?.scope === scope ? cacheRef.current : null;
      const response = await fetch(`/api/sessions/list?${params}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        ...(cached ? { headers: { "If-None-Match": cached.etag } } : {}),
      });
      let sessions: SessionRow[];
      if (response.status === 304 && cached) {
        sessions = cached.sessions;
      } else {
        const json = (await response.json()) as { ok?: boolean; sessions?: unknown };
        if (!response.ok || !json.ok || !Array.isArray(json.sessions)) throw new Error("Couldn't load chats");
        sessions = json.sessions as SessionRow[];
        const etag = response.headers.get("ETag");
        if (etag) cacheRef.current = { scope, etag, sessions };
      }
      if (generation !== generationRef.current) return;
      setState((previous) =>
        previous.scope === scope && previous.loaded && !previous.error && previous.sessions === sessions
          ? previous
          : { scope, sessions, loaded: true, error: false },
      );
    } catch {
      if (generation !== generationRef.current) return;
      setState((previous) => ({
        scope,
        sessions: previous.scope === scope ? previous.sessions : [],
        loaded: true,
        error: true,
      }));
    }
  }, [familiarId, scope]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    return () => {
      // Retire the in-flight response so it cannot land after a scope change
      // or after the caller stopped listening.
      generationRef.current += 1;
    };
  }, [enabled, refresh]);
  usePausablePoll(refresh, intervalMs, { enabled, serialize: true });

  const removeSessions = useCallback((sessionIds: readonly string[]) => {
    if (sessionIds.length === 0) return;
    setState((previous) => ({
      ...previous,
      sessions: previous.sessions.filter((session) => !sessionIds.includes(session.id)),
    }));
    // The cached body still lists them; force a full read on the next poll.
    cacheRef.current = null;
  }, []);

  // A scope change must not show the previous scope's rows for a render.
  const current = state.scope === scope;
  return {
    sessions: current ? state.sessions : [],
    loaded: current && state.loaded,
    error: current && state.error,
    refresh,
    removeSessions,
  };
}
