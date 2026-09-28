/**
 * One fetch of `/api/github/item?pull=1` shared by every card that shows the
 * same issue or PR (#5615). A transcript mentioning PR #30 three times used to
 * make three requests on every open, each three live GitHub calls, and they
 * queued the transcript itself behind them in the browser's per-host
 * connection pool. Identical requests in flight are joined, and a successful
 * answer is reused for FRESH_MS. `fresh` is a card refreshing after an action:
 * it skips the reuse here and asks the server to skip its own.
 */

export type GitHubItemResponse = { status: number; data: unknown };

const FRESH_MS = 30_000;
const MAX_ENTRIES = 128;

const answers = new Map<string, { at: number; value: GitHubItemResponse }>();
const inflight = new Map<string, Promise<GitHubItemResponse>>();

function itemUrl(repo: string, number: number, fresh: boolean): string {
  return `/api/github/item?repo=${encodeURIComponent(repo)}&number=${number}&pull=1${fresh ? "&fresh=1" : ""}`;
}

export function fetchGitHubItem(
  repo: string,
  number: number,
  options: { fresh?: boolean; now?: () => number } = {},
): Promise<GitHubItemResponse> {
  const now = options.now ?? Date.now;
  const key = `${repo.toLowerCase()}#${number}`;
  if (!options.fresh) {
    const hit = answers.get(key);
    if (hit && now() - hit.at < FRESH_MS) return Promise.resolve(hit.value);
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const request = (async (): Promise<GitHubItemResponse> => {
    const res = await fetch(itemUrl(repo, number, Boolean(options.fresh)), { cache: "no-store" });
    const value = { status: res.status, data: await res.json().catch(() => null) };
    if (res.ok) {
      answers.delete(key);
      answers.set(key, { at: now(), value });
      while (answers.size > MAX_ENTRIES) {
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

/** Test seam. */
export function clearGitHubItemFetchCache(): void {
  answers.clear();
  inflight.clear();
  sharedAnswers.clear();
  sharedInflight.clear();
}

const sharedAnswers = new Map<string, { at: number; value: GitHubItemResponse }>();
const sharedInflight = new Map<string, Promise<GitHubItemResponse>>();

/**
 * The same sharing for the other card lookups (#5627): checks and review
 * threads. Identical requests in flight are joined and a successful answer is
 * reused for `freshMs`; `fresh` (a card refreshing after an action) skips the
 * reuse. The routes behind these keep no answers of their own.
 */
export function fetchSharedGitHubJson(
  url: string,
  options: { freshMs: number; fresh?: boolean; now?: () => number },
): Promise<GitHubItemResponse> {
  const now = options.now ?? Date.now;
  if (!options.fresh) {
    const hit = sharedAnswers.get(url);
    if (hit && now() - hit.at < options.freshMs) return Promise.resolve(hit.value);
    const pending = sharedInflight.get(url);
    if (pending) return pending;
  }
  const request = (async (): Promise<GitHubItemResponse> => {
    const res = await fetch(url, { cache: "no-store" });
    const value = { status: res.status, data: await res.json().catch(() => null) };
    if (res.ok) {
      sharedAnswers.delete(url);
      sharedAnswers.set(url, { at: now(), value });
      while (sharedAnswers.size > MAX_ENTRIES) {
        const oldest = sharedAnswers.keys().next().value;
        if (oldest === undefined) break;
        sharedAnswers.delete(oldest);
      }
    }
    return value;
  })();
  sharedInflight.set(url, request);
  const clear = () => {
    if (sharedInflight.get(url) === request) sharedInflight.delete(url);
  };
  request.then(clear, clear);
  return request;
}
