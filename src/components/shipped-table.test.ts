// @ts-nocheck
import assert from "node:assert/strict";
// Tests for shipped-table pure helpers: filterShippedRows, sortShippedRows,
// nextShippedSort. Logic lives in src/lib/ so node --experimental-strip-types
// can import it directly without JSX/React transforms.
import {
  filterShippedRows,
  sortShippedRows,
  nextShippedSort,
} from "../lib/shipped-table.ts";

// ── Fixture ───────────────────────────────────────────────────────────────────

const ROWS = [
  {
    repo: "OpenCoven/coven-cave",
    number: 123,
    title: "Add dark mode support",
    url: "https://github.com/OpenCoven/coven-cave/pull/123",
    mergedAt: "2024-03-15T10:00:00Z",
  },
  {
    repo: "acme/tools",
    number: 456,
    title: "Fix build pipeline",
    url: "https://github.com/acme/tools/pull/456",
    mergedAt: "2024-03-16T08:30:00Z",
  },
  {
    repo: "acme/tools",
    number: 789,
    title: "Add dark mode support", // duplicate title — stability check
    url: "https://github.com/acme/tools/pull/789",
    mergedAt: "2024-03-14T12:00:00Z",
  },
  {
    repo: "OpenCoven/coven-cave",
    number: 99,
    title: "Refactor auth module",
    url: "https://github.com/OpenCoven/coven-cave/pull/99",
    mergedAt: "2024-03-17T15:45:00Z",
  },
  {
    repo: "acme/tools",
    number: 321,
    title: "Update dependencies",
    url: "https://github.com/acme/tools/pull/321",
    mergedAt: "not-a-date", // invalid timestamp
  },
];

// ── Filtering ─────────────────────────────────────────────────────────────────

// Empty / whitespace → all rows returned
assert.deepEqual(filterShippedRows(ROWS, ""), ROWS, "empty query returns all");
assert.deepEqual(filterShippedRows(ROWS, "   "), ROWS, "whitespace-only returns all");

// Title substring (case-insensitive)
{
  const res = filterShippedRows(ROWS, "dark MODE");
  assert.equal(res.length, 2, "case-insensitive title match");
  assert.ok(res.every((r) => r.title.toLowerCase().includes("dark mode")));
}

// Full repo match
{
  const res = filterShippedRows(ROWS, "OpenCoven/coven-cave");
  assert.equal(res.length, 2, "full repo match");
  assert.ok(res.every((r) => r.repo === "OpenCoven/coven-cave"));
}

// Short repo (after last "/")
{
  const res = filterShippedRows(ROWS, "coven-cave");
  assert.equal(res.length, 2, "short repo match");
  assert.ok(res.every((r) => r.repo === "OpenCoven/coven-cave"));
}

// Bare number — matches number field substring
{
  const res = filterShippedRows(ROWS, "123");
  assert.ok(res.length >= 1, "bare number matches PR number");
  assert.ok(res.some((r) => r.number === 123));
  // bare query also matches title / repo containing "123"
}

// #-prefixed query — matches ONLY number, NOT title
{
  const titleWithDigits = {
    repo: "acme/tools",
    number: 999,
    title: "456 items cleaned up", // contains "456" as text
    url: "https://github.com/acme/tools/pull/999",
    mergedAt: "2024-03-18T00:00:00Z",
  };
  const rows = [...ROWS, titleWithDigits];
  const res = filterShippedRows(rows, "#456");
  assert.equal(res.length, 1, "#-query matches only PR number field");
  assert.equal(res[0].number, 456, "#456 finds number=456, not the title row");
}

// #-prefixed with leading hash stripped — same as bare number for number match
{
  const res = filterShippedRows(ROWS, "#789");
  assert.equal(res.length, 1);
  assert.equal(res[0].number, 789);
}

// No match
{
  const res = filterShippedRows(ROWS, "zzznomatch");
  assert.deepEqual(res, [], "no match returns empty array");
}

// ── Sorting ───────────────────────────────────────────────────────────────────

// Default sort (null) = newest mergedAt first; invalid date LAST
{
  const sorted = sortShippedRows(ROWS, null);
  assert.equal(sorted[0].number, 99, "newest first (2024-03-17)");
  assert.equal(sorted[1].number, 456, "second newest (2024-03-16)");
  assert.equal(sorted[sorted.length - 1].number, 321, "invalid date last");
}

// Input array not mutated
{
  const snapshot = ROWS.map((r) => ({ ...r }));
  sortShippedRows(ROWS, null);
  assert.deepEqual(ROWS, snapshot, "input array not mutated");
}

// Stable tie-break: two rows with same mergedAt keep input order
{
  const tieRows = [
    { repo: "a/b", number: 1, title: "A", url: "", mergedAt: "2024-01-01T00:00:00Z" },
    { repo: "a/b", number: 2, title: "B", url: "", mergedAt: "2024-01-01T00:00:00Z" },
  ];
  const sorted = sortShippedRows(tieRows, null);
  assert.equal(sorted[0].number, 1, "same timestamp: original index wins");
  assert.equal(sorted[1].number, 2);
}

// pr asc — title localeCompare ascending; stable tie-break preserves input order
{
  const sorted = sortShippedRows(ROWS, { key: "pr", dir: "asc" });
  const titles = sorted.map((r) => r.title);
  const expected = [...titles].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(titles, expected, "pr asc sorts by title ascending");
  // Two rows share title "Add dark mode support" (number 123 and 789).
  // Stable tie-break must preserve their original input order (123 < 789).
  const darkModeRows = sorted.filter((r) => r.title === "Add dark mode support");
  assert.equal(darkModeRows[0].number, 123, "pr sort: duplicate-title rows keep input order (first)");
  assert.equal(darkModeRows[1].number, 789, "pr sort: duplicate-title rows keep input order (second)");
}

// pr desc — title localeCompare descending
{
  const sorted = sortShippedRows(ROWS, { key: "pr", dir: "desc" });
  const titles = sorted.map((r) => r.title);
  const expected = [...titles].sort((a, b) => b.localeCompare(a));
  assert.deepEqual(titles, expected, "pr desc sorts by title descending");
}

// repo asc — groups by full repo (localeCompare asc), then number ascending within group
{
  const sorted = sortShippedRows(ROWS, { key: "repo", dir: "asc" });
  // Derive contiguous repo groups from the sorted output
  const groups: string[] = [];
  for (const r of sorted) {
    if (groups[groups.length - 1] !== r.repo) groups.push(r.repo);
  }
  assert.equal(groups.length, 2, "repo asc: exactly 2 contiguous repo groups");
  assert.ok(
    groups[0].localeCompare(groups[1]) < 0,
    "repo asc: first group sorts before second by localeCompare",
  );
  // within acme/tools group, numbers ascending
  const acmeRows = sorted.filter((r) => r.repo === "acme/tools");
  const nums = acmeRows.map((r) => r.number);
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), "secondary sort by number asc within repo");
}

// repo desc — reverses both repo and number order
{
  const sorted = sortShippedRows(ROWS, { key: "repo", dir: "desc" });
  const groups: string[] = [];
  for (const r of sorted) {
    if (groups[groups.length - 1] !== r.repo) groups.push(r.repo);
  }
  assert.equal(groups.length, 2, "repo desc: exactly 2 contiguous repo groups");
  assert.ok(
    groups[0].localeCompare(groups[1]) > 0,
    "repo desc: first group sorts after second (descending)",
  );
  const acmeRows = sorted.filter((r) => r.repo === "acme/tools");
  const nums = acmeRows.map((r) => r.number);
  assert.deepEqual(nums, [...nums].sort((a, b) => b - a), "secondary sort by number desc in desc mode");
}

// merged asc — oldest first; invalid STILL last
{
  const sorted = sortShippedRows(ROWS, { key: "merged", dir: "asc" });
  assert.equal(sorted[0].number, 789, "merged asc: oldest first (2024-03-14)");
  assert.equal(sorted[sorted.length - 1].number, 321, "invalid date always last even in asc");
}

// merged desc — same as default (newest first, invalid last)
{
  const sorted = sortShippedRows(ROWS, { key: "merged", dir: "desc" });
  assert.equal(sorted[0].number, 99, "merged desc: newest first");
  assert.equal(sorted[sorted.length - 1].number, 321, "invalid date always last");
}

// ── Sort cycle (nextShippedSort) ──────────────────────────────────────────────

// merged: null → desc → asc → null
assert.deepEqual(nextShippedSort(null, "merged"), { key: "merged", dir: "desc" }, "merged first activation is desc");
assert.deepEqual(nextShippedSort({ key: "merged", dir: "desc" }, "merged"), { key: "merged", dir: "asc" }, "merged second flip to asc");
assert.equal(nextShippedSort({ key: "merged", dir: "asc" }, "merged"), null, "merged third resets to null");

// pr: null → asc → desc → null
assert.deepEqual(nextShippedSort(null, "pr"), { key: "pr", dir: "asc" }, "pr first activation is asc");
assert.deepEqual(nextShippedSort({ key: "pr", dir: "asc" }, "pr"), { key: "pr", dir: "desc" }, "pr second flip to desc");
assert.equal(nextShippedSort({ key: "pr", dir: "desc" }, "pr"), null, "pr third resets to null");

// repo: null → asc → desc → null
assert.deepEqual(nextShippedSort(null, "repo"), { key: "repo", dir: "asc" }, "repo first activation is asc");
assert.deepEqual(nextShippedSort({ key: "repo", dir: "asc" }, "repo"), { key: "repo", dir: "desc" });
assert.equal(nextShippedSort({ key: "repo", dir: "desc" }, "repo"), null);

// Switching columns jumps to new key's first state
assert.deepEqual(nextShippedSort({ key: "pr", dir: "asc" }, "repo"), { key: "repo", dir: "asc" }, "switch col jumps to new key first state");
assert.deepEqual(nextShippedSort({ key: "merged", dir: "desc" }, "pr"), { key: "pr", dir: "asc" }, "switch to pr gives pr asc");

// ── Source pins (Task 2 — component, page, CSS) ───────────────────────────────

import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./shipped-table.tsx", import.meta.url), "utf8");
const page = readFileSync(
  new URL("../app/daily-report/[date]/page.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../styles/globals/surface-reporting.css", import.meta.url),
  "utf8",
);

// Component pins
assert.match(component, /"use client"/, 'component has "use client"');
assert.match(component, /role="status"/, "component has role=status on count");
assert.match(component, /aria-sort=/, "component has aria-sort on th");
assert.match(component, /scope="col"/, "component has scope=col on th");
assert.match(component, /nextShippedSort/, "component calls nextShippedSort");
assert.match(component, /rel="noreferrer"/, "component has rel=noreferrer on links");
assert.match(component, /tabIndex=\{0\}/, "component has tabIndex={0} on viewport");
assert.match(component, /No shipped work matches this filter\./, "component has empty state text");
assert.match(component, /relativeTime\(pr\.mergedAt, nowMs\)/, "component calls relativeTime with nowMs");

// Page pins
assert.match(page, /<ShippedTable/, "page contains <ShippedTable");
assert.match(page, /rows=\{report\.prsMerged\}/, "page passes rows={report.prsMerged}");
assert.doesNotMatch(
  page,
  /report\.prsMerged\.map/,
  "page no longer maps report.prsMerged into dr-row links",
);

// CSS pins
assert.match(css, /\.dr-shipped__viewport[\s\S]*?max-height:\s*300px/, "CSS viewport has max-height: 300px");
assert.match(css, /\.dr-shipped__viewport[\s\S]*?overflow:\s*auto/, "CSS viewport has overflow: auto");
assert.match(css, /\.dr-shipped__table\s+thead\s+th\s*\{[\s\S]*?position:\s*sticky/, "CSS thead th has position: sticky");

console.log("shipped-table.test.ts: ok");

