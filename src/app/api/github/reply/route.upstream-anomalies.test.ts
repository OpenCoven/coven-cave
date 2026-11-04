// POST /api/github/reply under every upstream anomaly (#6359).
//
// The review-thread twin of /api/github/comment: one write to GitHub's
// review-comment replies endpoint. A 403 passes through, every other failure
// is a 502 with "github error (N)", and a 2xx that is unreadable or carries
// no reply id is an ambiguous write: the reply may exist (#6368).
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectAmbiguousWrite, expectCredentialReconnect, expectErrorStatus, expectRateLimitRetry, runUpstreamAnomalyMatrix } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
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

test("POST /api/github/reply across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    expectLiveDetection: true,
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
      "http-500": expectAmbiguousWrite,
      "http-502": expectAmbiguousWrite,
      "auth-revoked": expectCredentialReconnect,
      "rate-limit": expectRateLimitRetry,
      timeout: expectAmbiguousWrite,
      network: (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.equal((outcome.body as { error: string }).error, "fetch failed");
      },
      "malformed-json": expectAmbiguousWrite,
      "empty-body": expectAmbiguousWrite,
      "schema-drift": expectAmbiguousWrite,
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

test("a write that may have reached GitHub is outcome-unknown, never a plain retryable failure (#6369)", async () => {
  // A stalled socket after the request left, or a reset mid-flight, may come
  // after GitHub acted. The answer says so, so a retry cannot silently post twice.
  for (const anomaly of [
    { kind: "timeout" },
    { kind: "http", status: 503, body: { message: "Service Unavailable" } },
  ] as const) {
    harness.inject("github", anomaly);
    const response = await reply();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "ambiguous-write");
    assert.equal(body.dispatched, true);
    harness.heal("github");
  }
});

test("a reply whose connection never opened is a plain failure the caller may retry (#6369)", async () => {
  harness.inject("github", { kind: "network" });
  const body = await (await reply()).json();
  assert.equal(body.ok, false);
  assert.notEqual(body.code, "ambiguous-write");
  assert.notEqual(body.dispatched, true);
  harness.heal("github");
});

test("the reply call carries a deadline through upstreamFetch", async () => {
  harness.reset();
  await reply();
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true);
});
