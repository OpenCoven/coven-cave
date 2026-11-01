// POST /api/github/pat under every upstream anomaly (#6359).
//
// The route's one upstream question is "is this token good?", and the only
// answers GitHub can give are yes, no, and "not now". The matrix proves the
// third never masquerades as the second: an outage, a rate limit, a stalled
// socket and a dead network all come back 503 with a retry hint, a revoked
// token alone comes back 422, and the pasted token never appears in a body.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-pat-anomalies");
delete process.env.GITHUB_PAT;
delete process.env.GITHUB_TOKEN;
delete process.env.GITHUB_USERNAME;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const PAT = "ghp_testonly_never_dispatched_0123456789abcdef";

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/user") {
    assert.equal(request.headers.get("authorization"), `Bearer ${PAT}`, "the token travels as a bearer and nowhere else");
    return Response.json({ login: "octocat", id: 1 });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const connect = () =>
  POST(
    new Request("http://localhost/api/github/pat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pat: PAT }),
    }) as never,
  );

const validButAnonymous = (outcome: MatrixOutcome) => {
  // GitHub said the token is fine but the identity body was unreadable: the
  // token is stored and the login stays unknown rather than the connect failing.
  assert.equal(outcome.status, 200);
  assert.equal((outcome.body as { ok: boolean }).ok, true);
  assert.equal((outcome.body as { login: unknown }).login, null);
};

test("POST /api/github/pat across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [PAT],
    invoke: connect,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true, login: "octocat", patStoredIn: "encrypted" });
      assert.equal(process.env.GITHUB_PAT, PAT, "the validated token is injected for the running process");
    },
    degraded: {
      "auth-revoked": (outcome) => {
        expectErrorStatus(422)(outcome, { kind: "auth-revoked" });
        assert.match((outcome.body as { error: string }).error, /invalid or lacks required scopes/);
      },
      "http-500": expectErrorStatus(503),
      "http-502": expectErrorStatus(503),
      "rate-limit": (outcome, anomaly) => {
        expectErrorStatus(503)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /try again/, "a rate limit asks for a retry, not a new token");
      },
      timeout: expectErrorStatus(503),
      network: (outcome, anomaly) => {
        expectErrorStatus(503)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /reach GitHub/);
      },
      "malformed-json": validButAnonymous,
      "empty-body": validButAnonymous,
      "schema-drift": validButAnonymous,
    },
  });
});

test("a primary rate limit (403 with no remaining budget) is 'not now', not 'bad token'", async () => {
  harness.inject("github", { kind: "rate-limit", status: 403 });
  const response = await connect();
  assert.equal(response.status, 503);
  harness.heal("github");
  assert.equal((await connect()).status, 200);
});

test("the token validation call carries a deadline", () => {
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true, "an unbounded validation would hang the connect flow on a stalled socket");
});
