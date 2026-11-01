// GET /api/github/checks under every upstream anomaly (#6359).
//
// Three upstream calls: the pull head, then its check runs and its combined
// status together. Identical concurrent asks share one run (#5627) but
// nothing is kept once it settles, so there is no hold to step past. A head
// that cannot be resolved is a 502; one unreadable side of the rollup leaves
// the other and demotes a passing verdict to pending, since a gate that could
// not read every signal must not claim green.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch, type UpstreamHandler } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-checks-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_checks_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const SHA = "a".repeat(40);
const PULL = "/repos/OpenCoven/coven-cave/pulls/7";
const RUNS = `/repos/OpenCoven/coven-cave/commits/${SHA}/check-runs`;
const STATUS = `/repos/OpenCoven/coven-cave/commits/${SHA}/status`;

const github = (failing: { path: string; status: number }[] = []): UpstreamHandler => (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  const forced = failing.find((entry) => entry.path === url.pathname);
  if (forced) return Response.json({ message: "forced" }, { status: forced.status });
  if (url.pathname === PULL) return Response.json({ head: { sha: SHA } });
  if (url.pathname === RUNS) {
    assert.equal(url.searchParams.get("per_page"), "100");
    return Response.json({
      total_count: 1,
      check_runs: [
        {
          id: 11,
          name: "Frontend build",
          status: "completed",
          conclusion: "success",
          started_at: "2026-10-31T12:00:00Z",
          completed_at: "2026-10-31T12:05:00Z",
          details_url: "https://github.com/OpenCoven/coven-cave/actions/runs/1/job/2",
          app: { name: "GitHub Actions", owner: { avatar_url: "https://avatars.githubusercontent.com/in/15368" } },
        },
      ],
    });
  }
  if (url.pathname === STATUS) {
    return Response.json({
      state: "success",
      total_count: 1,
      statuses: [{ context: "ci/vercel", state: "success", description: "Deployed", target_url: "https://vercel.com/x" }],
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
};
harness.healthy("github", github());

const read = () => GET(new Request("http://localhost/api/github/checks?repo=OpenCoven%2Fcoven-cave&number=7"));

const githubError = (status: number, upstream: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, `github error (${upstream})`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

type Checks = { ok: boolean; authed: boolean; sha: string; rollup: string | null; runs: Array<{ name: string; conclusion: string | null }>; statuses: Array<{ context: string; state: string }> };

test("GET /api/github/checks across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as Checks;
      assert.equal(body.ok, true);
      assert.equal(body.authed, true);
      assert.equal(body.sha, SHA);
      assert.equal(body.rollup, "passing");
      assert.deepEqual(body.runs.map((run) => [run.name, run.conclusion]), [["Frontend build", "success"]]);
      assert.deepEqual(body.statuses.map((status) => [status.context, status.state]), [["ci/vercel", "success"]]);
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
      // A head whose sha cannot be read is a 502 naming the upstream status,
      // whether the body was torn, empty, or merely the wrong shape.
      "malformed-json": githubError(502, 200),
      "empty-body": githubError(502, 200),
      "schema-drift": githubError(502, 200),
    },
  });
});

test("an unreadable check-runs side keeps the statuses and demotes passing to pending", async () => {
  harness.healthy("github", github([{ path: RUNS, status: 500 }]));
  const body = (await (await read()).json()) as Checks;
  assert.equal(body.ok, true);
  assert.deepEqual(body.runs, []);
  assert.equal(body.statuses.length, 1);
  assert.equal(body.rollup, "pending", "a green verdict needs every signal readable");
  harness.healthy("github", github());
});

test("an unreadable status side keeps the runs and demotes passing to pending", async () => {
  harness.healthy("github", github([{ path: STATUS, status: 500 }]));
  const body = (await (await read()).json()) as Checks;
  assert.equal(body.ok, true);
  assert.equal(body.runs.length, 1);
  assert.deepEqual(body.statuses, []);
  assert.equal(body.rollup, "pending");
  harness.healthy("github", github());
});

test("both rollup sides down is a 502 naming both statuses", async () => {
  harness.healthy("github", github([{ path: RUNS, status: 500 }, { path: STATUS, status: 502 }]));
  const response = await read();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "github error (500, 502)" });
  harness.healthy("github", github());
  assert.equal((await read()).status, 200);
});

test("a GitHub 404 on the pull is a not_found", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.deepEqual(await (await read()).json(), { ok: false, error: "not_found" });
  harness.heal("github");
  assert.equal((await read()).status, 200);
});
