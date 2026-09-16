import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGithubRepoTree,
  type GithubRepoTreeEntry,
} from "./research-github-repo.ts";
import {
  collapseSingleChildChains,
  filterRepoFiles,
  flattenRepoTree,
  REPO_FILE_PREVIEW_BYTE_LIMIT,
  REPO_TREE_MAX_INDENT,
  repoAncestorPaths,
  repoBreadcrumb,
  repoFileIsPreviewable,
  repoFileKind,
  repoPathsToReveal,
  repoRowSizeLabel,
} from "./research-github-repo-browser.ts";

const SHA = "a".repeat(40);

function blob(path: string, size?: number): GithubRepoTreeEntry {
  return { path, type: "blob", sha: SHA, ...(size === undefined ? {} : { size }) };
}

test("collapseSingleChildChains joins a directory-only spine into one row", () => {
  const roots = buildGithubRepoTree([
    blob("vendor/build/src/chrome/browser/ui/mori/AgentThreadView.swift", 4_700),
    blob("vendor/build/src/chrome/browser/ui/mori/AIComposer.swift", 6_200),
  ]);
  const collapsed = collapseSingleChildChains(roots);
  assert.equal(collapsed.length, 1);
  // Seven levels of spine become one row carrying the joined path.
  assert.equal(collapsed[0].name, "vendor/build/src/chrome/browser/ui/mori");
  assert.equal(collapsed[0].path, "vendor/build/src/chrome/browser/ui/mori");
  assert.deepEqual(
    (collapsed[0].children ?? []).map((child) => child.name).sort(),
    ["AIComposer.swift", "AgentThreadView.swift"],
  );
});

test("collapseSingleChildChains stops at a branch and at a lone FILE", () => {
  const branching = collapseSingleChildChains(buildGithubRepoTree([
    blob("a/b/one.txt"),
    blob("a/c/two.txt"),
  ]));
  // `a` has two directory children, so it cannot absorb either of them.
  assert.deepEqual(branching.map((node) => node.name), ["a"]);
  assert.deepEqual((branching[0].children ?? []).map((node) => node.name), ["b", "c"]);

  // A directory whose only child is a FILE keeps its own row: the file is a
  // destination, and folding it away would break the breadcrumb.
  const loneFile = collapseSingleChildChains(buildGithubRepoTree([blob("docs/README.md")]));
  assert.deepEqual(loneFile.map((node) => node.name), ["docs"]);
  assert.deepEqual((loneFile[0].children ?? []).map((node) => node.name), ["README.md"]);
});

test("flattenRepoTree lists directories first and only descends into open ones", () => {
  const roots = collapseSingleChildChains(buildGithubRepoTree([
    blob("README.md", 5_200),
    blob("src/app.ts", 900),
    blob("src/util.ts", 120),
  ]));

  const closed = flattenRepoTree(roots, new Set());
  assert.deepEqual(closed.map((row) => row.node.name), ["src", "README.md"]);

  const open = flattenRepoTree(roots, new Set(["src"]));
  assert.deepEqual(open.map((row) => row.node.name), ["src", "app.ts", "util.ts", "README.md"]);
  assert.deepEqual(open.map((row) => row.depth), [0, 1, 1, 0]);
  assert.equal(open[0].expanded, true);
});

test("flattenRepoTree clamps the drawn indent but keeps the true depth", () => {
  // Each level branches so nothing collapses; depth therefore exceeds the clamp.
  const entries: GithubRepoTreeEntry[] = [];
  let prefix = "";
  for (let level = 0; level < 8; level++) {
    prefix = prefix ? `${prefix}/d${level}` : `d${level}`;
    entries.push(blob(`${prefix}/leaf${level}.txt`, 10));
  }
  const roots = collapseSingleChildChains(buildGithubRepoTree(entries));
  const expanded = new Set(entries.flatMap((entry) => repoAncestorPaths(entry.path)));
  const rows = flattenRepoTree(roots, expanded);
  const deepest = rows.reduce((max, row) => Math.max(max, row.depth), 0);
  assert.ok(deepest > REPO_TREE_MAX_INDENT, "fixture must nest past the clamp");
  for (const row of rows) {
    assert.equal(row.indent, Math.min(row.depth, REPO_TREE_MAX_INDENT));
    assert.ok(row.indent <= REPO_TREE_MAX_INDENT);
  }
});

test("filterRepoFiles ranks basename prefix over substring over path, files only", () => {
  const entries = [
    blob("docs/vendor/README.md", 40),
    blob("README.md", 5_200),
    blob("src/readme-helpers.ts", 300),
    blob("src/notes/about-readme.txt", 90),
    { path: "readme-dir", type: "tree", sha: SHA } as GithubRepoTreeEntry,
  ];
  const hits = filterRepoFiles(entries, "readme");
  assert.deepEqual(hits.map((hit) => hit.path), [
    // Basename prefix first; shorter path breaks the tie with the vendored copy.
    "README.md",
    "docs/vendor/README.md",
    "src/readme-helpers.ts",
    "src/notes/about-readme.txt",
  ]);
  assert.equal(hits[0].dir, "");
  assert.equal(hits[1].dir, "docs/vendor");
  // A directory can't be opened in the reader, so it never enters the list.
  assert.ok(!hits.some((hit) => hit.path === "readme-dir"));
});

test("filterRepoFiles is empty for a blank query and honours the cap", () => {
  const entries = Array.from({ length: 40 }, (_, i) => blob(`src/file-${i}.ts`, i));
  assert.deepEqual(filterRepoFiles(entries, "   "), []);
  assert.equal(filterRepoFiles(entries, "file").length, 40);
  assert.equal(filterRepoFiles(entries, "file", 10).length, 10);
});

test("repoBreadcrumb keeps the ends and elides the middle", () => {
  assert.deepEqual(
    repoBreadcrumb("src/app.ts").map((crumb) => crumb.name),
    ["src", "app.ts"],
  );
  const long = repoBreadcrumb("vendor/build/src/chrome/ui/mori/AgentThreadView.swift");
  assert.deepEqual(long.map((crumb) => crumb.name), ["vendor", "…", "mori", "AgentThreadView.swift"]);
  // The ellipsis is not a destination; every other crumb re-roots the rail.
  assert.equal(long[1].path, null);
  assert.equal(long[0].path, "vendor");
  assert.equal(long[2].path, "vendor/build/src/chrome/ui/mori");
});

test("repoAncestorPaths yields every parent directory, nearest last", () => {
  assert.deepEqual(repoAncestorPaths("a/b/c/file.ts"), ["a", "a/b", "a/b/c"]);
  assert.deepEqual(repoAncestorPaths("file.ts"), []);
});

test("repoFileKind and repoFileIsPreviewable gate the content pane", () => {
  assert.equal(repoFileKind("src/App.tsx"), "text");
  assert.equal(repoFileKind("docs/diagram.PNG"), "image");
  assert.equal(repoFileKind("vendor/lib.wasm"), "binary");
  // No extension is a text file — LICENSE, Makefile, Dockerfile.
  assert.equal(repoFileKind("LICENSE"), "text");
  assert.equal(repoFileKind("path.to/Makefile"), "text");

  assert.equal(repoFileIsPreviewable("src/App.tsx", 1_000), true);
  assert.equal(repoFileIsPreviewable("src/App.tsx", undefined), true);
  assert.equal(repoFileIsPreviewable("docs/shot.png", 1_000), false);
  assert.equal(repoFileIsPreviewable("src/App.tsx", REPO_FILE_PREVIEW_BYTE_LIMIT + 1), false);
  assert.equal(repoFileIsPreviewable("src/App.tsx", REPO_FILE_PREVIEW_BYTE_LIMIT), true);
});

test("repoRowSizeLabel reports child counts, byte sizes, and binary refusals", () => {
  const roots = collapseSingleChildChains(buildGithubRepoTree([
    blob("src/app.ts", 2_048),
    blob("src/logo.png", 240_000),
    blob("src/core.wasm", 51_200),
    blob("src/nested/x.ts", 10),
  ]));
  const [src] = roots;
  assert.equal(repoRowSizeLabel(src), "4");
  const byName = new Map((src.children ?? []).map((child) => [child.name, child]));
  assert.equal(repoRowSizeLabel(byName.get("app.ts")!), "2 KB");
  // An image keeps its byte size — the pane offers an explicit "load from
  // github.com", so the number is actionable rather than decorative.
  assert.equal(repoRowSizeLabel(byName.get("logo.png")!), "234 KB");
  // An opaque binary has no readable size story; the row says so instead.
  assert.equal(repoRowSizeLabel(byName.get("core.wasm")!), "bin");
  assert.equal(repoRowSizeLabel(byName.get("nested")!), "1");
});

test("repoPathsToReveal names the COLLAPSED rows that must open, not raw ancestors", () => {
  const roots = collapseSingleChildChains(buildGithubRepoTree([
    blob("vendor/build/src/ui/mori/AgentThreadView.swift", 4_700),
    blob("vendor/build/src/ui/mori/AIComposer.swift", 6_200),
    blob("README.md", 5_200),
  ]));
  const target = "vendor/build/src/ui/mori/AgentThreadView.swift";
  // The only directory row is the whole collapsed chain, so that is the path
  // that opens — none of the raw ancestors exist as rows.
  assert.deepEqual(repoPathsToReveal(roots, target), ["vendor/build/src/ui/mori"]);

  // A breadcrumb segment re-roots onto whichever collapsed row contains it,
  // which is what makes an early segment clickable at all.
  assert.deepEqual(repoPathsToReveal(roots, "vendor"), ["vendor/build/src/ui/mori"]);

  // Selecting the collapsed directory itself opens it.
  assert.deepEqual(repoPathsToReveal(roots, "vendor/build/src/ui/mori"), ["vendor/build/src/ui/mori"]);

  // A root-level file needs nothing open.
  assert.deepEqual(repoPathsToReveal(roots, "README.md"), []);
});

test("repoPathsToReveal opens every level of a branching tree down to the target", () => {
  const roots = collapseSingleChildChains(buildGithubRepoTree([
    blob("a/b/one.txt"),
    blob("a/b/deep/two.txt"),
    blob("a/c/three.txt"),
  ]));
  assert.deepEqual(repoPathsToReveal(roots, "a/b/deep/two.txt").sort(), ["a", "a/b", "a/b/deep"]);
  // A sibling branch stays closed.
  assert.deepEqual(repoPathsToReveal(roots, "a/c/three.txt").sort(), ["a", "a/c"]);
});
