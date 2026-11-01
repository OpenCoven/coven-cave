// GET /api/github/assigned under every upstream anomaly (#6359).
//
// Three upstream calls side by side — assigned issues over REST, review
// requests and authored PRs over search — stitched into one list behind a
// stale-while-revalidate cache (#5641). The contract under anomaly: a revoked
// PAT is a 200 with `patInvalid` so the UI offers reconnect; every source down
// is a 502, never a plausible empty list; one source down is a partial list
// that says so. A failure stands for its fresh minute as a backoff for the
// search API and no longer, which the clock-stepping here makes provable.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch, type UpstreamHandler } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-assigned-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_assigned_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const FRESH_MS = 60_000;
const STALE_SERVE_MS = 15 * 60_000;
let now = Date.UTC(2026, 0, 1);
const realNow = Date.now;
// The SWR cache binds its clock when the route module loads: stub first.
Date.now = () => now;
const stepPastCache = () => {
  now += STALE_SERVE_MS + 1;
};

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
  home.cleanup();
});

const item = (id: number, kind: "issues" | "pull", updatedAt: string) => ({
  id,
  number: id,
  title: `Item ${id}`,
  html_url: `https://github.com/OpenCoven/coven-cave/${kind}/${id}`,
  state: "open",
  updated_at: updatedAt,
  labels: [{ name: "bug" }],
  ...(kind === "pull" ? { pull_request: {} } : {}),
  repository: { full_name: "OpenCoven/coven-cave" },
});

const github = (failing: { match: (url: URL) => boolean; status: number } | null = null): UpstreamHandler => (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (failing?.match(url)) return Response.json({ message: "forced" }, { status: failing.status });
  if (url.pathname === "/issues") {
    assert.equal(url.searchParams.get("filter"), "assigned");
    return Response.json([item(1, "issues", "2026-10-29T00:00:00Z")]);
  }
  if (url.pathname === "/search/issues" && url.search.includes("review-requested")) {
    return Response.json({ total_count: 1, items: [item(2, "pull", "2026-10-30T00:00:00Z")] });
  }
  if (url.pathname === "/search/issues" && url.search.includes("author")) {
    return Response.json({ total_count: 1, items: [item(3, "pull", "2026-10-31T00:00:00Z")] });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
};
harness.healthy("github", github());

const read = () => GET();

type Assigned = {
  ok: boolean;
  configured?: boolean;
  patInvalid?: boolean;
  error?: string;
  items: Array<{ id: string; kind: string; repo: string }>;
  partial?: boolean;
  truncated?: boolean;
  sources?: Record<"assigned" | "reviewRequested" | "authored", { ok: boolean; error?: string }>;
};

const allSourcesDown = (error: string): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as Assigned;
  assert.deepEqual(body.items, [], "every source down is an error, never an empty list");
  assert.equal(body.error, error);
  assert.ok(body.sources && Object.values(body.sources).every((source) => !source.ok));
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as Assigned;
  assert.deepEqual(body.items, []);
  assert.equal(typeof body.error, "string");
};

test("GET /api/github/assigned across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    beforeEach: stepPastCache,
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as Assigned;
      assert.equal(body.ok, true);
      assert.equal(body.configured, true);
      assert.deepEqual(body.items.map((entry) => [entry.id, entry.kind]), [["3", "pr"], ["2", "review_request"], ["1", "issue"]], "newest first");
      assert.equal(body.items[0].repo, "OpenCoven/coven-cave");
      assert.equal(body.partial, false);
      assert.equal(body.truncated, false);
    },
    degraded: {
      "http-500": allSourcesDown("GitHub API error: HTTP 500"),
      "http-502": allSourcesDown("GitHub API error: HTTP 502"),
      "auth-revoked": (outcome) => {
        assert.equal(outcome.status, 200, "a revoked token is a reconnect prompt, not an error page");
        const body = outcome.body as Assigned;
        assert.equal(body.ok, false);
        assert.equal(body.patInvalid, true);
        assert.equal(body.configured, true);
        assert.deepEqual(body.items, []);
      },
      "rate-limit": allSourcesDown("GitHub API error: HTTP 429"),
      timeout: unreachable,
      network: (outcome, anomaly) => {
        unreachable(outcome, anomaly);
        assert.match((outcome.body as Assigned).error ?? "", /fetch failed/);
      },
      // A torn or empty body throws inside each source's own guard.
      "malformed-json": unreachable,
      "empty-body": unreachable,
      "schema-drift": (outcome) => {
        // The REST source reads a non-array as "nothing assigned"; the two
        // search sources trip on `items: 42` and are reported as failed, so
        // the answer is an honest partial empty list rather than a 502.
        assert.equal(outcome.status, 200);
        const body = outcome.body as Assigned;
        assert.equal(body.ok, true);
        assert.deepEqual(body.items, []);
        assert.equal(body.partial, true);
        assert.equal(body.sources?.assigned.ok, true);
        assert.equal(body.sources?.reviewRequested.ok, false);
        assert.equal(body.sources?.authored.ok, false);
      },
    },
  });
});

test("a failure stands for its fresh minute and no longer", async () => {
  stepPastCache();
  harness.inject("github", { kind: "http", status: 500, body: { message: "down" } });
  harness.reset();
  assert.equal((await read()).status, 502);
  assert.equal(harness.calls("github").length, 3);

  harness.heal("github");
  harness.reset();
  assert.equal((await read()).status, 502, "inside the minute the failure is the answer");
  assert.equal(harness.calls("github").length, 0, "no GitHub call while backing off");

  now += FRESH_MS + 1;
  harness.reset();
  const healed = (await (await read()).json()) as Assigned;
  assert.equal(healed.ok, true, "past the minute the failure is not served stale");
  assert.equal(harness.calls("github").length, 3, "the first call past the minute reached GitHub");
});

test("a good answer is fresh for a minute, then served stale while one revalidation runs", async () => {
  stepPastCache();
  harness.reset();
  assert.equal(((await (await read()).json()) as Assigned).ok, true);
  assert.equal(harness.calls("github").length, 3);

  harness.reset();
  await read();
  assert.equal(harness.calls("github").length, 0, "inside the minute the answer is served from memory");

  now += FRESH_MS + 1;
  harness.reset();
  assert.equal(((await (await read()).json()) as Assigned).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(harness.calls("github").length, 3, "a stale good answer triggers one background refresh");
});

test("one search source down is a partial list that says so, not an empty one", async () => {
  stepPastCache();
  harness.healthy("github", github({ match: (url) => url.search.includes("review-requested"), status: 500 }));
  const body = (await (await read()).json()) as Assigned;
  assert.equal(body.ok, true);
  assert.deepEqual(body.items.map((entry) => entry.id), ["3", "1"]);
  assert.equal(body.partial, true);
  assert.equal(body.sources?.reviewRequested.ok, false);
  assert.equal(body.sources?.reviewRequested.error, "GitHub API error: HTTP 500");
  assert.equal(body.sources?.assigned.ok, true);
  harness.healthy("github", github());
});

test("without a token the route answers unconfigured without touching GitHub", async () => {
  delete process.env.GITHUB_TOKEN;
  harness.reset();
  try {
    assert.deepEqual(await (await read()).json(), { ok: true, items: [], configured: false });
    assert.equal(harness.calls().length, 0);
  } finally {
    process.env.GITHUB_TOKEN = TOKEN;
  }
});
