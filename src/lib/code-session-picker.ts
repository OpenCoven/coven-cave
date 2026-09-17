/**
 * Session-picker model for the Coding Desk header (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame replaces the always-on session rail with a
 * header picker: one button carrying the current session, opening a filterable,
 * queue-grouped list. This module is the whole decision layer — filtering,
 * chip counts and the empty-state affordance on top of the shared queue — so
 * the popover itself stays presentational and the rules stay behaviourally
 * testable.
 *
 * Two rules the frame is explicit about and this encodes:
 *
 *  - the filter matches title, project AND branch, because a coding session is
 *    as often remembered by its branch as by its name;
 *  - an empty result is not a dead end. The frame's copy — "↵ starts a new
 *    session with that name" — means a miss offers to become a session, so
 *    `codeSessionPickerResult` reports the create affordance rather than
 *    leaving the caller to infer it from a zero-length array.
 */

import {
  codeSessionActivity,
  codeSessionBranch,
  type CodeSessionActivity,
} from "./code-surface.ts";
import type { CodeReviewQueue } from "./code-review-queue.ts";
import { gitHubRepoSlug } from "./github-repo-link.ts";
import type { SessionRow } from "./types.ts";

/** A queue bucket in the open picker: one shared rail group, in queue order. */
export type CodeSessionPickerGroup = {
  /** Shared queue-group key (canonical repo in reviewable mode, root in all). */
  key: string;
  /** Short display label from the precomputed queue. */
  label: string;
  sessions: SessionRow[];
};

/** A filter chip above the list: "All", then one per visible queue group. */
export type CodeSessionPickerChip = {
  id: string;
  label: string;
  count: number;
  /** null on the "All" chip — it clears the group filter rather than setting one. */
  key: string | null;
};

export type CodeSessionPickerResult = {
  groups: CodeSessionPickerGroup[];
  chips: CodeSessionPickerChip[];
  /** Total sessions after both filters. */
  count: number;
  /**
   * True when a non-empty query matched nothing. The caller offers to start a
   * session named after the query — the frame's Enter affordance. An empty
   * query that matches nothing is just an empty workspace, not a miss.
   */
  offersCreate: boolean;
};

function projectLabel(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(idx + 1) || trimmed || "(unknown)";
}

/**
 * Does this session match the typed filter? Title, local project basename,
 * canonical GitHub owner/repo slug and branch, case-insensitively. A blank
 * query matches everything.
 */
export function codeSessionMatchesQuery(row: SessionRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    row.title ?? "",
    row.id,
    row.project_root ? projectLabel(row.project_root) : "",
    gitHubRepoSlug(row.git?.repositoryUrl) ?? "",
    codeSessionBranch(row) ?? "",
  ];
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Everything the open picker renders, for one (query, queue-group) pair.
 *
 * Chips count against the QUERY-filtered set but ignore the group filter, so
 * the counts stay stable while you click between groups — a chip whose count
 * changed because you selected it would read as the filter having deleted work.
 */
export function codeSessionPickerResult(
  queue: Pick<CodeReviewQueue, "groups" | "sessions">,
  query: string,
  groupKey: string | null,
): CodeSessionPickerResult {
  const visible = queue.sessions.filter((row) => codeSessionMatchesQuery(row, query));
  const visibleIds = new Set(visible.map((row) => row.id));

  const chips: CodeSessionPickerChip[] = [
    { id: "all", label: "All", count: visible.length, key: null },
  ];
  const groups: CodeSessionPickerGroup[] = [];
  for (const group of queue.groups) {
    const sessions = group.sessions.filter((row) => visibleIds.has(row.id));
    if (sessions.length === 0) continue;
    chips.push({
      id: group.key ? `group:${group.key}` : `group:${group.label}`,
      label: group.label,
      count: sessions.length,
      key: group.key,
    });
    if (groupKey === null || groupKey === group.key) {
      groups.push({ key: group.key, label: group.label, sessions });
    }
  }

  const count = groups.reduce((total, group) => total + group.sessions.length, 0);
  return { groups, chips, count, offersCreate: count === 0 && query.trim().length > 0 };
}

/** Short state word under a picker row — the frame's `running` / `failed` / `idle`. */
export function codeSessionStateWord(row: SessionRow): CodeSessionActivity {
  return codeSessionActivity(row);
}
