"use client";

import { useCallback, useEffect, useState } from "react";

import { RESEARCH_MEDIA_PATH } from "@/lib/research-media-ticket";

export type ResearchMediaUrlState = {
  url: string | null;
  status: "idle" | "loading" | "ready" | "error";
  retry: () => void;
  reportPlaybackFailure: () => void;
};

type ResearchMediaUrlStateInternal = Omit<ResearchMediaUrlState, "retry" | "reportPlaybackFailure"> & {
  scope: string;
};

function mediaTicketUrl(familiarId: string, generationId: string) {
  const params = new URLSearchParams({ familiarId, id: generationId });
  return `/api/research/generations/media-ticket?${params}`;
}

/**
 * Resolve the native-player URL through authenticated fetch. Packaged Tauri
 * injects the sidecar credential into fetch but native media subrequests
 * cannot set that header, so the returned URL carries a short-lived,
 * generation-scoped capability instead of the sidecar credential.
 */
export function useResearchMediaUrl(familiarId: string, generationId: string, enabled: boolean): ResearchMediaUrlState {
  const scope = `${familiarId}\u0000${generationId}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResearchMediaUrlStateInternal>({
    scope,
    url: null,
    status: enabled ? "loading" : "idle",
  });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const reportPlaybackFailure = useCallback(() => {
    setState((current) => (
      current.scope === scope ? { ...current, url: null, status: "error" } : current
    ));
  }, [scope]);

  useEffect(() => {
    if (!enabled) {
      setState({ scope, url: null, status: "idle" });
      return;
    }
    let active = true;
    setState({ scope, url: null, status: "loading" });
    void (async () => {
      try {
        const response = await fetch(mediaTicketUrl(familiarId, generationId));
        const body = await response.json() as { ok?: unknown; mediaUrl?: unknown };
        if (!response.ok || body.ok !== true || typeof body.mediaUrl !== "string") {
          throw new Error("media ticket request failed");
        }
        const url = new URL(body.mediaUrl, window.location.origin);
        if (url.origin !== window.location.origin || url.pathname !== RESEARCH_MEDIA_PATH) {
          throw new Error("media ticket returned an invalid URL");
        }
        if (active) setState({ scope, url: `${url.pathname}${url.search}`, status: "ready" });
      } catch {
        if (active) setState({ scope, url: null, status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, enabled, familiarId, generationId, scope]);

  const current = state.scope === scope
    ? state
    : { url: null, status: enabled ? "loading" : "idle" };
  return { ...current, retry, reportPlaybackFailure };
}
