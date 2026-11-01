// POST /api/asana/pat under every upstream anomaly (#6359).
//
// Mirrors /api/github/pat: the only upstream question is "is this token
// good?", and the only honest answers are yes, no, and "not now". Before
// #6359 any non-2xx — a 500, a 429 — was reported as "invalid or expired"
// (422), which sent a user with a perfectly good token off to mint a new one
// during an Asana outage. Now only Asana's own 401/403 verdict rejects the
// token; everything else is a 503 with a retry hint, and the pasted token
// never appears in a body.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("asana-pat-anomalies");
delete process.env.ASANA_PAT;
delete process.env.ASANA_USER;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const PAT = "asana-testonly-never-dispatched-1234567890";

harness.healthy("asana", (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/1.0/users/me") {
    assert.equal(request.headers.get("authorization"), `Bearer ${PAT}`, "the token travels as a bearer and nowhere else");
    return Response.json({ data: { gid: "u1", name: "Val", email: "val@example.test" } });
  }
  return Response.json({ errors: [{ message: "Not Found" }] }, { status: 404 });
});

const connect = () =>
  POST(
    new Request("http://localhost/api/asana/pat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pat: PAT }),
    }) as never,
  );

const validButAnonymous = (outcome: MatrixOutcome) => {
  // Asana said the token is fine but the identity body was unreadable: the
  // token is stored and the login stays unknown rather than the connect failing.
  assert.equal(outcome.status, 200, outcome.text);
  assert.equal((outcome.body as { ok: boolean }).ok, true);
  assert.equal((outcome.body as { login: unknown }).login, null);
};

test("POST /api/asana/pat across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "asana",
    secrets: [PAT],
    invoke: connect,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true, login: "Val", patStoredIn: "encrypted" });
      assert.equal(process.env.ASANA_PAT, PAT, "the validated token is injected for the running process");
    },
    degraded: {
      "auth-revoked": (outcome) => {
        expectErrorStatus(422)(outcome, { kind: "auth-revoked" });
        assert.match((outcome.body as { error: string }).error, /invalid or expired/);
      },
      "http-500": (outcome, anomaly) => {
        expectErrorStatus(503)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /try again/, "an outage is 'not now', never 'bad token'");
      },
      "http-502": expectErrorStatus(503),
      "rate-limit": (outcome, anomaly) => {
        expectErrorStatus(503)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /try again/, "a rate limit asks for a retry, not a new token");
      },
      timeout: expectErrorStatus(503),
      network: (outcome, anomaly) => {
        expectErrorStatus(503)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /reach Asana/);
      },
      "malformed-json": validButAnonymous,
      "empty-body": validButAnonymous,
      "schema-drift": validButAnonymous,
    },
  });
});

test("a 403 is Asana's own verdict on the credential: 422, not 503", async () => {
  harness.inject("asana", { kind: "http", status: 403, body: { errors: [{ message: "Forbidden" }] } });
  const response = await connect();
  assert.equal(response.status, 422);
  harness.heal("asana");
  assert.equal((await connect()).status, 200);
});

test("the token validation call carries a deadline", () => {
  const call = harness.calls("asana").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true, "an unbounded validation would hang the connect flow on a stalled socket");
});
