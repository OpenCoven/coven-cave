// Lightweight custom-span instrumentation on top of the User Timing API.
//
// `markStart("chat:first-token")` … `markEnd("chat:first-token")` records a
// `performance.measure`, keeps the last N durations in an in-memory ring (read
// via getPerfMeasures()), and dispatches a `cave:perf-measure` CustomEvent the
// dev overlay listens for. All calls are no-ops when the User Timing API is
// absent (SSR, old runtimes), so callers don't need to guard.

import { recordPerfSample } from "./perf-store.ts";

export type PerfMeasure = { name: string; duration: number; at: number };

const RING_MAX = 50;
const ring: PerfMeasure[] = [];

const hasPerf = () =>
  typeof performance !== "undefined" && typeof performance.mark === "function";

const startMark = (name: string) => `cave:${name}:start`;

export function markStart(name: string): void {
  if (!hasPerf()) return;
  try {
    performance.mark(startMark(name));
  } catch {
    /* mark name clash or quota — non-fatal */
  }
}

/** Close the span opened by markStart(name); returns the duration in ms, or null. */
export function markEnd(name: string): number | null {
  if (!hasPerf()) return null;
  try {
    const measure = performance.measure(`cave:${name}`, startMark(name));
    // performance.measure returns the entry in modern browsers; fall back to
    // reading it back by name if not.
    const duration =
      measure?.duration ??
      performance.getEntriesByName(`cave:${name}`).at(-1)?.duration ??
      0;
    recordMeasure(name, duration);
    return duration;
  } catch {
    // markEnd without a matching markStart, etc. — non-fatal.
    return null;
  }
}

export function getPerfMeasures(): readonly PerfMeasure[] {
  return ring;
}

function recordMeasure(name: string, duration: number): void {
  const entry: PerfMeasure = { name, duration, at: Date.now() };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  recordPerfSample({ kind: "mark", name, value: duration, at: entry.at });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cave:perf-measure", { detail: entry }));
  }
}

/** A request owns its start time, even when other requests use the same name. */
export function startSpan(name: string): () => number | null {
  if (!hasPerf()) return () => null;
  const start = performance.now();
  let ended = false;
  return () => {
    if (ended) return null;
    ended = true;
    const duration = performance.now() - start;
    recordMeasure(name, duration);
    return duration;
  };
}
