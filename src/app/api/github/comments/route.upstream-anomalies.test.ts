// GET /api/github/comments under every upstream anomaly (#6359).
//
// Three upstream calls per PR answer: the conversation timeline over REST,
// then review threads (GraphQL) and review summaries (REST) in parallel. The
// timeline is load-bearing — when it fails the whole read is `ok: false`, a
// 403 keeping its status and everything else a 502 — while the two review
// slices fail soft inside a 200 as `reviewEvidenceComplete: false`, which the
// existing route test covers per slice. The matrix drives the whole upstream
// down, so it is the timeline's contract that is pinned here, plus the proof
// that a read served while GitHub was down is not remembered once it is back.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-comments-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "GET" && url.pathname === "/repos/o/r/issues/7/comments") {
    assert.equal(url.searchParams.get("per_page"), "100");
    return Response.json([
      {
        id: 1,
        body: "First!",
        user: { login: "octocat", avatar_url: "https://avatars.example/octocat", html_url: "https://github.com/octocat" },
        created_at: "2026-11-01T08:00:00Z",
        html_url: "https://github.com/o/r/pull/7#issuecomment-1",
        author_association: "MEMBER",
        reactions: { "+1": 2, heart: 0 },
      },
    ]);
  }
  if (request.method === "GET" && url.pathname === "/repos/o/r/pulls/7/reviews") {
    return Response.json([
      { id: 9, state: "APPROVED", body: "", user: { login: "reviewer" }, submitted_at: "2026-11-01T09:00:00Z", html_url: "https://github.com/o/r/pull/7#pullrequestreview-9", author_association: "OWNER" },
      { id: 10, state: "COMMENTED", body: "", user: { login: "reviewer" } },
    ]);
  }
  if (request.method === "POST" && url.pathname === "/graphql") {
    return Response.json({
      data: { repository: { pullRequest: { reviewThreads: {
        pageInfo: { hasNextPage: false },
        nodes: [{
          id: "PRRT_1", isResolved: false, isOutdated: false, line: 42,
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{
              databaseId: 55, author: { login: "reviewer", avatarUrl: null, url: null }, replyTo: null,
              body: "Rename this.", createdAt: "2026-11-01T09:00:00Z", path: "src/example.ts", diffHunk: "@@ -1 +1 @@",
              url: "https://github.com/o/r/pull/7#discussion_r55", authorAssociation: "OWNER",
              reactionGroups: [{ content: "THUMBS_UP", reactors: { totalCount: 1 } }],
            }],
          },
        }],
      } } } },
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const read = () => GET(new Request("http://localhost/api/github/comments?repo=o/r&number=7&isPull=1"));

const failsWith = (status: number, error: string) => (outcome: MatrixOutcome) => {
  expectErrorStatus(status)(outcome, { kind: "http", status });
  assert.equal((outcome.body as { error: string }).error, error);
};

test("GET /api/github/comments across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as {
        ok: boolean; authed: boolean; canResolve: boolean; reviewEvidenceComplete: boolean; reviewEvidenceError: unknown;
        issueComments: Array<{ id: string; body: string; reactions: unknown }>;
        reviews: Array<{ id: string; state: string }>;
        reviewThreads: Array<{ id: string; path: string | null; line: number | null; comments: Array<{ id: string; reactions: unknown }> }>;
      };
      assert.equal(body.ok, true);
      assert.equal(body.authed, true);
      assert.equal(body.canResolve, true);
      assert.equal(body.reviewEvidenceComplete, true);
      assert.equal(body.reviewEvidenceError, null);
      assert.deepEqual(body.issueComments.map((c) => [c.id, c.body, c.reactions]), [["1", "First!", [{ content: "+1", count: 2 }]]]);
      assert.deepEqual(body.reviews.map((r) => [r.id, r.state]), [["9", "APPROVED"]], "an empty COMMENTED container is dropped");
      assert.deepEqual(body.reviewThreads.map((t) => [t.id, t.path, t.line, t.comments[0].id, t.comments[0].reactions]), [
        ["PRRT_1", "src/example.ts", 42, "55", [{ content: "+1", count: 1 }]],
      ]);
      assert.equal(harness.calls("github").length, 3, "timeline, threads and reviews are all read");
    },
    degraded: {
      "http-500": failsWith(502, "github error (500)"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "github error (401)"),
      "rate-limit": failsWith(502, "github error (429)"),
      timeout: (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /timeout/i);
      },
      network: failsWith(502, "fetch failed"),
      "malformed-json": failsWith(502, "github error (200)"),
      "empty-body": failsWith(502, "github error (200)"),
      "schema-drift": failsWith(502, "github error (200)"),
    },
  });
});

test("a 403 on the timeline keeps its status", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  const response = await read();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "github error (403)" });
  harness.heal("github");
});

test("only the review slices failing keeps the timeline readable and the evidence incomplete", async () => {
  // The harness degrades a whole upstream; a per-path failure is modelled in
  // the healthy handler so the timeline stays up while both review reads fail.
  harness.healthy("github", (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/repos/o/r/issues/7/comments") return Response.json([]);
    return Response.json({ message: "Service Unavailable" }, { status: 503 });
  });
  const body = await (await read()).json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.issueComments, []);
  assert.equal(body.reviewEvidenceComplete, false);
  assert.match(body.reviewEvidenceError, /threads are unavailable \(HTTP 503\)/);
  assert.match(body.reviewEvidenceError, /summaries are unavailable \(HTTP 503\)/);
});

test("an issue read never asks GraphQL and reports complete evidence", async () => {
  harness.healthy("github", (request) => {
    assert.equal(new URL(request.url).pathname, "/repos/o/r/issues/8/comments");
    return Response.json([]);
  });
  harness.reset();
  const body = await (await GET(new Request("http://localhost/api/github/comments?repo=o/r&number=8"))).json();
  assert.equal(body.ok, true);
  assert.equal(body.reviewEvidenceComplete, true);
  assert.equal(harness.calls("github").length, 1);
});

test("the comment reads carry no deadline (finding, not a contract)", async () => {
  assert.ok(harness.calls("github").length >= 1);
  assert.ok(harness.calls("github").every((call) => call.hasDeadline === false));
});
