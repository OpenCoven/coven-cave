// POST /api/github/reply under every upstream anomaly (#6359).
//
// The review-thread twin of /api/github/comment: one write to GitHub's
// review-comment replies endpoint. A 403 passes through, every other failure
// is a 502 with "github error (N)", an unreadable 200 is a failure too, and a
// drifted 200 is accepted as a reply with an empty id (pinned, not endorsed).
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-reply-anomalies");
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
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "POST" && url.pathname === "/repos/o/r/pulls/7/comments/55/replies") {
    const sent = (await request.json()) as { body: string };
    return Response.json(
      {
        id: 56,
        body: sent.body,
        user: { login: "octocat", avatar_url: null, html_url: "https://github.com/octocat" },
        created_at: "2026-11-01T08:00:00Z",
        html_url: "https://github.com/o/r/pull/7#discussion_r56",
        author_association: "OWNER",
      },
      { status: 201 },
    );
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const reply = () =>
  POST(
    new Request("http://localhost/api/github/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", number: 7, commentId: "55", body: "Done in the next push." }),
    }),
  );

const githubError = (upstreamStatus: number) => (outcome: MatrixOutcome) => {
  expectErrorStatus(502)(outcome, { kind: "http", status: upstreamStatus });
  assert.equal((outcome.body as { error: string }).error, `github error (${upstreamStatus})`);
};

test("POST /api/github/reply across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: reply,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        comment: {
          id: "56",
          author: { login: "octocat", avatarUrl: null, url: "https://github.com/octocat" },
          body: "Done in the next push.",
          createdAt: "2026-11-01T08:00:00Z",
          url: "https://github.com/o/r/pull/7#discussion_r56",
          authorAssociation: "OWNER",
        },
      });
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
      "malformed-json": githubError(200),
      "empty-body": githubError(200),
      "schema-drift": (outcome) => {
        assert.equal(outcome.status, 200);
        const body = outcome.body as { ok: boolean; comment: { id: string; author: unknown; body: string } };
        assert.equal(body.ok, true);
        assert.equal(body.comment.id, "");
        assert.equal(body.comment.author, null);
        assert.equal(body.comment.body, "Done in the next push.");
      },
    },
  });
});

test("a 403 from GitHub is passed through as the caller's own 403", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  const response = await reply();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "github error (403)" });
  harness.heal("github");
});

test("a stalled socket after the reply was sent is reported as a plain failure (a retry may double-post)", async () => {
  harness.inject("github", { kind: "timeout" });
  const body = await (await reply()).json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(JSON.stringify(body), /unknown|may have/i, "no unknown-outcome contract exists; pinned so a change is deliberate");
  harness.heal("github");
});

test("the reply call carries no deadline (finding, not a contract)", async () => {
  harness.reset();
  await reply();
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, false);
});
