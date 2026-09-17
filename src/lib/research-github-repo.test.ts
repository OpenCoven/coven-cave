import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGithubRepoTree,
  formatGithubBytes,
  githubRepoFileWebUrl,
  githubRepoReadmeLinkUrl,
  githubRepoTreeWebUrl,
  githubRepoViewEndpoint,
  normalizeGithubRepoSnapshot,
  parseGithubRepoInput,
  sanitizeGithubRef,
  type GithubRepoTreeEntry,
} from "./research-github-repo.ts";

const SHA = "a".repeat(40);

test("parseGithubRepoInput accepts bare slugs and github.com URLs, rejects others", () => {
  assert.deepEqual(parseGithubRepoInput("OpenCoven/coven-cave"), { owner: "OpenCoven", repo: "coven-cave" });
  assert.deepEqual(parseGithubRepoInput("https://github.com/OpenCoven/coven-cave"), {
    owner: "OpenCoven",
    repo: "coven-cave",
  });
  // Deeper github.com URLs (blob/tree/PR) still identify the repository.
  assert.deepEqual(parseGithubRepoInput("https://github.com/o/r/blob/main/src/App.tsx"), {
    owner: "o",
    repo: "r",
  });
  assert.deepEqual(parseGithubRepoInput("git@github.com:o/r.git"), { owner: "o", repo: "r" });
  // Surrounding whitespace is tolerated.
  assert.deepEqual(parseGithubRepoInput("  o/r  "), { owner: "o", repo: "r" });

  assert.equal(parseGithubRepoInput(""), null);
  assert.equal(parseGithubRepoInput("onlyowner"), null);
  assert.equal(parseGithubRepoInput("https://gitlab.com/o/r"), null);
  assert.equal(parseGithubRepoInput("https://github.com/owner"), null);
  assert.equal(parseGithubRepoInput("javascript:alert(1)"), null);
  assert.equal(parseGithubRepoInput(null), null);
  assert.equal(parseGithubRepoInput(undefined), null);
});

test("sanitizeGithubRef keeps real refs and rejects unsafe ones", () => {
  assert.equal(sanitizeGithubRef("main"), "main");
  assert.equal(sanitizeGithubRef("  main  "), "main");
  assert.equal(sanitizeGithubRef("feature/thing"), "feature/thing");
  assert.equal(sanitizeGithubRef("v1.2.3"), "v1.2.3");

  assert.equal(sanitizeGithubRef(null), null);
  assert.equal(sanitizeGithubRef(undefined), null);
  assert.equal(sanitizeGithubRef(""), null);
  assert.equal(sanitizeGithubRef("   "), null);
  assert.equal(sanitizeGithubRef("has space"), null);
  assert.equal(sanitizeGithubRef("with?query"), null);
  assert.equal(sanitizeGithubRef("with#frag"), null);
  assert.equal(sanitizeGithubRef(".."), null);
  assert.equal(sanitizeGithubRef("a/../b"), null);
  assert.equal(sanitizeGithubRef("x".repeat(300)), null);
});

test("githubRepo*Url helpers compose canonical github.com URLs with encoding", () => {
  assert.equal(githubRepoFileWebUrl("o", "r", "main", "src/App.tsx"), "https://github.com/o/r/blob/main/src/App.tsx");
  assert.equal(
    githubRepoFileWebUrl("o", "r", "feat/x", "docs/a b.md"),
    "https://github.com/o/r/blob/feat%2Fx/docs/a%20b.md",
  );
  assert.equal(githubRepoTreeWebUrl("o", "r", "main"), "https://github.com/o/r/tree/main");
  assert.equal(
    githubRepoReadmeLinkUrl({
      owner: "o",
      repo: "r",
      commitSha: SHA,
      readmePath: "README.md",
    }, "docs/guide.md"),
    `https://github.com/o/r/blob/${SHA}/docs/guide.md`,
  );
  assert.equal(
    githubRepoReadmeLinkUrl({
      owner: "o",
      repo: "r",
      commitSha: SHA,
      readmePath: "docs/README.md",
    }, "../LICENSE"),
    `https://github.com/o/r/blob/${SHA}/LICENSE`,
  );
  assert.equal(
    githubRepoReadmeLinkUrl({
      owner: "o",
      repo: "r",
      commitSha: SHA,
      readmePath: "README.md",
    }, "javascript:alert(1)"),
    null,
  );
});

test("githubRepoViewEndpoint encodes repo and drops a blank/unsafe ref", () => {
  assert.equal(
    githubRepoViewEndpoint("OpenCoven/coven-cave"),
    "/api/research/github-repo?repo=OpenCoven%2Fcoven-cave",
  );
  assert.equal(
    githubRepoViewEndpoint("o/r", "main"),
    "/api/research/github-repo?repo=o%2Fr&ref=main",
  );
  assert.equal(
    githubRepoViewEndpoint("o/r", "   "),
    "/api/research/github-repo?repo=o%2Fr",
  );
  assert.equal(
    githubRepoViewEndpoint("o/r", "a b"),
    "/api/research/github-repo?repo=o%2Fr",
  );
});

test("buildGithubRepoTree folds flat listings into a nested tree", () => {
  const entries: GithubRepoTreeEntry[] = [
    { path: "README.md", type: "blob", sha: SHA, size: 100 },
    { path: "src", type: "tree", sha: SHA },
    { path: "src/index.ts", type: "blob", sha: SHA, size: 20 },
    { path: "src/lib", type: "tree", sha: SHA },
    { path: "src/lib/util.ts", type: "blob", sha: SHA, size: 40 },
    { path: "docs/guide.md", type: "blob", sha: SHA, size: 60 },
  ];
  const tree = buildGithubRepoTree(entries);
  assert.equal(tree.length, 3);
  const readme = tree.find((n) => n.name === "README.md");
  assert.ok(readme);
  assert.equal(readme.type, "blob");
  assert.equal(readme.size, 100);

  const src = tree.find((n) => n.name === "src");
  assert.ok(src);
  assert.equal(src.type, "tree");
  assert.equal(src.children?.length, 2);
  const lib = src.children?.find((n) => n.name === "lib");
  assert.ok(lib);
  assert.equal(lib.type, "tree");
  assert.equal(lib.children?.[0].path, "src/lib/util.ts");

  const docs = tree.find((n) => n.name === "docs");
  assert.equal(docs?.children?.[0].path, "docs/guide.md");
});

test("buildGithubRepoTree materializes intermediate dirs for deep blobs", () => {
  const tree = buildGithubRepoTree([{ path: "a/b/c.txt", type: "blob", sha: SHA, size: 1 }]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].type, "tree");
  assert.equal(tree[0].name, "a");
  assert.equal(tree[0].children?.[0].name, "b");
  assert.equal(tree[0].children?.[0].children?.[0].type, "blob");
});

test("normalizeGithubRepoSnapshot rejects invalid tree and README paths", () => {
  const snapshot = (
    tree: GithubRepoTreeEntry[],
    readme: { path: string; markdown: string } | null = null,
  ) => ({
    version: 1,
    owner: "OpenCoven",
    repo: "coven-cave",
    visibility: "public",
    stars: 1,
    forks: 0,
    defaultBranch: "main",
    resolvedRef: "main",
    commitSha: SHA,
    fetchedAt: "2026-09-01T12:00:00.000Z",
    truncated: false,
    tree,
    readme,
  });

  assert.equal(normalizeGithubRepoSnapshot(snapshot([
    { path: "src", type: "tree", sha: SHA },
    { path: "src", type: "tree", sha: SHA },
  ])), null);
  assert.equal(normalizeGithubRepoSnapshot(snapshot([
    { path: "src", type: "blob", sha: SHA },
    { path: "src/index.ts", type: "blob", sha: SHA },
  ])), null);
  assert.equal(normalizeGithubRepoSnapshot(snapshot([], {
    path: "../../README.md",
    markdown: "# Escaped",
  })), null);
});

test("formatGithubBytes returns human-readable sizes or null", () => {
  assert.equal(formatGithubBytes(undefined), null);
  assert.equal(formatGithubBytes(-1), null);
  assert.equal(formatGithubBytes(0), "0 B");
  assert.equal(formatGithubBytes(512), "512 B");
  assert.equal(formatGithubBytes(2048), "2 KB");
  assert.equal(formatGithubBytes(5 * 1024 * 1024), "5 MB");
});
