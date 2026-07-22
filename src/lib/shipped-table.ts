// Pure helpers for the shipped-table UI: filtering, sorting, and the
// three-state sort-cycle. Lives in src/lib/ (not src/components/) so the
// node --experimental-strip-types test runner can import it without
// React/JSX transforms.

import type { MergedPr } from "./daily-report-facts.ts";

export type ShippedSortKey = "pr" | "repo" | "merged";
export type ShippedSortDir = "asc" | "desc";
export type ShippedSort = { key: ShippedSortKey; dir: ShippedSortDir } | null;

/**
 * Filter rows by a free-text query.
 * - Empty / whitespace → returns all rows.
 * - `#NNN` prefix → matches only against the PR number field.
 * - Bare query → case-insensitive substring match against title, full repo,
 *   short repo (part after the last "/"), and PR number.
 */
export function filterShippedRows(rows: readonly MergedPr[], query: string): MergedPr[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows.slice();

  const isHashQuery = q.startsWith("#");
  const digits = isHashQuery ? q.slice(1) : q;

  return rows.filter((row) => {
    if (isHashQuery) {
      // # prefix: match only PR number
      return String(row.number).includes(digits);
    }
    if (row.title.toLowerCase().includes(q)) return true;
    if (row.repo.toLowerCase().includes(q)) return true;
    const shortRepo = row.repo.slice(row.repo.lastIndexOf("/") + 1).toLowerCase();
    if (shortRepo.includes(q)) return true;
    if (String(row.number).includes(q)) return true;
    return false;
  });
}

/**
 * Sort rows without mutating the input.
 * - `null` → newest mergedAt first; invalid timestamps always last; stable.
 * - `{key:"pr"}` → title localeCompare in dir; stable tie-break by index.
 * - `{key:"repo"}` → full repo localeCompare, then number asc as secondary;
 *   `dir:"desc"` reverses both parts.
 * - `{key:"merged"}` → timestamp in dir; invalid timestamps always last
 *   regardless of dir; stable tie-break by index.
 */
export function sortShippedRows(rows: readonly MergedPr[], sort: ShippedSort): MergedPr[] {
  // Attach original index for stable tie-breaking; never touches input order.
  const indexed = rows.map((row, i) => ({ row, i }));

  if (sort === null) {
    indexed.sort((a, b) => {
      const ta = Date.parse(a.row.mergedAt);
      const tb = Date.parse(b.row.mergedAt);
      const aOk = !isNaN(ta);
      const bOk = !isNaN(tb);
      if (!aOk && !bOk) return a.i - b.i;
      if (!aOk) return 1;
      if (!bOk) return -1;
      if (tb !== ta) return tb - ta; // newest first
      return a.i - b.i;
    });
    return indexed.map(({ row }) => row);
  }

  const { key, dir } = sort;
  const sign = dir === "asc" ? 1 : -1;

  indexed.sort((a, b) => {
    let cmp = 0;
    if (key === "pr") {
      cmp = a.row.title.localeCompare(b.row.title);
    } else if (key === "repo") {
      cmp = a.row.repo.localeCompare(b.row.repo);
      if (cmp === 0) cmp = a.row.number - b.row.number;
    } else {
      // key === "merged"
      const ta = Date.parse(a.row.mergedAt);
      const tb = Date.parse(b.row.mergedAt);
      const aOk = !isNaN(ta);
      const bOk = !isNaN(tb);
      // Invalid timestamps always sort last regardless of dir — return early.
      if (!aOk && !bOk) return a.i - b.i;
      if (!aOk) return 1;
      if (!bOk) return -1;
      cmp = ta - tb; // asc = oldest first; sign applied below
    }
    if (cmp !== 0) return sign * cmp;
    return a.i - b.i;
  });

  return indexed.map(({ row }) => row);
}

/**
 * Advance the sort cycle for a column header click.
 * - First click on a column: `merged` starts `"desc"`, `pr`/`repo` start `"asc"`.
 * - Second click (same column): flip direction.
 * - Third click (same column): reset to `null` (default order).
 * - Click on a different column: jump to that column's first state.
 */
export function nextShippedSort(current: ShippedSort, key: ShippedSortKey): ShippedSort {
  const firstDir = (k: ShippedSortKey): ShippedSortDir =>
    k === "merged" ? "desc" : "asc";

  if (current === null || current.key !== key) {
    return { key, dir: firstDir(key) };
  }

  const first = firstDir(key);
  if (current.dir === first) {
    return { key, dir: first === "asc" ? "desc" : "asc" };
  }
  return null;
}
