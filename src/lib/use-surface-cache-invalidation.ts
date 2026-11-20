"use client";

import { useEffect } from "react";
import { invalidateIfDefined } from "@/lib/surface-warm-cache";

/** Keep demand-loaded snapshots fresh even while their surfaces are unmounted. */
export function useSurfaceCacheInvalidation(): void {
  useEffect(() => {
    const onBoardReload = () => invalidateIfDefined("board:cards", "tasks:queue");
    const onSchedulesReload = () => invalidateIfDefined("schedules:inbox", "schedules:automations");
    const onFamiliarsRefresh = () => invalidateIfDefined("github:familiars");
    window.addEventListener("cave:board:reload", onBoardReload);
    window.addEventListener("cave:schedules:reload", onSchedulesReload);
    window.addEventListener("cave:familiars-refresh", onFamiliarsRefresh);
    return () => {
      window.removeEventListener("cave:board:reload", onBoardReload);
      window.removeEventListener("cave:schedules:reload", onSchedulesReload);
      window.removeEventListener("cave:familiars-refresh", onFamiliarsRefresh);
    };
  }, []);
}
