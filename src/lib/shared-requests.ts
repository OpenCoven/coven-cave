/**
 * The core of the client's shared fetchers (shared JSON, GitHub cards): join
 * identical requests in flight, reuse a kept answer while fresh, and let
 * `force` ask again.
 *
 * Generation-aware (#5671): a forced request can start while an older one for
 * the same key is still in flight. Whichever resolved last used to win, so a
 * refresh after an action could be overwritten by the request it replaced —
 * both in the kept answer and for that older request's callers. Now every
 * request takes a generation; a superseded one never stores its answer and
 * hands its callers the newest request's answer instead.
 */

type Kept<V> = { at: number; value: V };
type Outcome<V> = { value: V } | { error: unknown };

export type SharedRequestOptions = { force?: boolean; freshMs: number; now?: () => number };

// One counter for every key: a key's bookkeeping can then be dropped once
// nothing for it is in flight without a later request reusing a generation.
let generationCounter = 0;

export function createSharedRequests<V>(config: {
  /** Whether an answer may be reused (failures are asked again). */
  keep: (value: V) => boolean;
  maxEntries: number;
}) {
  const answers = new Map<string, Kept<V>>();
  const inflight = new Map<string, Promise<V>>();
  // Per key, only while a request for it is in flight: the latest generation,
  // how many requests are pending, and the latest request's outcome (success or
  // failure) for superseded requests that settle after it.
  const latest = new Map<string, number>();
  const pendingCount = new Map<string, number>();
  const latestOutcome = new Map<string, Outcome<V>>();

  function newest(key: string, own: Promise<V>): Promise<V> | Outcome<V> | undefined {
    const pending = inflight.get(key);
    if (pending && pending !== own) return pending;
    return latestOutcome.get(key);
  }

  function settleSuperseded(key: string, own: Promise<V>, fallback: Outcome<V>): Promise<V> | V {
    const answer = newest(key, own) ?? fallback;
    if (answer instanceof Promise) return answer;
    if ("error" in answer) throw answer.error;
    return answer.value;
  }

  function run(key: string, load: () => Promise<V>, options: SharedRequestOptions): Promise<V> {
    const now = options.now ?? Date.now;
    if (!options.force) {
      const hit = answers.get(key);
      if (hit && now() - hit.at < options.freshMs) return Promise.resolve(hit.value);
      const pending = inflight.get(key);
      if (pending) return pending;
    }
    const generation = ++generationCounter;
    latest.set(key, generation);
    pendingCount.set(key, (pendingCount.get(key) ?? 0) + 1);
    const superseded = () => latest.get(key) !== generation;
    // Read only after an await, once the assignment below has happened.
    let request!: Promise<V>;
    request = (async () => {
      let value: V;
      try {
        value = await load();
      } catch (error) {
        if (superseded()) return settleSuperseded(key, request, { error });
        latestOutcome.set(key, { error });
        throw error;
      }
      if (superseded()) return settleSuperseded(key, request, { value });
      latestOutcome.set(key, { value });
      if (config.keep(value)) {
        answers.delete(key);
        answers.set(key, { at: now(), value });
        while (answers.size > config.maxEntries) {
          const oldest = answers.keys().next().value;
          if (oldest === undefined) break;
          answers.delete(oldest);
        }
      }
      return value;
    })();
    inflight.set(key, request);
    const settle = () => {
      if (inflight.get(key) === request) inflight.delete(key);
      const remaining = (pendingCount.get(key) ?? 1) - 1;
      if (remaining > 0) {
        pendingCount.set(key, remaining);
        return;
      }
      pendingCount.delete(key);
      latest.delete(key);
      latestOutcome.delete(key);
    };
    request.then(settle, settle);
    return request;
  }

  function clear(): void {
    answers.clear();
    inflight.clear();
    latest.clear();
    pendingCount.clear();
    latestOutcome.clear();
  }

  /** Test seam: bookkeeping held for keys with nothing in flight should be none. */
  function trackedKeys(): number {
    return latest.size + pendingCount.size + latestOutcome.size;
  }

  return { run, clear, trackedKeys };
}
