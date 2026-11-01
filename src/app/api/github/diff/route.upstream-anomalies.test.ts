// GET /api/github/diff under every upstream anomaly (#6359).
//
// Two sequential upstream calls, both required: the pull's revision (head,
// base) and then the three-dot comparison between them. The revision read
// surfaces failure as a typed GitHubRevisionError that the route maps to a
// status; a torn or empty revision body throws a SyntaxError that the same
// catch turns into a 502. Nothing is cached and no call carries a deadline.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch, type UpstreamHandler } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-diff-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_diff_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGE_BASE = "c".repeat(40);
const PULL = "/repos/OpenCoven/coven-cave/pulls/7";
const COMPARE = `/repos/OpenCoven/coven-cave/compare/${BASE}...${HEAD}`;

const github = (failing: { path: string; status: number } | null = null): UpstreamHandler => (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (failing && url.pathname === failing.path) {
    return Response.json({ message: "forced" }, { status: failing.status });
  }
  if (url.pathname === PULL) {
    return Response.json({ head: { sha: HEAD }, base: { sha: BASE, ref: "main" } });
  }
  if (url.pathname === COMPARE) {
    assert.equal(url.searchParams.get("per_page"), "1");
    return Response.json({
      base_commit: { sha: BASE },
      merge_base_commit: { sha: MERGE_BASE },
      files: [
        { filename: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+a" },
        { filename: "image.png", status: "added", additions: 0, deletions: 0 },
      ],
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
};
harness.healthy("github", github());

const read = () => GET(new Request("http://localhost/api/github/diff?repo=OpenCoven%2Fcoven-cave&number=7"));

const githubError = (status: number, upstream: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, `github error (${upstream})`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

test("GET /api/github/diff across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        revision: { repo: "OpenCoven/coven-cave", number: 7, headSha: HEAD, baseSha: BASE, baseRef: "main", mergeBaseSha: MERGE_BASE },
        truncated: false,
        total: 2,
        files: [
          { filename: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+a", noPatchReason: null },
          { filename: "image.png", status: "added", additions: 0, deletions: 0, patch: null, noPatchReason: "github" },
        ],
      });
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
      // The revision reader parses without a guard; the SyntaxError is caught
      // by the route and answered as a 502 carrying the parser's message.
      "malformed-json": unreachable,
      "empty-body": unreachable,
      "schema-drift": (outcome, anomaly) => {
        expectErrorStatus(502)(outcome, anomaly);
        assert.equal((outcome.body as { error: string }).error, "Pull request revision is unavailable.");
      },
    },
  });
});

test("a comparison outage after a good revision is still a 502, and a 404 a not_found", async () => {
  harness.healthy("github", github({ path: COMPARE, status: 500 }));
  let response = await read();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "github error (500)" });

  harness.healthy("github", github({ path: COMPARE, status: 404 }));
  response = await read();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "not_found" });

  harness.healthy("github", github());
  assert.equal((await read()).status, 200);
});

test("a GitHub 404 or 403 on the pull keeps its status", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.deepEqual(await (await read()).json(), { ok: false, error: "not_found" });
  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  assert.equal((await read()).status, 403);
  harness.heal("github");
  assert.equal((await read()).status, 200);
});
