// GET /api/github/runs under every upstream anomaly (#6359).
//
// One read of a repo's recent workflow runs (or one run by id), no cache, no
// deadline. Every upstream failure is a 502 naming the upstream status; an
// unreadable 200 body is a 502 too. A drifted body is the soft spot: a
// well-formed object without `workflow_runs` renders as "no runs", and in
// by-id mode the drifted object itself is normalized into a run card.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-runs-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_runs_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const RUN = {
  id: 1001,
  name: "CI",
  run_number: 57,
  status: "completed",
  conclusion: "success",
  head_branch: "main",
  event: "push",
  created_at: "2026-10-31T12:00:00Z",
  html_url: "https://github.com/OpenCoven/coven-cave/actions/runs/1001",
};

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (url.pathname === "/repos/OpenCoven/coven-cave/actions/runs") {
    assert.equal(url.searchParams.get("per_page"), "20");
    assert.equal(url.searchParams.get("branch"), "main");
    return Response.json({ total_count: 1, workflow_runs: [RUN] });
  }
  if (url.pathname === "/repos/OpenCoven/coven-cave/actions/runs/1001") {
    return Response.json(RUN);
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const list = () => GET(new Request("http://localhost/api/github/runs?repo=OpenCoven%2Fcoven-cave&branch=main"));
const byId = () => GET(new Request("http://localhost/api/github/runs?repo=OpenCoven%2Fcoven-cave&id=1001"));

const NORMALIZED = {
  id: 1001,
  name: "CI",
  runNumber: 57,
  status: "completed",
  conclusion: "success",
  branch: "main",
  event: "push",
  createdAt: "2026-10-31T12:00:00Z",
  htmlUrl: "https://github.com/OpenCoven/coven-cave/actions/runs/1001",
};

const githubError = (status: number, upstream: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, `github error (${upstream})`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

test("GET /api/github/runs across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: list,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, { ok: true, authed: true, runs: [NORMALIZED] });
    },
    degraded: {
      "http-500": githubError(502, 500),
      "http-502": githubError(502, 502),
      "auth-revoked": githubError(502, 401),
      "rate-limit": githubError(502, 429),
      timeout: unreachable,
      network: (outcome, anomaly) => {
        unreachable(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /fetch failed/);
      },
      "malformed-json": githubError(502, 200),
      "empty-body": githubError(502, 200),
      "schema-drift": (outcome) => {
        // An object without `workflow_runs` is "no runs", not an error.
        assert.equal(outcome.status, 200);
        assert.deepEqual(outcome.body, { ok: true, authed: true, runs: [] });
      },
    },
  });
});

test("by id: the exact run is fetched and a drifted body still becomes one card", async () => {
  harness.heal("github");
  harness.reset();
  assert.deepEqual(await (await byId()).json(), { ok: true, authed: true, runs: [NORMALIZED] });
  assert.equal(harness.calls("github").length, 1);
  assert.match(harness.calls("github")[0].url, /\/actions\/runs\/1001$/);

  harness.inject("github", { kind: "schema-drift" });
  const drifted = await (await byId()).json();
  assert.equal(drifted.ok, true);
  assert.equal(drifted.runs.length, 1, "by-id mode normalizes whatever object GitHub returned");
  assert.equal(drifted.runs[0].id, 0);
  harness.heal("github");
});

test("a GitHub 404 is a not_found and a 403 passes through", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.deepEqual(await (await list()).json(), { ok: false, error: "not_found" });
  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  assert.equal((await list()).status, 403);
  harness.heal("github");
  assert.equal((await list()).status, 200);
});
