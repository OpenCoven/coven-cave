// POST /api/github/dispatch under every upstream anomaly (#6359).
//
// Any 2xx is GitHub accepting the dispatch (204, or 200 with run details);
// the body is never needed, so a torn, empty or drifted 2xx is still
// accepted rather than reported as a failure that invites a second dispatch.
// A 5xx or a stalled socket after the request left is an ambiguous write;
// a connection that never opened is a plain, retryable failure (#6369).
// GitHub's own `message` passes through on a refusal; a 403 keeps its status.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectPatInvalid, expectRateLimited,expectAmbiguousWrite, expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
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

const dispatched = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  assert.deepEqual(outcome.body, { ok: true });
};

const failsWith = (status: number, error: string) => (outcome: MatrixOutcome) => {
  expectErrorStatus(status)(outcome, { kind: "http", status });
  assert.equal((outcome.body as { error: string }).error, error);
};

test("POST /api/github/dispatch across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    expectLiveDetection: true,
    invoke: dispatch,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true });
    },
    degraded: {
      // GitHub's own message is the error when the body carries one.
      "http-500": expectAmbiguousWrite,
      "http-502": expectAmbiguousWrite,
      "auth-revoked": expectPatInvalid,
      "rate-limit": expectRateLimited,
      timeout: expectAmbiguousWrite,
      network: failsWith(502, "fetch failed"),
      // Anything but 204 is a failure, a readable 200 included.
      "malformed-json": dispatched,
      "empty-body": dispatched,
      "schema-drift": dispatched,
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

test("a write that may have reached GitHub is outcome-unknown, never a plain retryable failure (#6369)", async () => {
  // A stalled socket after the request left, or a reset mid-flight, may come
  // after GitHub acted. The answer says so, so a retry cannot silently post twice.
  for (const anomaly of [
    { kind: "timeout" },
    { kind: "http", status: 503, body: { message: "Service Unavailable" } },
  ] as const) {
    harness.inject("github", anomaly);
    const response = await dispatch();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "ambiguous-write");
    assert.equal(body.dispatched, true);
    harness.heal("github");
  }
});

test("a workflow dispatch whose connection never opened is a plain failure the caller may retry (#6369)", async () => {
  harness.inject("github", { kind: "network" });
  const body = await (await dispatch()).json();
  assert.equal(body.ok, false);
  assert.notEqual(body.code, "ambiguous-write");
  assert.notEqual(body.dispatched, true);
  harness.heal("github");
});

test("the dispatch call carries a deadline through upstreamFetch", async () => {
  harness.reset();
  await dispatch();
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, true);
});
