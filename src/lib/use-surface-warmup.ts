"use client";

import { useEffect } from "react";
import { markEnd, markStart } from "@/lib/perf/marks";
import { abortWarm, invalidateIfDefined } from "@/lib/surface-warm-cache";
import type { SurfaceWarmupSurface } from "@/lib/surface-warmup-registry";

const ORDER: readonly SurfaceWarmupSurface[] = ["board", "schedules", "github", "marketplace", "grimoire", "agents"];

function scheduleIdle(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
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

/**
 * Starts only after the shell and initially selected surface have had two paint
 * opportunities. It never mounts a page: it preloads chunks and landing data
 * through the shared cache, one canonical surface at a time.
 */
export function useSurfaceWarmup(): void {
  useEffect(() => {
    let cancelled = false;
    let paused = false;
    let cancelIdle = () => {};
    let cursor = 0;
    let active = false;
    let backpressured = false;

    const runnable = () => !cancelled && !backpressured && !document.hidden && navigator.onLine !== false;
    const runNext = () => {
      if (active || !runnable() || cursor >= ORDER.length) return;
      const surface = ORDER[cursor++];
      active = true;
      markStart(`surface-warmup:${surface}`);
      // Keep the coordinator and its lazy-surface imports out of the initial
      // shell/sidecar trace. It is only needed after first interactive paint.
      void import("@/lib/surface-warmup-registry").then(({ warmSurface }) => warmSurface(surface, runnable))
        .then((result) => {
          if (!result.backpressured) return;
          backpressured = true;
          performance.mark("cave:surface-warmup:backpressure");
        })
        .catch(() => {
          // A failed warm is deliberately non-fatal; navigation keeps its
          // normal truthful loading/error path and a later resume retries.
        })
        .finally(() => {
          active = false;
          markEnd(`surface-warmup:${surface}`);
          if (!runnable() || cursor >= ORDER.length) {
            if (cursor >= ORDER.length) markEnd("surface-warmup:total");
            return;
          }
          cancelIdle = scheduleIdle(runNext);
        });
    };
    const begin = () => {
      if (!runnable()) return;
      performance.mark("cave:first-interactive");
      markStart("surface-warmup:total");
      cancelIdle = scheduleIdle(runNext);
    };
    const resume = () => {
      paused = false;
      if (!active && runnable() && cursor < ORDER.length) cancelIdle = scheduleIdle(runNext);
    };
    const pause = () => {
      if (paused) return;
      paused = true;
      cancelIdle();
      // `cursor` advances before work begins. Revisit the interrupted surface
      // on resume; the cache makes a completed request a zero-network read.
      if (active && cursor > 0) cursor -= 1;
      abortWarm();
    };
    const onVisibility = () => (document.hidden ? pause() : resume());
    // Board writes can originate outside BoardView (for example, Home's quick
    // task composer). Keep a completed background snapshot from surviving one
    // of those writes until its TTL expires. This listener is workspace-owned,
    // so it also runs while BoardView itself is unmounted.
    const onBoardReload = () => invalidateIfDefined("board:cards", "tasks:queue");
    // Inbox writes are also emitted through the workspace-owned SSE stream,
    // including writes made from the notification bell while Schedules is
    // unmounted. Drop the warm landing snapshot before its 15-second TTL so
    // navigating to Schedules cannot show the pre-write state.
    const onSchedulesReload = () => invalidateIfDefined("schedules:inbox", "schedules:automations");
    // The normal roster-refresh event is emitted after a familiar is summoned,
    // removed, restored, or reconfigured. GitHub's assignment controls consume
    // a warmed roster too, so don't keep a fresh pre-mutation snapshot for its
    // 30-second TTL.
    const onFamiliarsRefresh = () => invalidateIfDefined("github:familiars");
    const raf = window.requestAnimationFrame(() => window.requestAnimationFrame(begin));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", resume);
    window.addEventListener("offline", pause);
    window.addEventListener("cave:board:reload", onBoardReload);
    window.addEventListener("cave:schedules:reload", onSchedulesReload);
    window.addEventListener("cave:familiars-refresh", onFamiliarsRefresh);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      cancelIdle();
      abortWarm();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", pause);
      window.removeEventListener("cave:board:reload", onBoardReload);
      window.removeEventListener("cave:schedules:reload", onSchedulesReload);
      window.removeEventListener("cave:familiars-refresh", onFamiliarsRefresh);
    };
  }, []);
}
