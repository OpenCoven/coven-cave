// Server-only: PRs the user merged today, for the daily report's
// day-in-review section. Same auth posture as /api/github/activity — the PAT
// is read from env/vault, never echoed, never logged, and only ever sent to
// api.github.com. Returns null (section absent, never an error) when neither
// a PAT nor GITHUB_USERNAME is configured.

import { resolveSecret } from "@/lib/vault";
import type { MergedPr } from "@/lib/daily-report-facts";

const GH = "https://api.github.com";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60_000;

type Cache = { atMs: number; daySlug: string; items: MergedPr[] } | null;
let cache: Cache = null;

function slug(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function ghJson(path: string, token: string | null): Promise<unknown> {
  const res = await fetch(`${GH}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return res.json();
}

type SearchItem = {
  number?: number;
  title?: string;
  html_url?: string;
  repository_url?: string;
  pull_request?: { merged_at?: string | null };
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/**
 * PRs authored by the configured user and merged during the local `now` day.
 * The search qualifier is UTC, so it queries from the previous day and
 * filters `merged_at` against the local day boundary. Failures fall back to
 * the same-day cache, then to null — the report simply omits the section.
 */
export async function fetchMergedPrsForDay(now: Date): Promise<MergedPr[] | null> {
  const daySlug = slug(now);
  if (cache && cache.daySlug === daySlug && Date.now() - cache.atMs < CACHE_TTL_MS) {
    return cache.items;
  }

  const token = resolveSecret("GITHUB_PAT") ?? null;
  let login = resolveSecret("GITHUB_USERNAME") ?? null;
  if (token) {
    try {
      const user = (await ghJson("/user", token)) as { login?: string } | null;
      login = user?.login ?? login;
    } catch {
      // Invalid PAT — the public path below still works when a username is set.
    }
  }
  if (!login) return null;

  // One-day UTC buffer: local "today" can start up to a day earlier in UTC.
  const from = new Date(startOfLocalDay(now).getTime() - 24 * 60 * 60 * 1000);
  const fromSlug = `${from.getUTCFullYear()}-${`${from.getUTCMonth() + 1}`.padStart(2, "0")}-${`${from.getUTCDate()}`.padStart(2, "0")}`;
  const q = encodeURIComponent(`is:pr is:merged author:${login} merged:>=${fromSlug}`);

  try {
    // Up to two 100-item pages: a heavy multi-agent day really does exceed a
    // single page (101 merges observed live on 2026-07-06), and a truncated
    // list would report a dishonest "N PRs merged" count.
    const results: SearchItem[] = [];
    for (let page = 1; page <= 2; page++) {
      const data = (await ghJson(
        `/search/issues?q=${q}&per_page=100&page=${page}&sort=updated&order=desc`,
        token,
      )) as { items?: SearchItem[] } | null;
      const batch = data?.items ?? [];
      results.push(...batch);
      if (batch.length < 100) break;
    }
    const dayStart = startOfLocalDay(now).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const items: MergedPr[] = [];
    for (const item of results) {
      const mergedAt = item.pull_request?.merged_at;
      if (!mergedAt || typeof item.number !== "number" || !item.html_url) continue;
      const mergedMs = new Date(mergedAt).getTime();
      if (Number.isNaN(mergedMs) || mergedMs < dayStart || mergedMs >= dayEnd) continue;
      const repo = (item.repository_url ?? "").replace(/^.*\/repos\//, "");
      if (!repo) continue;
      items.push({
        repo,
        number: item.number,
        title: item.title ?? `#${item.number}`,
        url: item.html_url,
        mergedAt,
      });
    }
    items.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
    cache = { atMs: Date.now(), daySlug, items };
    return items;
  } catch {
    // Rate-limited or offline: reuse anything we fetched for this day.
    if (cache && cache.daySlug === daySlug) return cache.items;
    return null;
  }
}
