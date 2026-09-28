/**
 * One fetch of familiar-independent JSON shared by every component that mounts
 * and asks for it (#5663).
 *
 * A familiar switch remounts the composer, the launcher and the capability
 * panel, and each refetched the same skills, prompts, roles, queue and review
 * data — up to 1.3 s per request — in the browser's six per-host connections
 * exactly while the switch's own requests needed them. Identical requests in
 * flight are joined and a successful answer is reused while fresh. `force`
 * (an explicit refresh: a saved template, a window focus) skips the reuse.
 *
 * Callers never pass an AbortSignal: a request can be shared, so one caller
 * unmounting must not cancel another's. Callers check their own cancellation
 * after awaiting instead.
 */

import { createSharedRequests } from "./shared-requests.ts";

export const SHARED_JSON_FRESH_MS = 60_000;

export type SharedJsonResponse<T> = { ok: boolean; status: number; data: T | null };

// Generation-aware sharing (#5671): a forced refresh is never overwritten by an
// older request for the same URL.
const requests = createSharedRequests<SharedJsonResponse<unknown>>({
  keep: (value) => value.ok,
  maxEntries: 64,
});

export function sharedJsonFetch<T>(
  url: string,
  options: { force?: boolean; freshMs?: number; now?: () => number } = {},
): Promise<SharedJsonResponse<T>> {
  return requests.run(
    url,
    async () => {
      const res = await fetch(url, { cache: "no-store" });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
    },
    { force: options.force, freshMs: options.freshMs ?? SHARED_JSON_FRESH_MS, now: options.now },
  ) as Promise<SharedJsonResponse<T>>;
}

/** Test seam. */
export function clearSharedJsonFetch(): void {
  requests.clear();
}
