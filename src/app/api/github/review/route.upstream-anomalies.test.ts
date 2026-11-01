// POST /api/github/review under every upstream anomaly (#6359).
//
// Same two shapes as merge. With a reviewed head the PR is read first and an
// unreadable PR means no verdict is submitted. Without a head the review
// POST itself is driven through the matrix: GitHub's own message passes
// through, a 403 keeps its status, and — pinned rather than endorsed — a
// drifted 200 is accepted as a submitted review with an empty id.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-review-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

harness.healthy("github", async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "GET" && url.pathname === "/repos/o/r/pulls/7") {
    return Response.json({ head: { sha: HEAD }, base: { sha: BASE, ref: "main" } });
  }
  if (request.method === "POST" && url.pathname === "/repos/o/r/pulls/7/reviews") {
    const sent = (await request.json()) as { event: string; body?: string; commit_id?: string };
    assert.equal(sent.event, "APPROVE");
    return Response.json({ id: 77, state: "APPROVED", html_url: "https://github.com/o/r/pull/7#pullrequestreview-77" });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const review = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/github/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", number: 7, event: "APPROVE", body: "Reviewed this change.", ...extra }),
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
const submitted = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  assert.deepEqual(outcome.body, { ok: true, review: { id: "77", state: "APPROVED", url: "https://github.com/o/r/pull/7#pullrequestreview-77" } });
};

test("POST /api/github/review with a reviewed head across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: () => review({ headSha: HEAD }),
    healthy: (outcome) => {
      submitted(outcome);
      assert.deepEqual(harness.calls("github").map((call) => call.method), ["GET", "POST"]);
      assert.equal(JSON.parse(harness.calls("github")[1].body ?? "{}").commit_id, HEAD, "the verdict is pinned to the reviewed head");
    },
    degraded: {
      "http-500": failsWith(502, "github error (500)"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "github error (401)"),
      "rate-limit": failsWith(502, "github error (429)"),
      timeout: timesOut,
      network: failsWith(502, "fetch failed"),
      "malformed-json": expectErrorStatus(502),
      "empty-body": expectErrorStatus(502),
      "schema-drift": failsWith(502, "Pull request revision is unavailable."),
      // Every degraded answer above must also have stopped before the POST.
    },
    beforeHeal: () => {
      assert.deepEqual(harness.calls("github").map((call) => call.method), ["GET"], "an unreadable PR means no verdict is submitted");
    },
  });
});

test("POST /api/github/review without a head across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: () => review(),
    healthy: (outcome) => {
      submitted(outcome);
      assert.deepEqual(harness.calls("github").map((call) => call.method), ["POST"]);
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
        // Pinned, not endorsed: a drifted 200 is a submitted review with no id.
        assert.equal(outcome.status, 200);
        assert.deepEqual(outcome.body, { ok: true, review: { id: "", state: "APPROVE", url: null } });
      },
    },
  });
});

test("a moved head is a 409 and no verdict is sent", async () => {
  harness.reset();
  const response = await review({ headSha: "d".repeat(40) });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /revision changed/i);
  assert.deepEqual(harness.calls("github").map((call) => call.method), ["GET"]);
});

test("a 403 keeps its status and GitHub's own reason", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "Can not approve your own pull request" } });
  const response = await review();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "Can not approve your own pull request" });
  harness.heal("github");
});

test("a 404 on the revision read is passed through as not_found", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  const response = await review({ headSha: HEAD });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "not_found" });
  harness.heal("github");
});

test("a stalled socket on the review POST is a plain failure (a retry re-submits)", async () => {
  harness.inject("github", { kind: "timeout" });
  const body = await (await review()).json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(JSON.stringify(body), /unknown|may have/i);
  harness.heal("github");
});

test("the review calls carry no deadline (finding, not a contract)", async () => {
  assert.ok(harness.calls("github").length >= 1);
  assert.ok(harness.calls("github").every((call) => call.hasDeadline === false));
});
