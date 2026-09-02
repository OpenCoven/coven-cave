import assert from "node:assert/strict";
import { test } from "node:test";

import type { GithubRepoFileResult } from "@/lib/server/research-github-repo";
import { createGithubRepoFileRouteHandlers } from "./route.ts";

const SHA = "a".repeat(40);

function localRequest(query: string, host = "localhost"): Request {
  return new Request(`http://localhost:3000/api/research/github-repo/file${query}`, {
    headers: { host },
  });
}

function route(dependencies: {
  fetchFile?: (args: {
    owner: string;
    repo: string;
    sha: string;
    token: string | null;
  }) => Promise<GithubRepoFileResult>;
  resolveToken?: () => string | null;
} = {}) {
  return createGithubRepoFileRouteHandlers(dependencies).GET;
}

test("rejects non-local and malformed blob requests before resolving credentials", async () => {
  let tokens = 0;
  let fetches = 0;
  const handler = route({
    resolveToken: () => {
      tokens++;
      return "token";
    },
    fetchFile: async () => {
      fetches++;
      return { ok: true, file: { sha: SHA, text: "x", bytes: 1 } };
    },
  });

  assert.equal((await handler(localRequest(`?repo=o%2Fr&sha=${SHA}`, "example.com"))).status, 403);
  for (const query of ["", "?repo=o%2Fr", "?repo=bad&sha=abc", "?repo=o%2Fr&sha=abc"]) {
    assert.equal((await handler(localRequest(query))).status, 400);
  }
  assert.equal(tokens, 0);
  assert.equal(fetches, 0);
});

test("forwards only the exact repository, blob SHA, and server token", async () => {
  const calls: unknown[] = [];
  const handler = route({
    resolveToken: () => "token",
    fetchFile: async (args) => {
      calls.push(args);
      return { ok: true, file: { sha: SHA, text: "hello", bytes: 5 } };
    },
  });

  const response = await handler(localRequest(`?repo=OpenCoven%2Fcoven-cave&sha=${SHA}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sha: SHA, text: "hello", bytes: 5 });
  assert.deepEqual(calls, [{
    owner: "OpenCoven",
    repo: "coven-cave",
    sha: SHA,
    token: "token",
  }]);
});

test("maps non-previewable and upstream states to stable responses", async () => {
  const cases = [
    [{ kind: "not-found", message: "missing" }, 404],
    [{ kind: "denied", message: "denied" }, 403],
    [{ kind: "too-large", message: "large" }, 413],
    [{ kind: "binary", message: "binary" }, 415],
    [{ kind: "upstream", status: 500, message: "upstream" }, 502],
    [{ kind: "timeout" }, 502],
    [{ kind: "network" }, 502],
  ] as const;

  for (const [error, status] of cases) {
    const handler = route({
      fetchFile: async () => ({ ok: false, error } as GithubRepoFileResult),
    });
    const response = await handler(localRequest(`?repo=o%2Fr&sha=${SHA}`));
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
});
