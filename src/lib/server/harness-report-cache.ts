/**
 * harness-report-cache — one recent answer to "which harnesses are ready?"
 * (cave-3rz.3).
 *
 * `GET /api/harnesses` re-probes every adapter on every call: `which`, a
 * `--version` spawn per installed runtime, `coven adapter list --json`, the
 * OpenClaw registry. Measured on this machine it costs **3.43 / 3.49 / 3.57 s**
 * across three consecutive calls. `POST /api/scry` runs that probe before it
 * can spawn anything, so a fifth of a 17 s scry was spent re-deriving a fact
 * that had not changed.
 *
 * The contract is deliberately lopsided, because the two callers want opposite
 * things:
 *
 *  · **`/api/harnesses` writes but never reads.** Onboarding polls it every 2 s
 *    while a runtime installs, and must see the install the moment it lands. It
 *    keeps probing exactly as before; it just leaves its answer here.
 *  · **`/api/scry` reads.** A scry that picks a harness one minute stale picks
 *    the same harness, and the cost of being wrong is a clear 503 the rite
 *    already renders.
 *
 * So a rite that loads the page (and prefetches `/api/harnesses`) has a warm
 * cache by the time an image is dropped, and the probe never lands inside the
 * user's wait. An in-flight probe is shared rather than duplicated, so two
 * scries started together spawn one set of probes, not two.
 */

export type HarnessReportCacheEntry<T> = { at: number; reports: T[] };

/** Long enough to cover a page load plus choosing an image; short enough that
 *  installing a runtime and immediately scrying still finds it. */
export const HARNESS_REPORT_CACHE_TTL_MS = 60_000;

let entry: HarnessReportCacheEntry<unknown> | null = null;
let inFlight: Promise<unknown[]> | null = null;

/** Test seam: the module-level clock, so cache expiry is assertable. */
let now: () => number = () => Date.now();

export function setHarnessReportCacheClock(clock: () => number): void {
  now = clock;
}

/** Record a freshly probed list. Called by `/api/harnesses` on every response
 *  so ordinary UI traffic keeps the cache warm for free. */
export function writeHarnessReports<T>(reports: readonly T[]): void {
  entry = { at: now(), reports: [...reports] as unknown[] };
}

/** The cached list if it is younger than `ttlMs`, else null. */
export function readHarnessReports<T>(
  ttlMs: number = HARNESS_REPORT_CACHE_TTL_MS,
): T[] | null {
  if (!entry) return null;
  if (now() - entry.at > ttlMs) return null;
  return entry.reports as T[];
}

/**
 * Cached list, or one fresh probe shared by every concurrent caller.
 *
 * The probe's result is written through, so a cold scry pays the 3.4 s once and
 * the next one — and the next `/api/harnesses` consumer — does not.
 */
export async function harnessReportsWithCache<T>(
  probe: () => Promise<T[]>,
  ttlMs: number = HARNESS_REPORT_CACHE_TTL_MS,
): Promise<{ reports: T[]; cached: boolean }> {
  const hit = readHarnessReports<T>(ttlMs);
  if (hit) return { reports: hit, cached: true };
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const reports = await probe();
        writeHarnessReports(reports);
        return reports as unknown[];
      } finally {
        inFlight = null;
      }
    })();
  }
  return { reports: (await inFlight) as T[], cached: false };
}

/** Drop everything. Tests only — nothing in the app invalidates by hand. */
export function clearHarnessReportCache(): void {
  entry = null;
  inFlight = null;
}
