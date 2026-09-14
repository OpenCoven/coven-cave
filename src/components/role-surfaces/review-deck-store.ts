import { prKey } from "./review-deck";
import { parseReviewItem, readReviewJson } from "./review-github-read";
import { isTerminalPr, type PrBucketFacts, type PrFacts } from "./review-readiness";

export const BUCKET_READ_CAP = 12;
const CONCURRENCY = 3;
type PullRequest = { repo: string; number: number };
export type DeckBucketSnapshot = {
  facts: ReadonlyMap<string, PrBucketFacts>;
  errors: ReadonlyMap<string, string>;
  skipped: number;
  loading: boolean;
  error: string | null;
};

export async function readBucketFacts(pr: PullRequest, signal: AbortSignal): Promise<PrBucketFacts> {
  const query = `repo=${encodeURIComponent(pr.repo)}&number=${pr.number}&pull=1`;
  return parseReviewItem(await readReviewJson(`/api/github/item?${query}`, signal));
}

/**
 * Owns queue reads independently of render timing. A selected read supersedes
 * an older bucket read for that PR only, leaving unrelated requests and notes
 * alone. Aborted generations never publish, even if a transport ignores abort.
 */
export function createDeckBucketStore(read = readBucketFacts) {
  let snapshot: DeckBucketSnapshot = {
    facts: new Map(), errors: new Map(), skipped: 0, loading: false, error: null,
  };
  let pullRequests: PullRequest[] = [];
  let controller: AbortController | null = null;
  let generation = 0;
  const versions = new Map<string, number>();
  const listeners = new Set<() => void>();

  function publish(patch: Partial<DeckBucketSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    const messages = [...snapshot.errors].map(([key, error]) => `${key}: ${error}`);
    snapshot.error = messages.length ? messages.join(" ") : null;
    for (const listener of listeners) listener();
  }

  function cancel() {
    generation += 1;
    controller?.abort();
    controller = null;
  }

  function load(refresh: boolean) {
    cancel();
    const ownedGeneration = generation;
    const active = new AbortController();
    controller = active;
    const keys = new Set(pullRequests.map(prKey));
    const wanted = pullRequests.slice(0, BUCKET_READ_CAP);
    const facts = new Map([...snapshot.facts].filter(([key, value]) =>
      keys.has(key) && (!refresh || isTerminalPr(value))));
    const errors = new Map([...snapshot.errors].filter(([key]) => keys.has(key) && !refresh));
    const queue = wanted.filter((pr) => refresh || (!facts.has(prKey(pr)) && !errors.has(prKey(pr))));
    publish({
      facts, errors, skipped: pullRequests.slice(BUCKET_READ_CAP).filter((pr) => !facts.has(prKey(pr))).length,
      loading: queue.length > 0,
    });
    let next = 0;
    async function worker() {
      while (next < queue.length && !active.signal.aborted) {
        const pr = queue[next++];
        const key = prKey(pr);
        const version = versions.get(key) ?? 0;
        try {
          const value = await read(pr, active.signal);
          if (generation !== ownedGeneration || active.signal.aborted) return;
          if ((versions.get(key) ?? 0) !== version) continue;
          const updated = new Map(snapshot.facts).set(key, value);
          const remaining = new Map(snapshot.errors);
          remaining.delete(key);
          publish({ facts: updated, errors: remaining });
        } catch (error) {
          if (generation !== ownedGeneration || active.signal.aborted) return;
          if ((versions.get(key) ?? 0) !== version) continue;
          const updated = new Map(snapshot.facts);
          // A failed refresh cannot resurrect a confirmed terminal PR.
          if (!isTerminalPr(updated.get(key))) updated.delete(key);
          publish({
            facts: updated,
            errors: new Map(snapshot.errors).set(key, error instanceof Error ? error.message : "GitHub read failed."),
          });
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).then(() => {
      if (generation === ownedGeneration && !active.signal.aborted) publish({ loading: false });
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPullRequests(prs: readonly PullRequest[]) {
      pullRequests = [...new Map(prs.map((pr) => [prKey(pr), pr])).values()];
      load(false);
    },
    refresh() { load(true); },
    recordFacts(facts: PrFacts) {
      const key = prKey(facts);
      if (!pullRequests.some((pr) => prKey(pr) === key)) return;
      versions.set(key, (versions.get(key) ?? 0) + 1);
      const errors = new Map(snapshot.errors);
      errors.delete(key);
      const updated = new Map(snapshot.facts).set(key, facts);
      publish({
        facts: updated, errors,
        skipped: pullRequests.slice(BUCKET_READ_CAP).filter((pr) => !updated.has(prKey(pr))).length,
      });
    },
    cancel,
  };
}
