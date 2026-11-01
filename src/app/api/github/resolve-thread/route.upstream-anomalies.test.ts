// POST /api/github/resolve-thread under every upstream anomaly (#6359).
//
// The only GraphQL write in the family. Failure is detected by HTTP status
// or a non-empty `errors` array; a 403 keeps its status, everything else is
// a 502. The soft spot the matrix pins rather than hides: a 200 whose body is
// unreadable or of the wrong shape has neither, so it is reported as
// `ok: true` with `isResolved: false` — the caller asked to resolve and is
// told it succeeded, with a state that says it did not.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-resolve-thread-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const THREAD = "PRRT_kwDOtest0001";

harness.healthy("github", async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "POST" && url.pathname === "/graphql") {
    const sent = (await request.json()) as { query: string; variables: { id: string } };
    assert.equal(sent.variables.id, THREAD);
    const resolving = sent.query.includes("resolveReviewThread(") && !sent.query.includes("unresolveReviewThread(");
    return Response.json({
      data: resolving
        ? { resolveReviewThread: { thread: { id: THREAD, isResolved: true } } }
        : { unresolveReviewThread: { thread: { id: THREAD, isResolved: false } } },
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const resolve = (resolved = true) =>
  POST(
    new Request("http://localhost/api/github/resolve-thread", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: THREAD, resolved }),
    }),
  );

const githubError = (upstreamStatus: number) => (outcome: MatrixOutcome) => {
  expectErrorStatus(502)(outcome, { kind: "http", status: upstreamStatus });
  assert.equal((outcome.body as { error: string }).error, `github error (${upstreamStatus})`);
};

// Pinned, not endorsed: no status failure and no `errors` key reads as success.
const claimedResolvedWithoutEvidence = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { ok: true, threadId: THREAD, isResolved: false });
};

test("POST /api/github/resolve-thread across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: () => resolve(true),
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true, threadId: THREAD, isResolved: true });
    },
    degraded: {
      "http-500": githubError(500),
      "http-502": githubError(502),
      "auth-revoked": githubError(401),
      "rate-limit": githubError(429),
      timeout: (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /timeout/i);
      },
      network: (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.equal((outcome.body as { error: string }).error, "fetch failed");
      },
      "malformed-json": claimedResolvedWithoutEvidence,
      "empty-body": claimedResolvedWithoutEvidence,
      "schema-drift": claimedResolvedWithoutEvidence,
    },
  });
});

test("unresolving sends the unresolve mutation and reports the new state", async () => {
  const body = await (await resolve(false)).json();
  assert.deepEqual(body, { ok: true, threadId: THREAD, isResolved: false });
});

test("a GraphQL 200 with errors is a failure carrying the first message", async () => {
  harness.inject("github", {
    kind: "http",
    status: 200,
    body: { data: null, errors: [{ message: "Could not resolve to a node with the global id" }] },
  });
  const response = await resolve();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "Could not resolve to a node with the global id" });
  harness.heal("github");
});

test("a 403 keeps its status", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  assert.equal((await resolve()).status, 403);
  harness.heal("github");
});

test("the mutation carries no deadline (finding, not a contract)", async () => {
  harness.reset();
  await resolve();
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, false);
});
