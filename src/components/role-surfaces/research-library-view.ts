/**
 * Library search, sort and paging.
 *
 * The handoff's Library toolbar gains a search box, a sort control and a pager
 * on top of the existing filter chips. All three are pure list transforms, so
 * they live here and the tab stays a view.
 *
 * Sorts are total orders: every comparator falls back to the newest-first
 * stamp and then the artifact key, because a comparator that returns 0 for
 * distinct rows lets the browser's sort reshuffle them between renders — a
 * list that reorders while you read it.
 */

import type { ResearchArtifactRef, ResearchMission } from "@/lib/research-missions";

export type LibrarySort = "newest" | "oldest" | "title" | "state";

export const LIBRARY_SORTS: ReadonlyArray<{ id: LibrarySort; label: string }> = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "title", label: "Title A–Z" },
  { id: "state", label: "By state" },
];

/** How many artifacts a page holds, per layout. Rows are denser than cards. */
export const LIBRARY_PAGE_SIZE: Record<"cards" | "rows", number> = {
  cards: 9,
  rows: 12,
};

type Entry = {
  artifact: ResearchArtifactRef;
  mission: ResearchMission;
};

/** Working drafts read before published ones — the shelf is a queue of what
 *  still needs a look, not an archive. */
const STATE_ORDER: Record<ResearchArtifactRef["state"], number> = {
  working: 0,
  published: 1,
  rejected: 2,
};

function stamp(entry: Entry): number {
  const parsed = Date.parse(entry.artifact.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Stable last resort so no two distinct rows ever compare equal. */
function tieBreak(a: Entry, b: Entry): number {
  const byStamp = stamp(b) - stamp(a);
  if (byStamp !== 0) return byStamp;
  return `${a.mission.id}:${a.artifact.key}`.localeCompare(`${b.mission.id}:${b.artifact.key}`);
}

/** Match an artifact by its own title, its run's title, or its path. */
export function matchesLibraryQuery(entry: Entry, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return `${entry.artifact.title} ${entry.mission.title} ${entry.artifact.relativePath}`
    .toLowerCase()
    .includes(trimmed);
}

export function sortLibraryEntries<T extends Entry>(entries: readonly T[], sort: LibrarySort): T[] {
  const next = [...entries];
  if (sort === "oldest") {
    next.sort((a, b) => stamp(a) - stamp(b) || tieBreak(a, b));
  } else if (sort === "title") {
    next.sort((a, b) => a.artifact.title.localeCompare(b.artifact.title) || tieBreak(a, b));
  } else if (sort === "state") {
    next.sort((a, b) => STATE_ORDER[a.artifact.state] - STATE_ORDER[b.artifact.state] || tieBreak(a, b));
  } else {
    next.sort(tieBreak);
  }
  return next;
}

export type LibraryPage<T> = {
  items: T[];
  /** 0-based, always inside 0..pageCount-1 even if `page` was stale. */
  page: number;
  pageCount: number;
  /** "Showing 1–9 of 24" — omitted when a single page holds everything. */
  summary: string;
  hasPrev: boolean;
  hasNext: boolean;
};

/**
 * Slice one page. `page` is clamped rather than trusted: filtering down to
 * fewer pages while parked on page 4 must show results, not a blank shelf.
 */
export function paginateLibrary<T>(entries: readonly T[], page: number, pageSize: number): LibraryPage<T> {
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * pageSize;
  const items = entries.slice(start, start + pageSize);
  return {
    items,
    page: safePage,
    pageCount,
    summary: entries.length === 0
      ? "Nothing to show"
      : `Showing ${start + 1}–${start + items.length} of ${entries.length}`,
    hasPrev: safePage > 0,
    hasNext: safePage < pageCount - 1,
  };
}
