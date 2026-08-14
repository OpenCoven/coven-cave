/**
 * Session-picker model for the Coding Desk header (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame replaces the always-on session rail with a
 * header picker: one button carrying the current session, opening a filterable,
 * project-grouped list. This module is the whole decision layer — filtering,
 * chip counts, grouping and the empty-state affordance — so the popover itself
 * stays presentational and the rules stay behaviourally testable.
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
  isCodeRailSession,
  type CodeSessionActivity,
} from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

/** A project bucket in the open picker: one repo root, newest session first. */
export type CodeSessionPickerGroup = {
  /** Absolute project root shared by the group's sessions. */
  root: string;
  /** Short display label (basename of the root). */
  label: string;
  sessions: SessionRow[];
};

/** A filter chip above the list: "all", then one per project in the result. */
export type CodeSessionPickerChip = {
  id: string;
  label: string;
  count: number;
  /** null on the "All" chip — it clears the project filter rather than setting one. */
  root: string | null;
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

function updatedAt(row: SessionRow): number {
  const t = Date.parse(row.updated_at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Does this session match the typed filter? Title, project label and branch,
 * case-insensitively. A blank query matches everything.
 */
export function codeSessionMatchesQuery(row: SessionRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    row.title ?? "",
    row.id,
    row.project_root ? projectLabel(row.project_root) : "",
    codeSessionBranch(row) ?? "",
  ];
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Everything the open picker renders, for one (query, project) pair.
 *
 * Chips count against the QUERY-filtered set but ignore the project filter, so
 * the counts stay stable while you click between projects — a chip whose count
 * changed because you selected it would read as the filter having deleted work.
 */
export function codeSessionPickerResult(
  rows: readonly SessionRow[],
  query: string,
  projectRoot: string | null,
): CodeSessionPickerResult {
  const visible = rows.filter((row) => isCodeRailSession(row) && codeSessionMatchesQuery(row, query));

  const byRoot = new Map<string, SessionRow[]>();
  for (const row of visible) {
    const root = row.project_root || "";
    const list = byRoot.get(root);
    if (list) list.push(row);
    else byRoot.set(root, [row]);
  }

  const chips: CodeSessionPickerChip[] = [
    { id: "all", label: "All", count: visible.length, root: null },
  ];
  const groups: CodeSessionPickerGroup[] = [];
  for (const [root, sessions] of byRoot) {
    sessions.sort((a, b) => updatedAt(b) - updatedAt(a));
    const label = root ? projectLabel(root) : "(unknown)";
    chips.push({ id: root || "unknown", label, count: sessions.length, root });
    if (projectRoot === null || projectRoot === root) {
      groups.push({ root, label, sessions });
    }
  }

  groups.sort((a, b) => {
    if (!a.root && b.root) return 1;
    if (a.root && !b.root) return -1;
    return updatedAt(b.sessions[0]) - updatedAt(a.sessions[0]);
  });
  chips.sort((a, b) => (a.root === null ? -1 : b.root === null ? 1 : b.count - a.count));

  const count = groups.reduce((total, group) => total + group.sessions.length, 0);
  return { groups, chips, count, offersCreate: count === 0 && query.trim().length > 0 };
}

/** Short state word under a picker row — the frame's `running` / `failed` / `idle`. */
export function codeSessionStateWord(row: SessionRow): CodeSessionActivity {
  return codeSessionActivity(row);
}
