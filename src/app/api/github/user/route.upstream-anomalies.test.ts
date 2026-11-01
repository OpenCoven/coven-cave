// GET /api/github/user under every upstream anomaly (#6359).
//
// One public profile read. The route has no cache and no deadline, so the
// contract is simple: every upstream failure is a 502 with a reason, a
// GitHub 404 is a 404, and the PAT only ever travels as a bearer. The one
// soft spot the matrix pins is schema drift: a well-formed body of the wrong
// shape is still rendered as a profile rather than refused.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-user-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_user_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (url.pathname === "/users/octocat") {
    return Response.json({
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/583231",
      html_url: "https://github.com/octocat",
      bio: null,
      company: "@github",
      location: "San Francisco",
      blog: "github.blog",
      twitter_username: null,
      type: "User",
      followers: 10,
      following: 2,
      public_repos: 8,
      created_at: "2011-01-25T18:44:36Z",
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const read = () => GET(new Request("http://localhost/api/github/user?login=octocat"));

const githubError = (status: number, upstream: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, `github error (${upstream})`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

test("GET /api/github/user across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as { ok: boolean; login: string; blog: string | null; followers: number; type: string };
      assert.equal(body.ok, true);
      assert.equal(body.login, "octocat");
      assert.equal(body.blog, "https://github.blog", "a bare domain gains a scheme");
      assert.equal(body.followers, 10);
      assert.equal(body.type, "User");
    },
    degraded: {
      "http-500": githubError(502, 500),
      "http-502": githubError(502, 502),
      // A revoked token is reported as an upstream error, not a reconnect
      // prompt: profiles are public, so the route never treats 401 specially.
      "auth-revoked": githubError(502, 401),
      "rate-limit": githubError(502, 429),
      timeout: unreachable,
      network: (outcome, anomaly) => {
        unreachable(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /fetch failed/);
      },
      // An unreadable body on a 200 is reported with the upstream status.
      "malformed-json": githubError(502, 200),
      "empty-body": githubError(502, 200),
      "schema-drift": (outcome) => {
        // The route accepts any JSON object as a profile; the drifted body is
        // rendered with zeroed counts instead of refused.
        assert.equal(outcome.status, 200);
        const body = outcome.body as { ok: boolean; login: unknown; followers: number; name: string | null };
        assert.equal(body.ok, true);
        assert.equal(typeof body.login, "string");
        assert.equal(body.followers, 0);
        assert.equal(body.name, null);
      },
    },
  });
});

test("a GitHub 404 is a not_found, a 403 passes through as 403", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  let response = await read();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "not_found" });

  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  response = await read();
  assert.equal(response.status, 403);
  harness.heal("github");
  assert.equal((await read()).status, 200);
});

test("an invalid login never reaches GitHub", async () => {
  harness.reset();
  const response = await GET(new Request("http://localhost/api/github/user?login=dependabot%5Bbot%5D"));
  assert.equal(response.status, 400);
  assert.equal(harness.calls().length, 0);
});
