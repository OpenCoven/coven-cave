import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchGithubRepoView } from "./research-github-repo.ts";

const GH = "https://api.github.com";
const REPO = "/repos/OpenCoven/coven-cave";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readmeResponse(markdown: string, path = "README.md"): Response {
  return json({ path, encoding: "base64", content: Buffer.from(markdown).toString("base64") });
}

/** A fetch that routes by exact api.github.com path. */
function routed(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return async (input) => {
    const url = String(input);
    const path = url.slice(GH.length).replace(/\?.*$/, "");
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler();
  };
}

const treeEntry = (path: string, type: "blob" | "tree", size?: number) =>
  size === undefined ? { path, type } : { path, type, size };

test("resolves metadata, tree, and README into the viewer payload", async () => {
  const result = await fetchGithubRepoView({
    owner: "OpenCoven",
    repo: "coven-cave",
    token: "tok",
    fetchImpl: routed({
      [REPO]: () => json({ default_branch: "main" }),
      [`${REPO}/git/trees/main`]: () => json({ truncated: false, tree: [treeEntry("README.md", "blob", 12), treeEntry("src/index.ts", "blob", 40)] }),
      [`${REPO}/readme`]: () => readmeResponse("# Hello"),
    }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.view, {
    owner: "OpenCoven",
    repo: "coven-cave",
    defaultBranch: "main",
    resolvedRef: "main",
    truncated: false,
    tree: [
      { path: "README.md", type: "blob", size: 12 },
      { path: "src/index.ts", type: "blob", size: 40 },
    ],
    readme: { path: "README.md", markdown: "# Hello" },
  });
});

test("a provided ref overrides the default branch for tree and readme", async () => {
  const requested: string[] = [];
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    ref: "feat/x",
    token: null,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/readme?")) return readmeResponse("# Branch");
      if (url.includes("/git/trees/")) return json({ truncated: false, tree: [] });
      return json({ default_branch: "main" });
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.view.resolvedRef, "feat/x");
  assert.equal(result.view.defaultBranch, "main");
  assert.ok(requested.some((u) => u.includes("/git/trees/feat%2Fx")));
  assert.ok(requested.some((u) => u.includes("/readme?ref=feat%2Fx")));
});

test("a missing repository is a not-found error", async () => {
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "nope",
    token: null,
    fetchImpl: routed({ [REPO.replace("OpenCoven/coven-cave", "o/nope")]: () => json({ message: "Not Found" }, 404) }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "not-found");
  assert.match(result.error.message, /repository/i);
});

test("denied and upstream metadata failures classify cleanly", async () => {
  for (const [status, kind] of [[403, "denied"], [500, "upstream"]] as const) {
    const result = await fetchGithubRepoView({
      owner: "o",
      repo: "r",
      token: null,
      fetchImpl: routed({ [`/repos/o/r`]: () => json({ message: "x" }, status) }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, kind);
  }
});

test("an unknown branch surfaces a not-found error with a branch hint", async () => {
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      [`/repos/o/r`]: () => json({ default_branch: "main" }),
      [`/repos/o/r/git/trees/main`]: () => json({ message: "Not Found" }, 404),
      [`/repos/o/r/readme`]: () => json({ message: "Not Found" }, 404),
    }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "not-found");
  assert.match(result.error.message, /branch/i);
});

test("a missing README degrades to null instead of failing the view", async () => {
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      [`/repos/o/r`]: () => json({ default_branch: "main" }),
      [`/repos/o/r/git/trees/main`]: () => json({ truncated: false, tree: [treeEntry("a.txt", "blob")] }),
      [`/repos/o/r/readme`]: () => json({ message: "Not Found" }, 404),
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.view.readme, null);
  assert.equal(result.view.tree.length, 1);
});

test("oversized trees are truncated and flagged", async () => {
  const bigTree = Array.from({ length: 500 }, (_, i) => treeEntry(`f${i}.txt`, "blob", 1));
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      [`/repos/o/r`]: () => json({ default_branch: "main" }),
      [`/repos/o/r/git/trees/main`]: () => json({ truncated: false, tree: bigTree }),
      [`/repos/o/r/readme`]: () => json({ message: "Not Found" }, 404),
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.view.truncated, true);
  assert.equal(result.view.tree.length, 400);
});

test("timeouts and network failures classify without touching data", async () => {
  const timeout = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.equal(timeout.ok, false);
  if (timeout.ok) return;
  assert.equal(timeout.error.kind, "timeout");

  const network = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(network.ok, false);
  if (network.ok) return;
  assert.equal(network.error.kind, "network");
});

test("drops malformed tree rows and missing sizes", async () => {
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      [`/repos/o/r`]: () => json({ default_branch: "main" }),
      [`/repos/o/r/git/trees/main`]: () => json({
        truncated: false,
        tree: [
          treeEntry("ok.txt", "blob", 3),
          { path: "", type: "blob" },
          { path: "bad\0path", type: "blob" },
          { path: "not-a-kind", type: "commit" },
          "garbage",
          null,
        ],
      }),
      [`/repos/o/r/readme`]: () => json({ message: "Not Found" }, 404),
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.view.tree, [{ path: "ok.txt", type: "blob", size: 3 }]);
});
