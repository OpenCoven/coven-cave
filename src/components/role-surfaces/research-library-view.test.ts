import assert from "node:assert/strict";
import test from "node:test";

import {
  LIBRARY_PAGE_SIZE,
  LIBRARY_SORTS,
  matchesLibraryQuery,
  paginateLibrary,
  sortLibraryEntries,
} from "./research-library-view";
import type { ResearchArtifactRef, ResearchMission } from "@/lib/research-missions";

type Entry = { artifact: ResearchArtifactRef; mission: ResearchMission };

function entry(
  key: string,
  patch: Partial<ResearchArtifactRef> = {},
  missionTitle = "Loops",
): Entry {
  return {
    artifact: {
      key,
      kind: "brief",
      title: key.toUpperCase(),
      relativePath: `${key}.md`,
      iteration: 1,
      state: "working",
      updatedAt: "2026-08-01T00:00:00.000Z",
      ...patch,
    },
    mission: { id: "m1", title: missionTitle } as ResearchMission,
  };
}

test("search covers the artifact, its run and its path", () => {
  const row = entry("a", { title: "Findings" }, "Optimizing loops");
  assert.equal(matchesLibraryQuery(row, "findings"), true, "artifact title");
  assert.equal(matchesLibraryQuery(row, "optimizing"), true, "run title");
  assert.equal(matchesLibraryQuery(row, "a.md"), true, "path");
  assert.equal(matchesLibraryQuery(row, "nothing"), false);
});

test("an empty or whitespace query matches everything", () => {
  const row = entry("a");
  assert.equal(matchesLibraryQuery(row, ""), true);
  assert.equal(matchesLibraryQuery(row, "   "), true);
});

test("every sort is a total order — no two distinct rows compare equal", () => {
  // Same stamp, same title, same state: only the tie-break can separate them.
  const rows = [entry("b"), entry("a"), entry("c")];
  for (const { id } of LIBRARY_SORTS) {
    const once = sortLibraryEntries(rows, id).map((row) => row.artifact.key);
    const twice = sortLibraryEntries(sortLibraryEntries(rows, id), id)
      .map((row) => row.artifact.key);
    assert.deepEqual(twice, once, `${id} is stable under re-sorting`);
  }
});

test("sorting never mutates the input", () => {
  const rows = [entry("b"), entry("a")];
  const before = rows.map((row) => row.artifact.key);
  sortLibraryEntries(rows, "title");
  assert.deepEqual(rows.map((row) => row.artifact.key), before);
});

test("newest and oldest are exact mirrors", () => {
  const rows = [
    entry("a", { updatedAt: "2026-08-01T00:00:00.000Z" }),
    entry("b", { updatedAt: "2026-08-03T00:00:00.000Z" }),
    entry("c", { updatedAt: "2026-08-02T00:00:00.000Z" }),
  ];
  assert.deepEqual(sortLibraryEntries(rows, "newest").map((r) => r.artifact.key), ["b", "c", "a"]);
  assert.deepEqual(sortLibraryEntries(rows, "oldest").map((r) => r.artifact.key), ["a", "c", "b"]);
});

test("by state puts what still needs a look first", () => {
  const rows = [
    entry("pub", { state: "published" }),
    entry("rej", { state: "rejected" }),
    entry("work", { state: "working" }),
  ];
  assert.deepEqual(
    sortLibraryEntries(rows, "state").map((row) => row.artifact.key),
    ["work", "pub", "rej"],
  );
});

test("an unparseable timestamp sorts as oldest rather than throwing", () => {
  const rows = [entry("bad", { updatedAt: "not a date" }), entry("good")];
  assert.deepEqual(sortLibraryEntries(rows, "newest").map((r) => r.artifact.key), ["good", "bad"]);
});

test("paging clamps a stale page instead of showing a blank shelf", () => {
  const rows = Array.from({ length: 4 }, (_, index) => entry(`a${index}`));
  const page = paginateLibrary(rows, 9, 3);
  assert.equal(page.page, 1, "clamped to the last page");
  assert.equal(page.items.length, 1);
  assert.equal(page.hasNext, false);
  assert.equal(page.hasPrev, true);
});

test("paging never yields a negative page", () => {
  const page = paginateLibrary([entry("a")], -5, 3);
  assert.equal(page.page, 0);
  assert.equal(page.hasPrev, false);
});

test("the page summary counts what is actually on screen", () => {
  const rows = Array.from({ length: 10 }, (_, index) => entry(`a${index}`));
  assert.equal(paginateLibrary(rows, 0, 4).summary, "Showing 1–4 of 10");
  assert.equal(paginateLibrary(rows, 2, 4).summary, "Showing 9–10 of 10");
});

test("an empty shelf is one page that says so", () => {
  const page = paginateLibrary([], 0, 9);
  assert.equal(page.pageCount, 1);
  assert.equal(page.summary, "Nothing to show");
  assert.equal(page.hasPrev, false);
  assert.equal(page.hasNext, false);
});

test("rows fit more per page than cards", () => {
  assert.ok(LIBRARY_PAGE_SIZE.rows > LIBRARY_PAGE_SIZE.cards);
});
