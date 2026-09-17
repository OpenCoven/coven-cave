import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fetchGithubRepoFile,
  fetchGithubRepoView,
} from "./research-github-repo.ts";
import { GITHUB_REPO_README_BYTE_CAP } from "../research-github-repo.ts";

const GH = "https://api.github.com";
const REPO = "/repos/OpenCoven/coven-cave";
const SHA = "a".repeat(40);
const BLOB_SHA = "b".repeat(40);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readmeResponse(markdown: string, path = "README.md"): Response {
  return json({ path, encoding: "base64", content: Buffer.from(markdown).toString("base64") });
}

function routed(
  routes: Record<string, () => Response | Promise<Response>>,
  inspect?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return async (input, init = {}) => {
    const url = String(input);
    inspect?.(url, init);
    const path = url.slice(GH.length).replace(/\?.*$/, "");
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler();
  };
}

const treeEntry = (path: string, type: "blob" | "tree", size?: number) => ({
  path,
  type,
  sha: type === "blob" ? BLOB_SHA : SHA,
  ...(size === undefined ? {} : { size }),
});

test("captures repository metadata, exact commit, bounded tree, and README", async () => {
  const calls: Array<{ url: string; version: string | null }> = [];
  const result = await fetchGithubRepoView({
    owner: "OpenCoven",
    repo: "coven-cave",
    token: "tok",
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    fetchImpl: routed({
      [REPO]: () => json({
        default_branch: "main",
        description: "Desktop control room",
        language: "TypeScript",
        visibility: "public",
        stargazers_count: 42,
        forks_count: 7,
        license: { spdx_id: "MIT" },
      }),
      [`${REPO}/commits/main`]: () => json({ sha: SHA }),
      [`${REPO}/git/trees/${SHA}`]: () => json({
        truncated: false,
        tree: [treeEntry("README.md", "blob", 12), treeEntry("src/index.ts", "blob", 40)],
      }),
      [`${REPO}/readme`]: () => readmeResponse("# Hello"),
    }, (url, init) => {
      calls.push({
        url,
        version: new Headers(init.headers).get("X-GitHub-Api-Version"),
      });
    }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.view, {
    version: 1,
    owner: "OpenCoven",
    repo: "coven-cave",
    description: "Desktop control room",
    primaryLanguage: "TypeScript",
    licenseSpdx: "MIT",
    visibility: "public",
    stars: 42,
    forks: 7,
    defaultBranch: "main",
    resolvedRef: "main",
    commitSha: SHA,
    fetchedAt: "2026-09-01T12:00:00.000Z",
    truncated: false,
    tree: [
      { path: "README.md", type: "blob", sha: BLOB_SHA, size: 12 },
      { path: "src/index.ts", type: "blob", sha: BLOB_SHA, size: 40 },
    ],
    readme: { path: "README.md", markdown: "# Hello" },
  });
  assert.ok(calls.some(({ url }) => url.includes(`/git/trees/${SHA}?recursive=1`)));
  assert.ok(calls.some(({ url }) => url.includes(`/readme?ref=${SHA}`)));
  assert.ok(calls.every(({ version }) => version === "2026-03-10"));
});

test("resolves a provided ref once and uses the exact commit thereafter", async () => {
  const requested: string[] = [];
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    ref: "feat/x",
    token: null,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/commits/")) return json({ sha: SHA });
      if (url.includes("/readme?")) return readmeResponse("# Branch");
      if (url.includes("/git/trees/")) return json({ truncated: false, tree: [] });
      return json({ default_branch: "main" });
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.view.resolvedRef, "feat/x");
  assert.ok(requested.some((url) => url.includes("/commits/feat%2Fx")));
  assert.ok(requested.some((url) => url.includes(`/git/trees/${SHA}`)));
});

test("classifies missing repositories, denied access, and upstream failures", async () => {
  for (const [status, kind] of [[404, "not-found"], [403, "denied"], [500, "upstream"]] as const) {
    const result = await fetchGithubRepoView({
      owner: "o",
      repo: "r",
      token: null,
      fetchImpl: routed({ ["/repos/o/r"]: () => json({ message: "x" }, status) }),
    });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.kind, kind);
  }
});

test("reports an unknown branch before reading tree content", async () => {
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      ["/repos/o/r"]: () => json({ default_branch: "main" }),
      ["/repos/o/r/commits/main"]: () => json({ message: "Not Found" }, 404),
    }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "not-found");
  assert.match(result.error.message, /branch/i);
});

test("a missing README degrades to null and oversized trees are capped", async () => {
  const bigTree = Array.from({ length: 500 }, (_, index) =>
    treeEntry(`f${index}.txt`, "blob", 1));
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      ["/repos/o/r"]: () => json({ default_branch: "main" }),
      ["/repos/o/r/commits/main"]: () => json({ sha: SHA }),
      [`/repos/o/r/git/trees/${SHA}`]: () => json({ truncated: false, tree: bigTree }),
      ["/repos/o/r/readme"]: () => json({ message: "Not Found" }, 404),
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.view.readme, null);
  assert.equal(result.view.truncated, true);
  assert.equal(result.view.tree.length, 400);
});

test("README truncation preserves valid UTF-8 at the byte cap", async () => {
  const markdown = `${"a".repeat(GITHUB_REPO_README_BYTE_CAP - 1)}🦄tail`;
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      ["/repos/o/r"]: () => json({ default_branch: "main" }),
      ["/repos/o/r/commits/main"]: () => json({ sha: SHA }),
      [`/repos/o/r/git/trees/${SHA}`]: () => json({ truncated: false, tree: [] }),
      ["/repos/o/r/readme"]: () => readmeResponse(markdown),
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.view.readme);
  assert.equal(new TextEncoder().encode(result.view.readme.markdown).byteLength, GITHUB_REPO_README_BYTE_CAP - 1);
  assert.ok(!result.view.readme.markdown.includes("�"));
});

test("malformed tree rows fail closed", async () => {
  const result = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: routed({
      ["/repos/o/r"]: () => json({ default_branch: "main" }),
      ["/repos/o/r/commits/main"]: () => json({ sha: SHA }),
      [`/repos/o/r/git/trees/${SHA}`]: () => json({
        truncated: false,
        tree: [{ path: "missing-sha.txt", type: "blob" }],
      }),
      ["/repos/o/r/readme"]: () => json({ message: "Not Found" }, 404),
    }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "upstream");
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
  if (!timeout.ok) assert.equal(timeout.error.kind, "timeout");

  const network = await fetchGithubRepoView({
    owner: "o",
    repo: "r",
    token: null,
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(network.ok, false);
  if (!network.ok) assert.equal(network.error.kind, "network");
});

test("reads a selected blob as raw UTF-8 at its exact SHA", async () => {
  let accept = "";
  const result = await fetchGithubRepoFile({
    owner: "o",
    repo: "r",
    sha: BLOB_SHA,
    token: "tok",
    fetchImpl: routed({
      [`/repos/o/r/git/blobs/${BLOB_SHA}`]: () => new Response("hello\n"),
    }, (_url, init) => {
      accept = new Headers(init.headers).get("accept") ?? "";
    }),
  });
  assert.deepEqual(result, {
    ok: true,
    file: { sha: BLOB_SHA, text: "hello\n", bytes: 6 },
  });
  assert.equal(accept, "application/vnd.github.raw+json");
});

test("rejects oversized and binary blob previews", async () => {
  const oversized = await fetchGithubRepoFile({
    owner: "o",
    repo: "r",
    sha: BLOB_SHA,
    token: null,
    fetchImpl: routed({
      [`/repos/o/r/git/blobs/${BLOB_SHA}`]: () => new Response("small", {
        headers: { "content-length": String(1024 * 1024 + 1) },
      }),
    }),
  });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.error.kind, "too-large");

  const binary = await fetchGithubRepoFile({
    owner: "o",
    repo: "r",
    sha: BLOB_SHA,
    token: null,
    fetchImpl: routed({
      [`/repos/o/r/git/blobs/${BLOB_SHA}`]: () => new Response(new Uint8Array([0xff])),
    }),
  });
  assert.equal(binary.ok, false);
  if (!binary.ok) assert.equal(binary.error.kind, "binary");
});

test("cancels a streamed blob as soon as it crosses the preview limit", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const oversized = await fetchGithubRepoFile({
    owner: "o",
    repo: "r",
    sha: BLOB_SHA,
    token: null,
    fetchImpl: routed({
      [`/repos/o/r/git/blobs/${BLOB_SHA}`]: () => new Response(body),
    }),
  });

  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.error.kind, "too-large");
  assert.equal(cancelled, true);
});
