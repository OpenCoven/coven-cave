import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNavRows,
  dirRowId,
  fileRowId,
  filterFiles,
  navigableFiles,
  navigableTargets,
  nextNavPath,
  noPatchCopy,
  ROOT_GROUP,
  STATUS_GLYPH,
  type NavRow,
} from "./review-file-tree.ts";
import type { ReviewFile } from "./use-review-source.ts";

function file(path: string, overrides: Partial<ReviewFile> = {}): ReviewFile {
  return { path, status: "modified", additions: 1, deletions: 0, patch: null, noPatchReason: null, ...overrides };
}

function paths(rows: readonly NavRow[]) {
  return rows.map((row) => `${row.kind}:${row.path}`);
}

// ── Grouping ─────────────────────────────────────────────────────────────────

test("flat mode groups files under one directory header per directory", () => {
  const rows = buildNavRows([file("src/a.ts"), file("src/b.ts"), file("docs/c.md")], { mode: "flat" });
  assert.deepEqual(paths(rows), [
    "group:src",
    "file:src/a.ts",
    "file:src/b.ts",
    "group:docs",
    "file:docs/c.md",
  ]);
});

test("a repo-root file gets a named group rather than an empty header", () => {
  const rows = buildNavRows([file("README.md")], { mode: "flat" });
  assert.deepEqual(paths(rows), [`group:${ROOT_GROUP}`, "file:README.md"]);
  assert.equal(rows[0].kind === "group" && rows[0].label, ROOT_GROUP);
});

test("tree mode nests directories and lists each level's files after its subdirectories", () => {
  const rows = buildNavRows([file("src/app/page.tsx"), file("src/lib/x.ts"), file("src/top.ts")], { mode: "tree" });
  assert.deepEqual(paths(rows), [
    "dir:src",
    "dir:src/app",
    "file:src/app/page.tsx",
    "dir:src/lib",
    "file:src/lib/x.ts",
    "file:src/top.ts",
  ]);
  const nested = rows.find((row) => row.path === "src/app")!;
  assert.equal(nested.kind, "dir");
  assert.equal(nested.kind === "dir" && nested.level, 1);
  assert.equal(
    nested.kind === "dir" && nested.label,
    "app",
    "a directory row is labelled by its own segment, not its full path",
  );
});

test("a fresh navigator shows the whole change; only closed directories hide their contents", () => {
  const files = [file("src/app/page.tsx"), file("src/lib/x.ts")];
  assert.equal(navigableFiles(buildNavRows(files, { mode: "tree" })).length, 2);

  const collapsed = buildNavRows(files, { mode: "tree", collapsedDirs: new Set(["src/app"]) });
  assert.deepEqual(paths(collapsed), ["dir:src", "dir:src/app", "dir:src/lib", "file:src/lib/x.ts"]);
  const closed = collapsed.find((row) => row.path === "src/app")!;
  assert.equal(closed.kind === "dir" && closed.collapsed, true);

  // Closing a parent hides every descendant, not just its own files.
  const root = buildNavRows(files, { mode: "tree", collapsedDirs: new Set(["src"]) });
  assert.deepEqual(paths(root), ["dir:src"]);
  assert.deepEqual(navigableFiles(root), []);
});

// ── Duplicate basenames — the case the old tab strip lost ────────────────────

test("files sharing a basename are told apart by their full parent path", () => {
  const rows = buildNavRows([file("src/app/route.ts"), file("src/api/route.ts"), file("src/only.ts")], {
    mode: "tree",
  });
  const files = rows.filter((row): row is Extract<NavRow, { kind: "file" }> => row.kind === "file");
  const dupes = files.filter((row) => row.duplicate);
  assert.deepEqual(
    dupes.map((row) => row.path),
    ["src/app/route.ts", "src/api/route.ts"],
  );
  assert.equal(files.find((row) => row.path === "src/only.ts")!.duplicate, false);
  // Every row keeps a distinct id, so nothing collapses onto anything else.
  assert.equal(new Set(files.map((row) => row.id)).size, files.length);
  assert.equal(files[0].id, fileRowId("src/app/route.ts"));
});

test("the flat group header already names the directory, so file rows do not repeat it", () => {
  const rows = buildNavRows([file("src/app/route.ts"), file("src/api/route.ts")], { mode: "flat" });
  for (const row of rows) if (row.kind === "file") assert.equal(row.parent, "");
});

// ── Filtering ────────────────────────────────────────────────────────────────

test("the filter is a case-insensitive substring match on the whole path", () => {
  const files = [file("src/App/Page.tsx"), file("src/lib/util.ts"), file("docs/page.md")];
  assert.deepEqual(
    filterFiles(files, "PAGE").map((f) => f.path),
    ["src/App/Page.tsx", "docs/page.md"],
  );
  assert.deepEqual(
    filterFiles(files, "src/lib").map((f) => f.path),
    ["src/lib/util.ts"],
  );
  assert.deepEqual(filterFiles(files, "nothing-matches"), []);
});

test("an empty or blank filter returns a copy of every file, not the original array", () => {
  const files = [file("a.ts")];
  for (const query of ["", "   "]) {
    const out = filterFiles(files, query);
    assert.deepEqual(
      out.map((f) => f.path),
      ["a.ts"],
    );
    assert.notEqual(out, files);
  }
});

// ── Roving focus ─────────────────────────────────────────────────────────────

test("only file rows can be opened — headers and directories are not files", () => {
  const rows = buildNavRows([file("src/a.ts"), file("docs/b.md")], { mode: "flat" });
  assert.deepEqual(navigableFiles(rows), ["src/a.ts", "docs/b.md"]);
});

test("the cursor can reach directories, so they are not mouse-only", () => {
  const rows = buildNavRows([file("src/app/page.tsx"), file("src/top.ts")], { mode: "tree" });
  assert.deepEqual(navigableTargets(rows), [
    { path: "src", kind: "dir" },
    { path: "src/app", kind: "dir" },
    { path: "src/app/page.tsx", kind: "file" },
    { path: "src/top.ts", kind: "file" },
  ]);
  // A collapsed directory stays reachable — otherwise nothing could reopen it.
  const collapsed = buildNavRows([file("src/app/page.tsx")], {
    mode: "tree",
    collapsedDirs: new Set(["src"]),
  });
  assert.deepEqual(navigableTargets(collapsed), [{ path: "src", kind: "dir" }]);
});

test("group headers are labels, never cursor targets", () => {
  const rows = buildNavRows([file("src/a.ts")], { mode: "flat" });
  assert.ok(rows.some((row) => row.kind === "group"));
  assert.deepEqual(navigableTargets(rows), [{ path: "src/a.ts", kind: "file" }]);
});

test("movement runs over directories and files alike", () => {
  const rows = buildNavRows([file("src/app/page.tsx"), file("src/top.ts")], { mode: "tree" });
  const paths = navigableTargets(rows).map((target) => target.path);
  assert.equal(nextNavPath(paths, "src", "j"), "src/app");
  assert.equal(nextNavPath(paths, "src/app", "j"), "src/app/page.tsx");
  assert.equal(nextNavPath(paths, "src/app", "k"), "src");
});

test("row ids are stable and distinct per kind", () => {
  assert.equal(dirRowId("src/app"), "rd-dir-src/app");
  assert.equal(fileRowId("src/app"), "rd-file-src/app");
  assert.notEqual(dirRowId("x"), fileRowId("x"));
});

test("j/k mirror the arrows and the ends clamp instead of wrapping", () => {
  const list = ["a", "b", "c"];
  assert.equal(nextNavPath(list, "a", "j"), "b");
  assert.equal(nextNavPath(list, "a", "ArrowDown"), "b");
  assert.equal(nextNavPath(list, "b", "k"), "a");
  assert.equal(nextNavPath(list, "b", "ArrowUp"), "a");
  assert.equal(nextNavPath(list, "c", "j"), "c", "the last row does not wrap to the first");
  assert.equal(nextNavPath(list, "a", "k"), "a", "the first row does not wrap to the last");
  assert.equal(nextNavPath(list, "b", "Home"), "a");
  assert.equal(nextNavPath(list, "b", "End"), "c");
  assert.equal(nextNavPath(list, "b", "Enter"), "b");
  assert.equal(nextNavPath(list, "b", " "), "b");
});

test("a key that is not a movement moves nothing, and an empty list has nowhere to go", () => {
  assert.equal(nextNavPath(["a", "b"], "a", "x"), null);
  assert.equal(nextNavPath(["a", "b"], "a", "Tab"), null);
  assert.equal(nextNavPath([], null, "j"), null);
});

test("navigation from no selection, or from a path the filter removed, starts at the top", () => {
  assert.equal(nextNavPath(["a", "b"], null, "j"), "b");
  assert.equal(nextNavPath(["a", "b"], null, "k"), "a");
  assert.equal(nextNavPath(["a", "b"], "gone.ts", "j"), "b");
  assert.equal(nextNavPath(["a", "b"], "gone.ts", "Enter"), "a");
});

// ── Copy ─────────────────────────────────────────────────────────────────────

test("every file status has a glyph", () => {
  assert.deepEqual(Object.keys(STATUS_GLYPH).sort(), ["added", "deleted", "modified", "renamed", "untracked"]);
  assert.equal(STATUS_GLYPH.modified, "M");
  assert.equal(STATUS_GLYPH.untracked, "U");
});

test("a file with no patch says why, and a normal file says nothing", () => {
  assert.equal(noPatchCopy(null), null);
  assert.match(noPatchCopy("github")!.title, /No text diff from GitHub/);
  assert.match(noPatchCopy("github")!.hint, /binary files/);
  assert.match(noPatchCopy("budget")!.title, /Patch not included/);
  assert.match(noPatchCopy("budget")!.hint, /rather than showing a partial diff as complete/);
});
