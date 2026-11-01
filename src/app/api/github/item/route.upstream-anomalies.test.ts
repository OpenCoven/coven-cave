// GET /api/github/item under every upstream anomaly (#6359).
//
// Up to three upstream calls per answer: the issue, and with `?pull=1` the
// pull head and its reviews. Good answers are held for 30 s (#5615), so the
// clock is stubbed and stepped past the window before every call; the matrix
// then proves a failure is never the thing that gets held. The two extras are
// fault-isolated by design: a pull-head outage empties the `pull` block and a
// reviews outage zeroes the tally, while the base item still answers.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch, type UpstreamHandler } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-item-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_item_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const FRESH_MS = 30_000;
let now = Date.UTC(2026, 0, 1);
const realNow = Date.now;
Date.now = () => now;
const stepPastCache = () => {
  now += FRESH_MS + 1;
};

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
  home.cleanup();
});

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

/** The healthy GitHub, with one path optionally forced to fail. */
const github = (failing: { path: string; status: number } | null = null): UpstreamHandler => (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (failing && url.pathname === failing.path) {
    return Response.json({ message: "forced" }, { status: failing.status });
  }
  if (url.pathname === "/repos/OpenCoven/coven-cave/issues/7") {
    return Response.json({
      title: "Ship the suite",
      number: 7,
      state: "open",
      pull_request: { merged_at: null },
      draft: false,
      body: "Body text",
      user: { login: "BunsDev", avatar_url: "https://avatars.githubusercontent.com/u/1", html_url: "https://github.com/BunsDev" },
      assignees: [{ login: "BunsDev" }],
      labels: [{ name: "bug", color: "d73a4a" }],
      created_at: "2026-10-30T00:00:00Z",
      updated_at: "2026-10-31T00:00:00Z",
      html_url: "https://github.com/OpenCoven/coven-cave/pull/7",
      comments: 2,
      reactions: { "+1": 3, heart: 1, eyes: 0 },
    });
  }
  if (url.pathname === "/repos/OpenCoven/coven-cave/pulls/7") {
    return Response.json({
      head: { ref: "feat/suite", sha: HEAD },
      base: { ref: "main", sha: BASE },
      commits: 2,
      additions: 10,
      deletions: 4,
      changed_files: 3,
      mergeable: true,
      mergeable_state: "clean",
    });
  }
  if (url.pathname === "/repos/OpenCoven/coven-cave/pulls/7/reviews") {
    return Response.json([
      { user: { login: "alice" }, state: "APPROVED" },
      { user: { login: "alice" }, state: "COMMENTED" },
      { user: { login: "bob" }, state: "CHANGES_REQUESTED" },
      { user: { login: "carol" }, state: "DISMISSED" },
    ]);
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
};
harness.healthy("github", github());

const read = () => GET(new Request("http://localhost/api/github/item?repo=OpenCoven%2Fcoven-cave&number=7&pull=1"));

const githubError = (status: number, upstream: number): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, `github error (${upstream})`);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

type Detail = {
  ok: boolean;
  title: string;
  number: number;
  isPull: boolean;
  merged: boolean;
  author: { login: string } | null;
  labels: Array<{ name: string; color: string }>;
  reactionCounts: Record<string, number>;
  pull: { headRef: string; baseRef: string; headSha: string; mergeable: boolean | null; reviews: Record<string, number> } | null;
};

const healthyDetail = (body: Detail) => {
  assert.equal(body.ok, true);
  assert.equal(body.title, "Ship the suite");
  assert.equal(body.isPull, true);
  assert.equal(body.merged, false);
  assert.equal(body.author?.login, "BunsDev");
  assert.deepEqual(body.labels, [{ name: "bug", color: "d73a4a" }]);
  assert.deepEqual(body.reactionCounts, { "+1": 3, heart: 1 }, "zero counts are dropped");
  assert.ok(body.pull, "pull=1 adds the pull block");
  assert.equal(body.pull.headRef, "feat/suite");
  assert.equal(body.pull.headSha, HEAD);
  assert.equal(body.pull.mergeable, true);
  assert.deepEqual(body.pull.reviews, { approved: 0, changesRequested: 1, commented: 1 }, "only an author's latest review counts");
};

test("GET /api/github/item across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    beforeEach: stepPastCache,
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      healthyDetail(outcome.body as Detail);
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
        // Any object is rendered as an item: no title, not a pull, and so no
        // pull block even though one was asked for.
        assert.equal(outcome.status, 200);
        const body = outcome.body as Detail;
        assert.equal(body.ok, true);
        assert.equal(body.title, "");
        assert.equal(body.number, 7);
        assert.equal(body.isPull, false);
        assert.equal(body.pull, null);
      },
    },
  });
});

test("a failure is never held: the next call after GitHub heals is live, no clock needed", async () => {
  stepPastCache();
  harness.inject("github", { kind: "http", status: 503, body: { message: "down" } });
  harness.reset();
  assert.equal((await read()).status, 502);
  assert.equal(harness.calls("github").length, 1);

  harness.heal("github");
  harness.reset();
  assert.equal((await read()).status, 200);
  assert.equal(harness.calls("github").length, 3, "the healed call made all three GitHub calls at once");

  harness.reset();
  assert.equal((await read()).status, 200);
  assert.equal(harness.calls("github").length, 0, "a good answer is then served from the window");

  stepPastCache();
  harness.reset();
  await read();
  assert.equal(harness.calls("github").length, 3, "past the window the item is read live again");
});

test("a pull-head outage empties the pull block without losing the item", async () => {
  stepPastCache();
  harness.healthy("github", github({ path: "/repos/OpenCoven/coven-cave/pulls/7", status: 500 }));
  const body = (await (await read()).json()) as Detail;
  assert.equal(body.ok, true);
  assert.equal(body.title, "Ship the suite");
  assert.equal(body.pull, null);
  harness.healthy("github", github());
});

test("a reviews outage zeroes the tally without losing the pull block", async () => {
  stepPastCache();
  harness.healthy("github", github({ path: "/repos/OpenCoven/coven-cave/pulls/7/reviews", status: 500 }));
  const body = (await (await read()).json()) as Detail;
  assert.equal(body.ok, true);
  assert.equal(body.pull?.headRef, "feat/suite");
  assert.deepEqual(body.pull?.reviews, { approved: 0, changesRequested: 0, commented: 0 });
  harness.healthy("github", github());
});

test("a GitHub 404 is a not_found", async () => {
  stepPastCache();
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.deepEqual(await (await read()).json(), { ok: false, error: "not_found" });
  harness.heal("github");
  stepPastCache();
  assert.equal((await read()).status, 200);
});
