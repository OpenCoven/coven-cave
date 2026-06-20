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
export const DATETIME_DENSITY_KEY = "cave:datetime-density";

export const CLOCK_OPTIONS = ["12h", "24h"] as const;
export type ClockFormat = (typeof CLOCK_OPTIONS)[number];
export const DEFAULT_CLOCK: ClockFormat = "12h";

export const DATE_OPTIONS = ["mmdd", "ddmm", "off"] as const;
export type DateFormat = (typeof DATE_OPTIONS)[number];
export const DEFAULT_DATE: DateFormat = "mmdd";

export const DENSITY_OPTIONS = ["compact", "verbose"] as const;
export type DensityFormat = (typeof DENSITY_OPTIONS)[number];
export const DEFAULT_DENSITY: DensityFormat = "compact";

export type DateTimePrefs = { clock: ClockFormat; date: DateFormat; density?: DensityFormat };

export const CLOCK_LABEL: Record<ClockFormat, string> = {
  "12h": "12-hour",
  "24h": "24-hour",
};

export const DATE_LABEL: Record<DateFormat, string> = {
  mmdd: "MM.DD",
  ddmm: "DD.MM",
  off: "Off",
};

export const DENSITY_LABEL: Record<DensityFormat, string> = {
  compact: "Compact",
  verbose: "Verbose",
};

export function normalizeClock(value: unknown): ClockFormat {
  return CLOCK_OPTIONS.includes(value as ClockFormat) ? (value as ClockFormat) : DEFAULT_CLOCK;
}

export function normalizeDate(value: unknown): DateFormat {
  return DATE_OPTIONS.includes(value as DateFormat) ? (value as DateFormat) : DEFAULT_DATE;
}

export function normalizeDensity(value: unknown): DensityFormat {
  return DENSITY_OPTIONS.includes(value as DensityFormat) ? (value as DensityFormat) : DEFAULT_DENSITY;
}

// ── In-memory mirror + change broadcaster ──────────────────────────────────────

const DEFAULT_PREFS: DateTimePrefs = Object.freeze({ clock: DEFAULT_CLOCK, date: DEFAULT_DATE, density: DEFAULT_DENSITY });
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
      density: normalizeDensity(window.localStorage.getItem(DATETIME_DENSITY_KEY)),
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

export function setDensityFormat(value: DensityFormat): void {
  const density = normalizeDensity(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DATETIME_DENSITY_KEY, density);
    } catch {
      /* storage unavailable — keep the in-memory pick */
    }
  }
  snapshot = { ...getSnapshot(), density };
  notify();
}

// ── Cross-tab + cross-component sync ────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === DATETIME_CLOCK_KEY || e.key === DATETIME_DATE_KEY || e.key === DATETIME_DENSITY_KEY) {
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
 * Time only ("1:31 AM" / "13:31"), honoring the clock (12h/24h) preference.
 * This is the app-wide entry point: any surface that shows a time (calendar
 * events, capability scan times, debug events, …) routes through here so the
 * clock setting is global, not chat-only. `prefs` defaults to the persisted
 * preference, so callers outside a React tree can use it directly; pass
 * `{ seconds: true }` where second precision matters (e.g. the debug log).
 */
export function formatClock(
  iso: string,
  prefs: DateTimePrefs = readDateTimePrefs(),
  opts: { seconds?: boolean } = {},
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    ...(opts.seconds ? { second: "2-digit" } : {}),
    hour12: prefs.clock === "12h",
  });
}

/**
 * Format an ISO timestamp per the given prefs. The date portion is built from
 * the local month/day (so it's locale-stable: "06.19"), and the time portion
 * uses {@link formatClock}. Returns "" for an unparseable input.
 */
export function formatTimestamp(iso: string, prefs: DateTimePrefs = DEFAULT_PREFS): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = formatClock(iso, prefs);
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const datePart = prefs.date === "mmdd" ? `${mm}.${dd}` : prefs.date === "ddmm" ? `${dd}.${mm}` : "";
  return datePart ? `${datePart} ${time}` : time;
}

/**
 * Verbose date honoring the date preference's ORDERING (month-first vs
 * day-first), keeping the month name (+ optional year/weekday) — so non-chat
 * date displays (library list, memory inspector, calendar header) follow the
 * user's regional date order without being forced into the compact "06.19"
 * form. `ddmm` → day-first ("19 Jun" / "19 Jun 2026"); anything else (mmdd, the
 * chat-only "off") → month-first ("Jun 19" / "Jun 19, 2026"). Accepts an ISO
 * string, epoch ms, or a Date. Returns "" for unparseable input.
 */
export function formatDate(
  input: string | number | Date,
  prefs: DateTimePrefs = readDateTimePrefs(),
  opts: { year?: boolean; weekday?: boolean; month?: "short" | "long" } = {},
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const dayFirst = prefs.date === "ddmm";
  const month = d.toLocaleDateString([], { month: opts.month ?? "short" });
  const day = d.getDate();
  const dm = dayFirst ? `${day} ${month}` : `${month} ${day}`;
  const withYear = opts.year
    ? dayFirst
      ? `${dm} ${d.getFullYear()}`
      : `${dm}, ${d.getFullYear()}`
    : dm;
  return opts.weekday ? `${d.toLocaleDateString([], { weekday: "long" })}, ${withYear}` : withYear;
}
