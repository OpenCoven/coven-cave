"use client";

/**
 * perf-store — make a performance number survive the page that produced it.
 *
 * Both existing capture points are amnesiac. `perf/marks.ts` keeps the last 50
 * durations in a module-level array, and `WebVitalsReporter` stashes each metric
 * on `window.__caveVitals` and `console.debug`s it in development. Reload the
 * tab and every one of them is gone, which means there has never been a way to
 * compare a client-side before against a client-side after — the exact thing
 * "measure first" requires and the reason the chat-load work has so far only
 * carried server numbers.
 *
 * This adds the missing half: a bounded `sessionStorage` ring the two capture
 * points write through.
 *
 * ## Why sessionStorage, and why bounded twice
 *
 * Per-tab and cleared when the tab closes, which is the right lifetime for a
 * measurement aid — it must not accumulate across days on a user's machine, and
 * it must not be mistaken for telemetry. Nothing here is sent anywhere; there is
 * no beacon and no endpoint.
 *
 * Bounded by BOTH a sample count and a serialized byte budget because the origin
 * quota is the real constraint and it is not ours to spend: Cave already shipped
 * a bug where a store's own cap was generous enough to blow past the ~5 MB
 * origin limit, and WebKit surfaced it as a raw "The quota has been exceeded."
 * error in the UI. A perf aid that can break the app it measures is worse than
 * no perf aid, so every write is wrapped and a quota failure disables the store
 * for the rest of the page rather than retrying into the same wall.
 *
 * ## Why writes are buffered
 *
 * `markEnd` fires on every instrumented span — several per chat open. Serializing
 * and writing the whole ring each time would add JSON work to the very paths
 * being measured, which would corrupt the measurement. Samples accumulate in
 * memory and flush on a throttle, plus once on `pagehide`/`visibilitychange` so
 * a reload keeps the tail.
 */

export type PerfSample = {
  /** `mark` for a User Timing span, `vital` for a Core Web Vital. */
  kind: "mark" | "vital";
  name: string;
  /** Milliseconds for a mark; the metric's own unit for a vital. */
  value: number;
  at: number;
  /** Vitals only: good | needs-improvement | poor. */
  rating?: string;
};

const STORAGE_KEY = "cave:perf:samples";
/** Ring length. Enough to hold a session's worth of chat opens, not a day's. */
const MAX_SAMPLES = 300;
/**
 * Serialized ceiling, well under the ~5 MB origin quota this shares with every
 * other Cave store. The count cap above is the usual binding limit; this exists
 * so an unexpectedly long span name cannot turn 300 samples into megabytes.
 */
const MAX_BYTES = 128 * 1024;
/** Never write more often than this, however many samples arrive. */
const FLUSH_THROTTLE_MS = 2_000;

let buffered: PerfSample[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFlushAt = 0;
/** Set once a quota failure proves the store unusable for this page. */
let disabled = false;
let listenersBound = false;

function storage(): Storage | null {
  if (disabled || typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Storage can throw on access alone under some privacy settings.
    disabled = true;
    return null;
  }
}

function readPersisted(): PerfSample[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PerfSample[]) : [];
  } catch {
    // Malformed payload from an older shape — drop it rather than fail reads.
    return [];
  }
}

/** Trim to the count cap first, then to the byte cap, oldest-first. */
function withinBudget(samples: PerfSample[]): { kept: PerfSample[]; serialized: string } {
  let kept = samples.length > MAX_SAMPLES ? samples.slice(-MAX_SAMPLES) : samples;
  let serialized = JSON.stringify(kept);
  while (serialized.length > MAX_BYTES && kept.length > 1) {
    kept = kept.slice(Math.ceil(kept.length / 4));
    serialized = JSON.stringify(kept);
  }
  return { kept, serialized };
}

export function flushPerfSamples(): void {
  const store = storage();
  if (!store || buffered.length === 0) return;
  const pending = buffered;
  buffered = [];
  const { serialized } = withinBudget([...readPersisted(), ...pending]);
  try {
    store.setItem(STORAGE_KEY, serialized);
    lastFlushAt = Date.now();
  } catch {
    // Quota, or a private mode that rejects writes. Give up for this page
    // instead of retrying into the same wall on every subsequent sample —
    // a measurement aid must never be the thing that breaks a surface.
    disabled = true;
    buffered = [];
  }
}

function scheduleFlush(): void {
  if (disabled || flushTimer !== null) return;
  const elapsed = Date.now() - lastFlushAt;
  const delay = elapsed >= FLUSH_THROTTLE_MS ? 0 : FLUSH_THROTTLE_MS - elapsed;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPerfSamples();
  }, delay);
}

function bindLifecycleListeners(): void {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;
  // `pagehide` rather than `unload`: the latter is unreliable and blocks the
  // back/forward cache. `visibilitychange` catches a tab switch that never
  // returns, which is how most measurement sessions actually end.
  window.addEventListener("pagehide", flushPerfSamples);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPerfSamples();
  });
}

/** Record one sample. Cheap: buffers in memory, writes on a throttle. */
export function recordPerfSample(sample: PerfSample): void {
  if (disabled || typeof window === "undefined") return;
  bindLifecycleListeners();
  buffered.push(sample);
  if (buffered.length > MAX_SAMPLES) buffered = buffered.slice(-MAX_SAMPLES);
  scheduleFlush();
}

/** Everything persisted plus anything still buffered, oldest first. */
export function getPerfSamples(): readonly PerfSample[] {
  return [...readPersisted(), ...buffered];
}

/** Drop the store. Exposed for the overlay's reset control and for tests. */
export function clearPerfSamples(): void {
  buffered = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do — the store is already unusable */
  }
}

/**
 * p50/p95 for one span name across everything recorded.
 *
 * The reason this file exists: a single duration says nothing, and the numbers
 * that matter for chat load are percentiles across many opens.
 */
export function summarizePerfSamples(name: string): { count: number; p50: number; p95: number } | null {
  const values = getPerfSamples()
    .filter((sample) => sample.name === name)
    .map((sample) => sample.value)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const at = (fraction: number) =>
    values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))];
  return { count: values.length, p50: at(0.5), p95: at(0.95) };
}
