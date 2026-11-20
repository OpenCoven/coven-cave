"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { inFlightView, parseInFlightOverview, type InFlightCache, type InFlightView } from "./in-flight.ts";

/** Re-read while the surface is visible, on the lifecycle overview's cadence. */
const REFRESH_MS = 30_000;
/** How often staleness is re-judged without a new read. */
const CLOCK_MS = 15_000;

// The newest read survives a remount within the session, so returning to the
// surface shows the last known state (marked stale once it ages).
let sessionCache: InFlightCache = { lastGood: null, latest: null };

export type AutomationInFlightHandle = {
  view: (id: string) => InFlightView;
  cache: InFlightCache;
  now: number;
  refresh: () => Promise<void>;
};

/** What every automation is doing right now, read only while `enabled` and the surface is visible. */
export function useAutomationInFlight(enabled: boolean): AutomationInFlightHandle {
  const [cache, setCache] = useState<InFlightCache>(sessionCache);
  const [now, setNow] = useState(() => Date.now());
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const request = ++requestRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let result;
    try {
      const res = await fetch("/api/coven-automation-occurrences", { cache: "no-store", signal: controller.signal });
      result = parseInFlightOverview(await res.json().catch(() => null));
    } catch {
      result = { kind: "unavailable" as const };
    }
    // A superseded or abandoned read never overwrites a newer one.
    if (request !== requestRef.current || controller.signal.aborted) return;
    setCache((previous) => {
      const next: InFlightCache = result.kind === "available"
        ? { lastGood: result, latest: "available" }
        : { lastGood: previous.lastGood, latest: result.kind };
      sessionCache = next;
      return next;
    });
    setNow(Date.now());
  }, [enabled]);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);
  usePausablePoll(refresh, REFRESH_MS, { enabled, serialize: true });
  usePausablePoll(() => setNow(Date.now()), CLOCK_MS);

  const view = useCallback((id: string) => inFlightView(cache, id, now), [cache, now]);
  return { view, cache, now, refresh };
}
