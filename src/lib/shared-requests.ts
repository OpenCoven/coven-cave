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

export type SharedRequestOptions = { force?: boolean; freshMs: number; now?: () => number };

export function createSharedRequests<V>(config: {
  /** Whether an answer may be reused (failures are asked again). */
  keep: (value: V) => boolean;
  maxEntries: number;
}) {
  const answers = new Map<string, Kept<V>>();
  const inflight = new Map<string, Promise<V>>();
  const generations = new Map<string, number>();

  function newest(key: string, own: Promise<V>): Promise<V> | V | undefined {
    const pending = inflight.get(key);
    if (pending && pending !== own) return pending;
    return answers.get(key)?.value;
  }

  function run(key: string, load: () => Promise<V>, options: SharedRequestOptions): Promise<V> {
    const now = options.now ?? Date.now;
    if (!options.force) {
      const hit = answers.get(key);
      if (hit && now() - hit.at < options.freshMs) return Promise.resolve(hit.value);
      const pending = inflight.get(key);
      if (pending) return pending;
    }
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    const superseded = () => generations.get(key) !== generation;
    // Read only after an await, once the assignment below has happened.
    let request!: Promise<V>;
    request = (async () => {
      let value: V;
      try {
        value = await load();
      } catch (error) {
        if (superseded()) {
          const latest = newest(key, request);
          if (latest !== undefined) return latest;
        }
        throw error;
      }
      if (superseded()) {
        const latest = newest(key, request);
        return latest !== undefined ? latest : value;
      }
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
    const clear = () => {
      if (inflight.get(key) === request) inflight.delete(key);
    };
    request.then(clear, clear);
    return request;
  }

  function clear(): void {
    answers.clear();
    inflight.clear();
    generations.clear();
  }

  return { run, clear };
}
