// /api/github/reactions under every upstream anomaly (#6359), all three verbs.
//
// GET reads the tally and, with a token, the viewer's login in parallel; a
// 401 or 403 keeps its status and everything else is a 502, an unreadable or
// drifted 200 included. POST passes GitHub's own message through and accepts
// a drifted 200 as a reaction with no id (pinned: the client then has no
// handle to DELETE). DELETE treats 204 and 404 alike as "gone" and never
// reads a success body, so a torn 200 is still "deleted".
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-reactions-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET, POST, DELETE } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

harness.healthy("github", async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "GET" && url.pathname === "/user") {
    return Response.json({ login: "octocat", id: 1 });
  }
  if (request.method === "GET" && url.pathname === "/repos/o/r/issues/7/reactions") {
    return Response.json([
      { id: 11, content: "+1", user: { login: "octocat" } },
      { id: 12, content: "+1", user: { login: "someone-else" } },
      { id: 13, content: "rocket", user: { login: "someone-else" } },
    ]);
  }
  if (request.method === "POST" && url.pathname === "/repos/o/r/issues/7/reactions") {
    const sent = (await request.json()) as { content: string };
    return Response.json({ id: 14, content: sent.content }, { status: 201 });
  }
  if (request.method === "DELETE" && url.pathname === "/repos/o/r/issues/7/reactions/14") {
    return new Response(null, { status: 204 });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const read = () => GET(new Request("http://localhost/api/github/reactions?repo=o/r&number=7"));
const add = () =>
  POST(
    new Request("http://localhost/api/github/reactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", number: 7, content: "+1" }),
    }),
  );
const remove = () =>
  DELETE(
    new Request("http://localhost/api/github/reactions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", number: 7, reactionId: 14 }),
    }),
  );

const failsWith = (status: number, error: string) => (outcome: MatrixOutcome) => {
  expectErrorStatus(status)(outcome, { kind: "http", status });
  assert.equal((outcome.body as { error: string }).error, error);
};
const timesOut = (outcome: MatrixOutcome) => {
  expectErrorStatus(502)(outcome, { kind: "timeout" });
  assert.match((outcome.body as { error: string }).error, /timeout/i);
};

test("GET /api/github/reactions across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        reactions: [
          { content: "+1", count: 2, mine: 11 },
          { content: "rocket", count: 1, mine: null },
        ],
      });
      assert.equal(harness.calls("github").length, 2, "the tally and the viewer login are read together");
    },
    degraded: {
      "http-500": failsWith(502, "github error (500)"),
      "http-502": failsWith(502, "github error (502)"),
      // A read passes 401 and 403 through unchanged.
      "auth-revoked": failsWith(401, "github error (401)"),
      "rate-limit": failsWith(502, "github error (429)"),
      timeout: timesOut,
      network: failsWith(502, "fetch failed"),
      "malformed-json": failsWith(502, "github error (200)"),
      "empty-body": failsWith(502, "github error (200)"),
      "schema-drift": failsWith(502, "github error (200)"),
    },
  });
});

test("POST /api/github/reactions across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: add,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true, reaction: { id: 14, content: "+1" } });
    },
    degraded: {
      "http-500": failsWith(502, "Internal Server Error"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "Bad credentials"),
      "rate-limit": failsWith(502, "API rate limit exceeded"),
      timeout: timesOut,
      network: failsWith(502, "fetch failed"),
      "malformed-json": failsWith(502, "github error (200)"),
      "empty-body": failsWith(502, "github error (200)"),
      "schema-drift": (outcome) => {
        // Pinned, not endorsed: the reaction is reported added with no id, so
        // the client cannot remove it until the next GET.
        assert.equal(outcome.status, 200);
        assert.deepEqual(outcome.body, { ok: true, reaction: { id: null, content: "+1" } });
      },
    },
  });
});

const gone = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  assert.deepEqual(outcome.body, { ok: true, deleted: true });
};

test("DELETE /api/github/reactions across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: remove,
    healthy: gone,
    degraded: {
      "http-500": failsWith(502, "Internal Server Error"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "Bad credentials"),
      "rate-limit": failsWith(502, "API rate limit exceeded"),
      timeout: timesOut,
      network: failsWith(502, "fetch failed"),
      // A 2xx is the end state; the body is never read.
      "malformed-json": gone,
      "empty-body": gone,
      "schema-drift": gone,
    },
  });
});

test("a 404 on DELETE is already gone, not a failure", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.deepEqual(await (await remove()).json(), { ok: true, deleted: true });
  harness.heal("github");
});

test("a 403 on a write keeps its status and GitHub's reason", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "Resource not accessible" } });
  const response = await add();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "Resource not accessible" });
  harness.heal("github");
});

test("without a token the tally is readable and nothing is `mine`", async () => {
  delete process.env.GITHUB_PAT;
  harness.healthy("github", (request) => {
    assert.equal(request.headers.get("authorization"), null, "no bearer travels without a token");
    assert.equal(new URL(request.url).pathname, "/repos/o/r/issues/7/reactions", "no viewer lookup without a token");
    return Response.json([{ id: 11, content: "+1", user: { login: "octocat" } }]);
  });
  try {
    harness.reset();
    assert.deepEqual(await (await read()).json(), { ok: true, reactions: [{ content: "+1", count: 1, mine: null }] });
    assert.equal(harness.calls("github").length, 1);
    assert.equal((await add()).status, 401, "a write without a token is auth_required");
  } finally {
    process.env.GITHUB_PAT = TOKEN;
  }
});

test("the reaction calls carry no deadline (finding, not a contract)", async () => {
  assert.ok(harness.calls("github").every((call) => call.hasDeadline === false));
});
