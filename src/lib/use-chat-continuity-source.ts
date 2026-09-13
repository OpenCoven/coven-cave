"use client";

import { useEffect, useState } from "react";
import { continuitySourceId } from "./chat-continuity-preferences";

type SourceState = {
  status: "loading" | "ready" | "unavailable";
  id: string | null;
};

export function useChatContinuitySource(enabled: boolean): SourceState {
  const [state, setState] = useState<SourceState>({ status: "loading", id: null });
  useEffect(() => {
    if (!enabled) {
      setState({ status: "loading", id: null });
      return;
    }
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setState({ status: "loading", id: null });
      const deadline = setTimeout(() => request.abort(), 5000);
      try {
        const response = await fetch("/api/client/v1/health", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("Cave identity is unavailable");
        const payload: unknown = await response.json();
        const data = payload && typeof payload === "object" && "data" in payload ? payload.data : null;
        const instanceId = data && typeof data === "object" && "instanceId" in data ? data.instanceId : null;
        const id = continuitySourceId(instanceId, window.location.origin);
        if (!id || request.signal.aborted) throw new Error("Cave identity is invalid or expired");
        if (active && controller === request) setState({ status: "ready", id });
      } catch {
        if (active && controller === request) {
          console.warn("Cave continuity identity could not be read; saved chat restoration is unavailable.");
          setState({ status: "unavailable", id: null });
        }
      } finally {
        clearTimeout(deadline);
      }
    };
    void refresh();
    return () => {
      active = false;
      controller?.abort();
    };
  }, [enabled]);
  return enabled ? state : { status: "unavailable", id: null };
}
