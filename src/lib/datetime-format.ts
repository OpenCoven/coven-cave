"use client";

/**
 * Cave-local date/time formatting preferences for chat message timestamps.
 *
 * Two independent picks, persisted in localStorage and mirrored across tabs +
 * components via a tiny `useSyncExternalStore` store (same shape as
 * `cave-glyph-overrides`):
 *   - clock: 12-hour ("1:31 AM") vs 24-hour ("13:31")
 *   - date:  MM.DD ("06.19"), DD.MM ("19.06"), or Off (time only)
 *
 * This is purely a UI-side preference (no daemon write) — it changes how the
 * chat renders existing `createdAt` ISO strings, nothing on disk. The default
 * ("MM.DD" + 12-hour) renders "06.19 1:31 AM".
 *
 * `getServerSnapshot` returns the frozen defaults so SSR and the first client
 * hydration render agree; React re-renders with the persisted pick right after
 * hydration, so a non-default setting never trips a hydration mismatch.
 */

import { useSyncExternalStore } from "react";

export const DATETIME_CLOCK_KEY = "cave:datetime-clock";
export const DATETIME_DATE_KEY = "cave:datetime-date";

export const CLOCK_OPTIONS = ["12h", "24h"] as const;
export type ClockFormat = (typeof CLOCK_OPTIONS)[number];
export const DEFAULT_CLOCK: ClockFormat = "12h";

export const DATE_OPTIONS = ["mmdd", "ddmm", "off"] as const;
export type DateFormat = (typeof DATE_OPTIONS)[number];
export const DEFAULT_DATE: DateFormat = "mmdd";

export type DateTimePrefs = { clock: ClockFormat; date: DateFormat };

export const CLOCK_LABEL: Record<ClockFormat, string> = {
  "12h": "12-hour",
  "24h": "24-hour",
};

export const DATE_LABEL: Record<DateFormat, string> = {
  mmdd: "MM.DD",
  ddmm: "DD.MM",
  off: "Off",
};

export function normalizeClock(value: unknown): ClockFormat {
  return CLOCK_OPTIONS.includes(value as ClockFormat) ? (value as ClockFormat) : DEFAULT_CLOCK;
}

export function normalizeDate(value: unknown): DateFormat {
  return DATE_OPTIONS.includes(value as DateFormat) ? (value as DateFormat) : DEFAULT_DATE;
}

// ── In-memory mirror + change broadcaster ──────────────────────────────────────

const DEFAULT_PREFS: DateTimePrefs = Object.freeze({ clock: DEFAULT_CLOCK, date: DEFAULT_DATE });
let snapshot: DateTimePrefs | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readFromStorage(): DateTimePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    return {
      clock: normalizeClock(window.localStorage.getItem(DATETIME_CLOCK_KEY)),
      date: normalizeDate(window.localStorage.getItem(DATETIME_DATE_KEY)),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function getSnapshot(): DateTimePrefs {
  if (snapshot === null) snapshot = readFromStorage();
  return snapshot;
}

function getServerSnapshot(): DateTimePrefs {
  return DEFAULT_PREFS;
}

/** Non-hook accessor for one-shot reads that can't take a hook. */
export function readDateTimePrefs(): DateTimePrefs {
  return getSnapshot();
}

// ── Mutators (always go through these so listeners fire) ────────────────────────

export function setClockFormat(value: ClockFormat): void {
  const clock = normalizeClock(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DATETIME_CLOCK_KEY, clock);
    } catch {
      /* storage unavailable — keep the in-memory pick */
    }
  }
  snapshot = { ...getSnapshot(), clock };
  notify();
}

export function setDateFormat(value: DateFormat): void {
  const date = normalizeDate(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DATETIME_DATE_KEY, date);
    } catch {
      /* storage unavailable — keep the in-memory pick */
    }
  }
  snapshot = { ...getSnapshot(), date };
  notify();
}

// ── Cross-tab + cross-component sync ────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === DATETIME_CLOCK_KEY || e.key === DATETIME_DATE_KEY) {
      snapshot = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: current date/time prefs. Re-renders on any change. */
export function useDateTimePrefs(): DateTimePrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ── Pure formatter ──────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format an ISO timestamp per the given prefs. The date portion is built from
 * the local month/day (so it's locale-stable: "06.19"), and the time portion
 * uses the platform locale's clock with `hour12` driven by the pref. Returns
 * "" for an unparseable input.
 */
export function formatTimestamp(iso: string, prefs: DateTimePrefs = DEFAULT_PREFS): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: prefs.clock === "12h",
  });
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const datePart = prefs.date === "mmdd" ? `${mm}.${dd}` : prefs.date === "ddmm" ? `${dd}.${mm}` : "";
  return datePart ? `${datePart} ${time}` : time;
}
