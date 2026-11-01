// GET /api/github/labels under every upstream anomaly (#6359).
//
// One list read with no cache and no deadline. The route forwards GitHub's
// own 401 and 403 (an unauthenticated read of a private repo is a real 401,
// not a configuration error) and reports everything else as 502. A body that
// is not an array — torn, empty, or drifted — is refused rather than rendered
// as an empty vocabulary, since "no labels" would let the composer offer
// nothing and look correct.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-labels-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_labels_0123456789";
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
  if (url.pathname === "/repos/OpenCoven/coven-cave/labels") {
    assert.equal(url.searchParams.get("per_page"), "100");
    return Response.json([
      { name: "bug", color: "d73a4a", description: "Something isn't working" },
      { name: "enhancement", color: "a2eeef", description: null },
      { color: "ffffff" },
    ]);
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const read = () => GET(new Request("http://localhost/api/github/labels?repo=OpenCoven%2Fcoven-cave"));

const githubError = (status: number, upstream: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, `github error (${upstream})`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

test("GET /api/github/labels across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        labels: [
          { name: "bug", color: "d73a4a", description: "Something isn't working" },
          { name: "enhancement", color: "a2eeef", description: null },
        ],
      });
    },
    degraded: {
      "http-500": githubError(502, 500),
      "http-502": githubError(502, 502),
      // GitHub's own 401 passes through: the route only says 401 when GitHub does.
      "auth-revoked": githubError(401, 401),
      "rate-limit": githubError(502, 429),
      timeout: unreachable,
      network: (outcome, anomaly) => {
        unreachable(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /fetch failed/);
      },
      "malformed-json": githubError(502, 200),
      "empty-body": githubError(502, 200),
      // A non-array body is refused rather than rendered as "no labels".
      "schema-drift": githubError(502, 200),
    },
  });
});

test("a GitHub 404 is a not_found and a 403 passes through", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.deepEqual(await (await read()).json(), { ok: false, error: "not_found" });
  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  assert.equal((await read()).status, 403);
  harness.heal("github");
  assert.equal((await read()).status, 200);
});

test("an invalid repo never reaches GitHub", async () => {
  harness.reset();
  const response = await GET(new Request("http://localhost/api/github/labels?repo=not-a-repo"));
  assert.equal(response.status, 400);
  assert.equal(harness.calls().length, 0);
});
