"use client";

// Review requests for the new-session launcher's Reviews group (cave-umgkh).
//
// Mounted by both new-session surfaces, with the same discipline as the Queue
// snapshot beside it: one abort-guarded fetch, refreshed on window focus,
// never polled — the page is replaced by the first turn.
//
// Most Caves have no GitHub token, and /api/github/assigned answers that with
// `configured: false` rather than an error. That is not a failure to report on
// a brand-new chat, so it resolves to an empty snapshot and the group is
// simply absent.

import { useCallback, useEffect, useRef, useState } from "react";

import { reviewRequests, type ReviewRequest } from "./chat-review-requests.ts";
import type { GitHubItem } from "./github-tasks.ts";
import { useRefreshOnFocus } from "./use-refresh-on-focus.ts";
import { whenStartupSettled } from "./startup-gate.ts";
import { sharedJsonFetch } from "./shared-json-fetch.ts";

type AssignedResponse = {
  ok?: boolean;
  items?: GitHubItem[];
  configured?: boolean;
};

export type ReviewRequestsSnapshot = {
  /** Reviews waiting on you, freshest first. */
  rows: ReviewRequest[];
  /** False when no GitHub token is configured — the group stays absent. */
  configured: boolean;
  loading: boolean;
};

export function useReviewRequests(enabled = true): ReviewRequestsSnapshot {
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const abortRef = useRef<AbortController | null>(null);

  // Shared across remounts (#5663); a window focus refreshes live.
  const load = useCallback(async (force = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      // Not needed until it is on screen: wait out app load (#5649).
      await whenStartupSettled();
      if (controller.signal.aborted) return;
      const { data } = await sharedJsonFetch<AssignedResponse>("/api/github/assigned", { force });
      const json = data ?? ({} as AssignedResponse);
      if (controller.signal.aborted) return;
      // `configured: false` (no token) and a rejected/expired PAT both mean
      // "nothing to offer here" from a brand-new chat's point of view. The
      // GitHub surface owns reconnecting; this group just steps aside.
      const ok = Boolean(json.ok) && Boolean(json.configured);
      setConfigured(ok);
      setItems(ok && Array.isArray(json.items) ? json.items : []);
    } catch {
      if (!controller.signal.aborted) {
        setConfigured(false);
        setItems([]);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      setItems([]);
      setLoading(false);
      return;
    }
    void load();
    return () => abortRef.current?.abort();
  }, [enabled, load]);
  const refresh = useCallback(() => load(true), [load]);
  useRefreshOnFocus(refresh, { enabled });

  return { rows: reviewRequests(items), configured, loading };
}
