import assert from "node:assert/strict";
import { test } from "node:test";

import type { GithubRepoView } from "@/lib/research-github-repo";
import type { GithubRepoViewResult } from "@/lib/server/research-github-repo";
import { createGithubRepoRouteHandlers } from "./route.ts";

const VIEW: GithubRepoView = {
  owner: "OpenCoven",
  repo: "coven-cave",
  defaultBranch: "main",
  resolvedRef: "main",
  truncated: false,
  tree: [{ path: "README.md", type: "blob", size: 12 }],
  readme: { path: "README.md", markdown: "# Hello" },
};

function localRequest(path: string, host = "localhost"): Request {
  return new Request(`http://localhost:3000${path}`, { headers: { host } });
}

function route(deps: {
  fetchView?: (args: { owner: string; repo: string; ref?: string; token: string | null }) => Promise<GithubRepoViewResult>;
  resolveToken?: () => string | null;
} = {}) {
  return createGithubRepoRouteHandlers(deps).GET;
}

test("rejects non-local requests before any fetch or token resolution", async () => {
  let fetches = 0;
  let tokens = 0;
  const handler = route({
    fetchView: async () => {
      fetches++;
      return { ok: true, view: VIEW };
    },
    resolveToken: () => {
      tokens++;
      return "tok";
    },
  });

  const response = await handler(localRequest("/api/research/github-repo?repo=o/r", "cave.example.com"));
  assert.equal(response.status, 403);
  assert.equal(fetches, 0);
  assert.equal(tokens, 0);
});

test("rejects a missing or invalid repo reference with a 400", async () => {
  let fetches = 0;
  const handler = route({
    fetchView: async () => {
      fetches++;
      return { ok: true, view: VIEW };
    },
  });

  for (const query of ["", "?repo=", "?repo=onlyowner", "?repo=https%3A%2F%2Fgitlab.com%2Fo%2Fr"]) {
    const response = await handler(localRequest(`/api/research/github-repo${query}`));
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Enter a GitHub repository as owner/name or a github.com URL.",
    });
  }
  assert.equal(fetches, 0);
});

test("rejects an unsafe ref with a 400 before fetching", async () => {
  let fetches = 0;
  const handler = route({
    fetchView: async () => {
      fetches++;
      return { ok: true, view: VIEW };
    },
  });

  const response = await handler(localRequest("/api/research/github-repo?repo=o%2Fr&ref=a%20b"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "That branch name can't be used." });
  assert.equal(fetches, 0);
});

test("resolves the token and forwards a validated repo/ref to the fetch module", async () => {
  const calls: Array<{ owner: string; repo: string; ref?: string; token: string | null }> = [];
  const handler = route({
    resolveToken: () => "tok",
    fetchView: async (args) => {
      calls.push(args);
      return { ok: true, view: { ...VIEW, resolvedRef: "feat/x" } };
    },
  });

  const response = await handler(localRequest("/api/research/github-repo?repo=OpenCoven%2Fcoven-cave&ref=feat%2Fx"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.resolvedRef, "feat/x");
  assert.deepEqual(calls, [{ owner: "OpenCoven", repo: "coven-cave", ref: "feat/x", token: "tok" }]);
});

test("omits the ref key when none is supplied", async () => {
  const calls: Array<{ owner: string; repo: string; ref?: string }> = [];
  const handler = route({
    fetchView: async (args) => {
      calls.push(args);
      return { ok: true, view: VIEW };
    },
  });

  await handler(localRequest("/api/research/github-repo?repo=o%2Fr"));
  assert.deepEqual(calls, [{ owner: "o", repo: "r", token: null }]);
});

test("maps fetch errors to stable status codes and safe messages", async () => {
  const cases: Array<{ error: NonNullable<Extract<GithubRepoViewResult, { ok: false }>["error"]>; status: number }> = [
    { error: { kind: "not-found", message: "GitHub couldn't find that repository." }, status: 404 },
    { error: { kind: "denied", message: "GitHub denied access." }, status: 403 },
    { error: { kind: "upstream", status: 500, message: "GitHub couldn't load that repository (500)." }, status: 502 },
    { error: { kind: "timeout" }, status: 502 },
    { error: { kind: "network" }, status: 502 },
  ];

  for (const { error, status } of cases) {
    const handler = route({ fetchView: async () => ({ ok: false, error }) });
    const response = await handler(localRequest("/api/research/github-repo?repo=o%2Fr"));
    assert.equal(response.status, status, error.kind);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, "string");
    assert.ok((body.error as string).length > 0);
  }
});
