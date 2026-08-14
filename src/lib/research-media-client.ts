"use client";

import { useCallback, useEffect, useState } from "react";

import { RESEARCH_MEDIA_PATH } from "@/lib/research-media-ticket";

export type ResearchMediaUrlState = {
  url: string | null;
  status: "idle" | "loading" | "ready" | "error";
  retry: () => void;
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
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<ResearchMediaUrlState, "retry">>({
    url: null,
    status: enabled ? "loading" : "idle",
  });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ url: null, status: "idle" });
      return;
    }
    let active = true;
    setState({ url: null, status: "loading" });
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
        if (active) setState({ url: `${url.pathname}${url.search}`, status: "ready" });
      } catch {
        if (active) setState({ url: null, status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, enabled, familiarId, generationId]);

  return { ...state, retry };
}
