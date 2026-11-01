// POST /api/github/comment under every upstream anomaly (#6359).
//
// One write, one upstream call. The contract under anomaly is "ok: false with
// a status GitHub's own answer earns": a 403 passes through, everything else
// is a 502, and a 200 the route cannot read is reported as a failure too.
// The one soft spot the matrix pins rather than hides: a well-formed body of
// the wrong shape is accepted as a posted comment with an empty id.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-comment-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

harness.healthy("github", async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (request.method === "POST" && url.pathname === "/repos/o/r/issues/7/comments") {
    const sent = (await request.json()) as { body: string };
    return Response.json(
      {
        id: 101,
        body: sent.body,
        user: { login: "octocat", avatar_url: "https://avatars.example/octocat", html_url: "https://github.com/octocat" },
        created_at: "2026-11-01T08:00:00Z",
        html_url: "https://github.com/o/r/issues/7#issuecomment-101",
        author_association: "MEMBER",
      },
      { status: 201 },
    );
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const post = () =>
  POST(
    new Request("http://localhost/api/github/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", number: 7, body: "  Looks good.  " }),
    }),
  );

/** `ok: false` with a 502 and the route's own "github error (N)" string. */
const githubError = (upstreamStatus: number) => (outcome: MatrixOutcome) => {
  expectErrorStatus(502)(outcome, { kind: "http", status: upstreamStatus });
  assert.equal((outcome.body as { error: string }).error, `github error (${upstreamStatus})`);
};

test("POST /api/github/comment across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: post,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        comment: {
          id: "101",
          author: { login: "octocat", avatarUrl: "https://avatars.example/octocat", url: "https://github.com/octocat" },
          body: "Looks good.",
          createdAt: "2026-11-01T08:00:00Z",
          url: "https://github.com/o/r/issues/7#issuecomment-101",
          authorAssociation: "MEMBER",
        },
      });
      const call = harness.calls("github").at(-1);
      assert.ok(call);
      assert.equal(call.body, JSON.stringify({ body: "Looks good." }), "the trimmed body is what is posted");
    },
    degraded: {
      "http-500": githubError(500),
      "http-502": githubError(502),
      // Only a 403 passes through; a revoked token is a generic 502 here.
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
      // A 200 the route cannot read is reported as a GitHub error, status and all.
      "malformed-json": githubError(200),
      "empty-body": githubError(200),
      "schema-drift": (outcome) => {
        // Pinned, not endorsed: a well-formed body of the wrong shape is taken
        // as a posted comment whose id is unknown.
        assert.equal(outcome.status, 200);
        const body = outcome.body as { ok: boolean; comment: { id: string; author: unknown; body: string } };
        assert.equal(body.ok, true);
        assert.equal(body.comment.id, "");
        assert.equal(body.comment.author, null);
        assert.equal(body.comment.body, "Looks good.", "the local text stands in for the echo");
      },
    },
  });
});

test("a 403 from GitHub is passed through as the caller's own 403", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "Resource not accessible by personal access token" } });
  const response = await post();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "github error (403)" });
  harness.heal("github");
  assert.equal((await post()).status, 200);
});

test("a failure after the comment was sent is an ok:false the caller may retry (no unknown-outcome state)", async () => {
  // The route has no "may have succeeded" answer: a 5xx or a stalled socket
  // after the POST left the box is reported exactly like a refusal, so a user
  // retry can post the comment twice. Pinned here so a change is deliberate.
  harness.inject("github", { kind: "timeout" });
  const response = await post();
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(JSON.stringify(body), /unknown|may have/i);
  harness.heal("github");
});

test("the comment call carries no deadline (finding, not a contract)", async () => {
  harness.reset();
  await post();
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, false, "update this test when the route gains an AbortSignal");
});
