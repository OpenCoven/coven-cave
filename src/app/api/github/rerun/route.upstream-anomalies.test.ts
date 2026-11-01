// POST /api/github/rerun under every upstream anomaly (#6359).
//
// A re-run is accepted on any 2xx and never reads the body on success, so an
// unreadable or drifted 200 is still "re-run requested" — GitHub answers 201
// with an empty object, and the route rightly does not depend on it. Every
// non-2xx is `ok: false` with GitHub's own message when there is one.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-rerun-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "POST" && url.pathname === "/repos/o/r/actions/runs/4242/rerun-failed-jobs") {
    return Response.json({}, { status: 201 });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const rerun = () =>
  POST(
    new Request("http://localhost/api/github/rerun", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", runId: 4242 }),
    }),
  );

const failsWith = (status: number, error: string) => (outcome: MatrixOutcome) => {
  expectErrorStatus(status)(outcome, { kind: "http", status });
  assert.equal((outcome.body as { error: string }).error, error);
};

const rerunRequested = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  assert.deepEqual(outcome.body, { ok: true });
};

test("POST /api/github/rerun across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: rerun,
    healthy: rerunRequested,
    degraded: {
      "http-500": failsWith(502, "Internal Server Error"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "Bad credentials"),
      "rate-limit": failsWith(502, "API rate limit exceeded"),
      timeout: (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /timeout/i);
      },
      network: failsWith(502, "fetch failed"),
      // Success is the status alone: the body is never read on a 2xx.
      "malformed-json": rerunRequested,
      "empty-body": rerunRequested,
      "schema-drift": rerunRequested,
    },
  });
});

test("a 403 keeps its status and GitHub's reason", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "This run cannot be re-run" } });
  const response = await rerun();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "This run cannot be re-run" });
  harness.heal("github");
});

test("failedOnly:false targets the full rerun endpoint", async () => {
  harness.healthy("github", (request) => {
    assert.equal(new URL(request.url).pathname, "/repos/o/r/actions/runs/4242/rerun");
    return Response.json({}, { status: 201 });
  });
  const response = await POST(
    new Request("http://localhost/api/github/rerun", {
      method: "POST",
      body: JSON.stringify({ repo: "o/r", runId: 4242, failedOnly: false }),
    }),
  );
  assert.equal(response.status, 200);
});

test("the rerun call carries no deadline (finding, not a contract)", async () => {
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, false);
});
