// "PRs merged today" for the daily report. Server-only: reads the local PAT
// (same tiers as /api/github/activity — never logged, never forwarded beyond
// api.github.com) and degrades to null whenever token or login can't be
// resolved, so the report section simply stays absent.

import { resolveSecret } from "@/lib/vault";
import type { MergedPr } from "@/lib/daily-report-facts";

const GH = "https://api.github.com";
const TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let cache: { at: number; day: string; items: MergedPr[] } | null = null;

function dateSlug(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type SearchItem = {
  number?: number;
  title?: string;
  html_url?: string;
  repository_url?: string;
  pull_request?: { merged_at?: string | null };
};

async function ghJson(path: string, token: string | null): Promise<unknown> {
  const res = await fetch(`${GH}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return res.json();
}

/** PRs authored by the local user merged during the local calendar day of
 *  `now`. Search qualifiers are UTC, so the query reaches one day back and the
 *  results are re-filtered against local time. Returns null (never throws)
 *  when the PAT or login is unresolvable or the fetch fails with no usable
 *  cache — the caller renders nothing rather than an error. */
export async function fetchMergedPrsForDay(now = new Date()): Promise<MergedPr[] | null> {
  const day = dateSlug(now);
  if (cache && cache.day === day && Date.now() - cache.at < TTL_MS) return cache.items;

  // Same auth tiers as /api/github/activity: PAT when present, else the
  // public unauthenticated API with GITHUB_USERNAME (search allows anonymous
  // queries at a low rate — one request per 10-min cache window is fine).
  const token = resolveSecret("GITHUB_PAT") ?? process.env.GITHUB_TOKEN?.trim() ?? null;

  try {
    let login = resolveSecret("GITHUB_USERNAME") ?? null;
    if (!login && token) {
      const user = (await ghJson("/user", token)) as { login?: string } | null;
      login = user?.login ?? null;
    }
    if (!login) return null;

    // One-day buffer: `merged:>=` compares in UTC, local midnight may precede it.
    const prev = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const q = encodeURIComponent(`is:pr is:merged author:${login} merged:>=${dateSlug(prev)}`);
    // Up to two pages (200 PRs) so a heavy multi-agent day isn't silently
    // truncated at the API's 100-per-page cap.
    const results: SearchItem[] = [];
    for (let page = 1; page <= 2; page++) {
      const data = (await ghJson(`/search/issues?q=${q}&per_page=100&page=${page}`, token)) as {
        items?: SearchItem[];
      } | null;
      const batch = data?.items ?? [];
      results.push(...batch);
      if (batch.length < 100) break;
    }

    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const items: MergedPr[] = results
      .flatMap((item) => {
        const mergedAt = item.pull_request?.merged_at;
        if (!mergedAt || typeof item.number !== "number" || !item.html_url) return [];
        const mergedMs = new Date(mergedAt).getTime();
        if (Number.isNaN(mergedMs) || mergedMs < dayStart || mergedMs >= dayStart + 24 * 60 * 60 * 1000) {
          return [];
        }
        const repo = item.repository_url?.replace(/^.*\/repos\//, "") ?? "";
        if (!repo) return [];
        return [
          {
            repo,
            number: item.number,
            title: item.title ?? `${repo}#${item.number}`,
            url: item.html_url,
            mergedAt,
          },
        ];
      })
      .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));

    cache = { at: Date.now(), day, items };
    return items;
  } catch {
    // Serve a stale same-day cache over nothing; otherwise degrade to absent.
    if (cache && cache.day === day) return cache.items;
    return null;
  }
}
