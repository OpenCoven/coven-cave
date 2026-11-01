// GET /api/github/commit under every upstream anomaly (#6359).
//
// Two modes, one upstream call each: `?sha=` reads a single commit, `?number=`
// lists a pull request's commits. Neither caches nor passes a deadline.
// Failures are 502s naming the upstream status. The modes differ on schema
// drift: the list refuses a non-array, while the single-commit mode renders
// any object as a commit with the requested sha and an empty message.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-commit-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_commit_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const SHA = "a".repeat(40);

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (url.pathname === `/repos/OpenCoven/coven-cave/commits/${SHA}`) {
    return Response.json({
      sha: SHA,
      commit: { message: "Fix the thing\n\nLonger body.", author: { name: "Val", date: "2026-10-31T12:00:00Z" } },
      author: { login: "BunsDev" },
      html_url: `https://github.com/OpenCoven/coven-cave/commit/${SHA}`,
      stats: { additions: 3, deletions: 1, total: 4 },
      files: [{ filename: "src/a.ts", status: "modified", additions: 3, deletions: 1 }],
    });
  }
  if (url.pathname === "/repos/OpenCoven/coven-cave/pulls/7/commits") {
    assert.equal(url.searchParams.get("per_page"), "100");
    return Response.json([
      {
        sha: SHA,
        commit: {
          message: "Fix the thing\n\nLonger body.",
          author: { name: "Val", date: "2026-10-31T12:00:00Z" },
          verification: { verified: true, reason: "valid" },
        },
        author: { login: "BunsDev" },
        html_url: `https://github.com/OpenCoven/coven-cave/commit/${SHA}`,
      },
    ]);
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const readCommit = () => GET(new Request(`http://localhost/api/github/commit?repo=OpenCoven%2Fcoven-cave&sha=${SHA}`));
const listCommits = () => GET(new Request("http://localhost/api/github/commit?repo=OpenCoven%2Fcoven-cave&number=7"));

const githubError = (status: number, upstream: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, `github error (${upstream})`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

const sharedDegraded = {
  "http-500": githubError(502, 500),
  "http-502": githubError(502, 502),
  "auth-revoked": githubError(502, 401),
  "rate-limit": githubError(502, 429),
  timeout: unreachable,
  network: ((outcome, anomaly) => {
    unreachable(outcome, anomaly);
    assert.match((outcome.body as { error: string }).error, /fetch failed/);
  }) satisfies DegradedExpectation,
  "malformed-json": githubError(502, 200),
  "empty-body": githubError(502, 200),
};

test("GET /api/github/commit?sha= across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: readCommit,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        authed: true,
        commit: {
          sha: SHA,
          message: "Fix the thing\n\nLonger body.",
          authorLogin: "BunsDev",
          authorName: "Val",
          date: "2026-10-31T12:00:00Z",
          htmlUrl: `https://github.com/OpenCoven/coven-cave/commit/${SHA}`,
          stats: { additions: 3, deletions: 1, total: 4 },
          fileCount: 1,
          files: [{ filename: "src/a.ts", status: "modified", additions: 3, deletions: 1 }],
        },
      });
    },
    degraded: {
      ...sharedDegraded,
      "schema-drift": (outcome) => {
        // Any object renders as a commit: the requested sha, an empty
        // message, zeroed stats, no files.
        assert.equal(outcome.status, 200);
        const body = outcome.body as { ok: boolean; commit: { sha: string; message: string; fileCount: number } };
        assert.equal(body.ok, true);
        assert.equal(body.commit.sha, SHA);
        assert.equal(body.commit.message, "");
        assert.equal(body.commit.fileCount, 0);
      },
    },
  });
});

test("GET /api/github/commit?number= across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: listCommits,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        authed: true,
        truncated: false,
        commits: [
          {
            sha: SHA,
            subject: "Fix the thing",
            body: "Longer body.",
            authorLogin: "BunsDev",
            authorName: "Val",
            date: "2026-10-31T12:00:00Z",
            htmlUrl: `https://github.com/OpenCoven/coven-cave/commit/${SHA}`,
            verified: true,
            verifiedReason: "valid",
          },
        ],
      });
    },
    degraded: {
      ...sharedDegraded,
      // The list refuses a non-array body rather than showing "no commits".
      "schema-drift": githubError(502, 200),
    },
  });
});

test("a GitHub 404 is a not_found in both modes", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.deepEqual(await (await readCommit()).json(), { ok: false, error: "not_found" });
  assert.deepEqual(await (await listCommits()).json(), { ok: false, error: "not_found" });
  harness.heal("github");
  assert.equal((await readCommit()).status, 200);
});
