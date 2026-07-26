"use client";

import { useEffect, useRef, useState } from "react";

import { isStale } from "./threads-read.ts";
import type { SurfaceState } from "./weave-rail.ts";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const STALE_BANNER = {
  kind: "stale" as const,
  message: "This view is past its freshness window — showing last-known state.",
};

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export type ResponseFreshnessClock<Handle = TimerHandle> = {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => Handle;
  clearTimeout: (handle: Handle) => void;
};

const SYSTEM_CLOCK: ResponseFreshnessClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export function responseEnvelopeStateAt<T>(
  state: SurfaceState<T>,
  now: Date = new Date(),
): SurfaceState<T> {
  if (state.kind !== "ready" || state.banners.some((banner) => banner.kind === "stale")) {
    return state;
  }
  if (!isStale(state.meta, now)) return state;
  return { ...state, banners: [...state.banners, STALE_BANNER] };
}

export function scheduleResponseEnvelopeStaleness<Handle = TimerHandle>(
  staleAfter: string,
  onElapsed: (reason: "expired" | "timer") => void,
  clock: ResponseFreshnessClock<Handle> = SYSTEM_CLOCK as unknown as ResponseFreshnessClock<Handle>,
): () => void {
  const staleAt = Date.parse(staleAfter);
  const now = clock.now();
  let active = true;
  let elapsed = false;
  let handle: Handle | undefined;
  let timerArmed = false;

  const notifyElapsed = (reason: "expired" | "timer") => {
    if (!active || elapsed) return;
    elapsed = true;
    onElapsed(reason);
  };
  const cleanup = () => {
    active = false;
    if (timerArmed) clock.clearTimeout(handle as Handle);
  };

  if (!Number.isFinite(staleAt)) return cleanup;
  if (now > staleAt) {
    notifyElapsed("expired");
    return cleanup;
  }

  const delay = Math.min(staleAt - now + 1, MAX_TIMER_DELAY_MS);
  handle = clock.setTimeout(() => notifyElapsed("timer"), delay);
  timerArmed = true;
  return cleanup;
}

export function useResponseEnvelopeFreshness<T>(state: SurfaceState<T>): SurfaceState<T> {
  const [freshnessTick, setFreshnessTick] = useState(0);
  const immediateUpdateFor = useRef<string | null>(null);
  const staleAfter = state.kind === "ready" ? state.meta.staleAfter : null;
  const responseState = responseEnvelopeStateAt(state);
  const responseIsStale =
    responseState.kind === "ready" &&
    responseState.banners.some((banner) => banner.kind === "stale");

  useEffect(() => {
    if (staleAfter === null || responseIsStale) return;
    return scheduleResponseEnvelopeStaleness(staleAfter, (reason) => {
      if (reason === "expired") {
        if (immediateUpdateFor.current === staleAfter) return;
        immediateUpdateFor.current = staleAfter;
      }
      setFreshnessTick((tick) => tick + 1);
    });
  }, [freshnessTick, responseIsStale, staleAfter, state]);

  return responseState;
}
