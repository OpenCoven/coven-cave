// POST /api/github/dispatch under every upstream anomaly (#6359).
//
// `workflow_dispatch` succeeds only as 204 No Content, so every 200 with a
// body — torn, empty or drifted — is a failure here, which is the strictest
// contract in the GitHub write family. GitHub's own `message` is passed
// through verbatim when the body carries one; a 403 keeps its status, every
// other failure is a 502.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-dispatch-anomalies");
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
  if (request.method === "POST" && url.pathname === "/repos/o/r/actions/workflows/ci.yml/dispatches") {
    assert.deepEqual(await request.json(), { ref: "main", inputs: { lane: "soak" } });
    return new Response(null, { status: 204 });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const dispatch = () =>
  POST(
    new Request("http://localhost/api/github/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", workflow: "ci.yml", ref: "main", inputs: { lane: "soak", count: 3 } }),
    }),
  );

const failsWith = (status: number, error: string) => (outcome: MatrixOutcome) => {
  expectErrorStatus(status)(outcome, { kind: "http", status });
  assert.equal((outcome.body as { error: string }).error, error);
};

test("POST /api/github/dispatch across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: dispatch,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true });
    },
    degraded: {
      // GitHub's own message is the error when the body carries one.
      "http-500": failsWith(502, "Internal Server Error"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "Bad credentials"),
      "rate-limit": failsWith(502, "API rate limit exceeded"),
      timeout: (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /timeout/i);
      },
      network: failsWith(502, "fetch failed"),
      // Anything but 204 is a failure, a readable 200 included.
      "malformed-json": failsWith(502, "github error (200)"),
      "empty-body": failsWith(502, "github error (200)"),
      "schema-drift": failsWith(502, "github error (200)"),
    },
  });
});

test("a 403 keeps its status and GitHub's reason", async () => {
  harness.inject("github", { kind: "http", status: 403, body: { message: "Resource not accessible by integration" } });
  const response = await dispatch();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "Resource not accessible by integration" });
  harness.heal("github");
});

test("a stalled socket after the dispatch was sent is a plain failure (a retry may dispatch twice)", async () => {
  harness.inject("github", { kind: "timeout" });
  const body = await (await dispatch()).json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(JSON.stringify(body), /unknown|may have/i);
  harness.heal("github");
});

test("the dispatch call carries no deadline (finding, not a contract)", async () => {
  harness.reset();
  await dispatch();
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, false);
});
