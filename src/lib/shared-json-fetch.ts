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

export const SHARED_JSON_FRESH_MS = 60_000;
const MAX_ENTRIES = 64;

export type SharedJsonResponse<T> = { ok: boolean; status: number; data: T | null };

const answers = new Map<string, { at: number; value: SharedJsonResponse<unknown> }>();
const inflight = new Map<string, Promise<SharedJsonResponse<unknown>>>();

export function sharedJsonFetch<T>(
  url: string,
  options: { force?: boolean; freshMs?: number; now?: () => number } = {},
): Promise<SharedJsonResponse<T>> {
  const now = options.now ?? Date.now;
  const freshMs = options.freshMs ?? SHARED_JSON_FRESH_MS;
  if (!options.force) {
    const hit = answers.get(url);
    if (hit && now() - hit.at < freshMs) return Promise.resolve(hit.value as SharedJsonResponse<T>);
    const pending = inflight.get(url);
    if (pending) return pending as Promise<SharedJsonResponse<T>>;
  }
  const request = (async (): Promise<SharedJsonResponse<unknown>> => {
    const res = await fetch(url, { cache: "no-store" });
    const value = { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
    if (res.ok) {
      answers.delete(url);
      answers.set(url, { at: now(), value });
      while (answers.size > MAX_ENTRIES) {
        const oldest = answers.keys().next().value;
        if (oldest === undefined) break;
        answers.delete(oldest);
      }
    }
    return value;
  })();
  inflight.set(url, request);
  const clear = () => {
    if (inflight.get(url) === request) inflight.delete(url);
  };
  request.then(clear, clear);
  return request as Promise<SharedJsonResponse<T>>;
}

/** Test seam. */
export function clearSharedJsonFetch(): void {
  answers.clear();
  inflight.clear();
}
