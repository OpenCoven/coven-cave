import { githubTokenIdentity } from "./github-item-cache.ts";

/**
 * The GitHub login a token belongs to (#5930).
 *
 * The review card offers Comment only on your own pull request, because
 * GitHub rejects APPROVE and REQUEST_CHANGES from a PR's author. Knowing that
 * needs the token's own login. This asks REST `/user` once per token and keeps
 * the answer: a login never changes for a token. It never uses GraphQL, whose
 * budget is shared by every agent signed in as the user.
 *
 * A failure answers `null` ("unknown", which keeps every review verb) and is
 * held for a short backoff so a dead network is not asked on every card.
 */

const SUCCESS_MS = 6 * 60 * 60_000;
const FAILURE_MS = 5 * 60_000;
const MAX_ENTRIES = 32;

type Entry = { at: number; ttl: number; login: string | null };

type Store = { entries: Map<string, Entry>; inflight: Map<string, Promise<string | null>> };

// One store per process: routes and the instrumentation bundle each load
// their own copy of this module.
const GLOBAL_KEY = "__caveGitHubViewerCache";
function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { entries: new Map(), inflight: new Map() };
  return g[GLOBAL_KEY];
}

export type GitHubViewerOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export async function githubViewerLogin(
  token: string | null,
  options: GitHubViewerOptions = {},
): Promise<string | null> {
  if (!token) return null;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const { entries, inflight } = store();
  const key = githubTokenIdentity(token);
  const hit = entries.get(key);
  if (hit && now() - hit.at < hit.ttl) return hit.login;
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    let login: string | null = null;
    try {
      const res = await fetchImpl("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as { login?: unknown } | null;
      if (res.ok && typeof data?.login === "string" && data.login.trim()) login = data.login.trim();
    } catch {
      login = null;
    }
    entries.delete(key);
    entries.set(key, { at: now(), ttl: login ? SUCCESS_MS : FAILURE_MS, login });
    while (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    return login;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    if (inflight.get(key) === request) inflight.delete(key);
  }
}

/** Test seam. */
export function clearGitHubViewerCache(): void {
  const { entries, inflight } = store();
  entries.clear();
  inflight.clear();
}
