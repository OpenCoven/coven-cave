// GET /api/github/activity under every upstream anomaly (#6359).
//
// The widest fan-out of the GitHub routes: identity, organization
// memberships, three searches, then a bounded pool of per-PR check reads.
// Identity decides the shape of everything after it, so the matrix (which
// degrades every call alike) is really the identity contract: an outage is a
// 502, a rate limit is a 429 carrying Retry-After, a revoked PAT is a 200 with
// `patInvalid`, and an identity body without a string login is a 502 saying
// GitHub did not identify the account, never the "no_user" 401 that blames
// configuration (#6368). Every call goes through
// upstreamFetch and so carries a deadline; the enrichment pool adds its own
// abort signal, and a check outage there costs a row its pip, never the list.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch, type UpstreamHandler } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";
import { resetUpstreamHealth } from "@/lib/server/upstream-fetch";

const home = isolateCaveHome("github-activity-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_activity_0123456789";
delete process.env.GITHUB_PAT;
delete process.env.GITHUB_USERNAME;
process.env.GITHUB_TOKEN = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});
// A forced outage or rate limit in one test must not leave the host cooling
// for the next.
test.beforeEach(() => resetUpstreamHealth("github"));

const SHA = "a".repeat(40);
const RATE = { "x-ratelimit-remaining": "4999", "x-ratelimit-limit": "5000" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: RATE });

const searchItem = (id: number, number: number, title: string) => ({
  id,
  number,
  title,
  repository_url: "https://api.github.com/repos/OpenCoven/coven-cave",
  html_url: `https://github.com/OpenCoven/coven-cave/pull/${number}`,
  state: "open",
  updated_at: "2026-10-31T00:00:00Z",
  draft: false,
  labels: [{ name: "bug" }],
});

const github = (failing: { match: (url: URL) => boolean; status: number } | null = null): UpstreamHandler => (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  if (failing?.match(url)) return json({ message: "forced" }, failing.status);
  if (url.pathname === "/user") return json({ login: "octocat", id: 1 });
  if (url.pathname === "/user/orgs") return json([{ login: "OpenCoven" }, { login: "Acme" }]);
  if (url.pathname === "/search/issues") {
    const query = url.search;
    assert.match(query, /octocat/, "searches are scoped to the resolved login");
    if (query.includes("author:")) return json({ total_count: 1, incomplete_results: false, items: [searchItem(10, 5, "Authored PR")] });
    if (query.includes("review-requested:")) return json({ total_count: 0, incomplete_results: false, items: [] });
    if (query.includes("assignee:")) return json({ total_count: 1, incomplete_results: false, items: [searchItem(20, 6, "Assigned issue")] });
  }
  if (url.pathname === "/repos/OpenCoven/coven-cave/pulls/5") return json({ head: { sha: SHA } });
  if (url.pathname === `/repos/OpenCoven/coven-cave/commits/${SHA}/check-runs`) {
    return json({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] });
  }
  if (url.pathname === `/repos/OpenCoven/coven-cave/commits/${SHA}/status`) return json({ state: "success" });
  return json({ message: "Not Found" }, 404);
};
harness.healthy("github", github());

const read = () => GET();

type Activity = {
  ok: boolean;
  authed?: boolean;
  patInvalid?: boolean;
  login?: unknown;
  organizations?: string[];
  collections?: Record<string, { status: string; error?: string }>;
  items?: Array<{ kind: string; number?: number; checkStatus?: string | null }>;
  rateLimit?: { remaining: number; limit: number } | null;
  error?: string;
  retryAfterSeconds?: number | null;
  warning?: string;
};

const identityDown = (message: string): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal((outcome.body as Activity).error, message);
};

test("GET /api/github/activity across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    expectLiveDetection: true,
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as Activity;
      assert.equal(body.ok, true);
      assert.equal(body.authed, true);
      assert.equal(body.patInvalid, undefined);
      assert.equal(body.login, "octocat");
      assert.deepEqual(body.organizations, ["Acme", "OpenCoven"], "memberships are sorted");
      assert.deepEqual(
        body.items?.map((entry) => [entry.kind, entry.number, entry.checkStatus]),
        [["pr", 5, "passing"], ["issue", 6, undefined]],
        "PR rows carry a CI pip; issues do not",
      );
      assert.equal(body.collections?.authored.status, "complete");
      assert.equal(body.collections?.reviewRequests.status, "complete");
      assert.equal(body.collections?.assignedIssues.status, "complete");
      assert.deepEqual(body.rateLimit, { remaining: 4999, limit: 5000 });
      assert.equal(body.warning, undefined);
    },
    degraded: {
      "http-500": identityDown("GitHub is temporarily unavailable."),
      "http-502": identityDown("GitHub is temporarily unavailable."),
      "auth-revoked": (outcome) => {
        assert.equal(outcome.status, 200, "a revoked token is surfaced, not rendered as an empty authed state");
        const body = outcome.body as Activity;
        assert.equal(body.ok, true);
        assert.equal(body.authed, false);
        assert.equal(body.patInvalid, true);
        assert.equal(body.login, null);
        assert.deepEqual(body.items, []);
        assert.equal(body.collections?.authored.status, "unavailable");
      },
      "rate-limit": (outcome, anomaly) => {
        expectErrorStatus(429)(outcome, anomaly);
        const body = outcome.body as Activity;
        assert.equal(body.error, "GitHub rate limit reached. Try again in 7 seconds.");
        assert.equal(body.retryAfterSeconds, 7);
        assert.equal(outcome.response?.headers.get("retry-after"), "7", "Retry-After is propagated");
      },
      timeout: identityDown("Couldn't reach GitHub to identify the configured account."),
      network: identityDown("Couldn't reach GitHub to identify the configured account."),
      // A 2xx identity body without a string login is GitHub failing to
      // identify the account, never "set GITHUB_USERNAME" and never a search
      // run with a non-string login (#6368).
      "malformed-json": identityDown("GitHub answered without identifying the configured account."),
      "empty-body": identityDown("GitHub answered without identifying the configured account."),
      "schema-drift": identityDown("GitHub answered without identifying the configured account."),
    },
  });
});

test("a check-run outage costs a PR row its pip, never the list", async () => {
  harness.healthy("github", github({ match: (url) => url.pathname.includes("/check-runs"), status: 500 }));
  const body = (await (await read()).json()) as Activity;
  assert.equal(body.ok, true);
  assert.deepEqual(body.items?.map((entry) => [entry.number, entry.checkStatus]), [[5, "passing"], [6, undefined]], "the combined status is the fallback");

  harness.healthy("github", github({ match: (url) => /\/pulls\/5$|\/check-runs|\/status$/.test(url.pathname), status: 500 }));
  const bare = (await (await read()).json()) as Activity;
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.items?.map((entry) => [entry.number, entry.checkStatus]), [[5, null], [6, undefined]]);
  harness.healthy("github", github());
});

test("a membership outage keeps the activity and drops only the organizations", async () => {
  harness.healthy("github", github({ match: (url) => url.pathname === "/user/orgs", status: 500 }));
  const body = (await (await read()).json()) as Activity;
  assert.equal(body.ok, true);
  assert.deepEqual(body.organizations, []);
  assert.equal(body.items?.length, 2);
  harness.healthy("github", github());
});

test("a rate limit during search is reported per collection and stops further searches", async () => {
  harness.healthy("github", github({ match: (url) => url.pathname === "/search/issues" && url.search.includes("review-requested:"), status: 429 }));
  harness.reset();
  const body = (await (await read()).json()) as Activity;
  assert.equal(body.ok, true);
  assert.equal(body.collections?.authored.status, "complete");
  assert.equal(body.collections?.reviewRequests.status, "failed");
  assert.equal(body.collections?.assignedIssues.status, "failed", "the cooldown covers the search that was not attempted");
  assert.equal(harness.calls("github").filter((call) => call.url.includes("assignee:")).length, 0, "no search after the limit");
  harness.healthy("github", github());
});

test("every GitHub call carries a deadline, the enrichment pool's abort signal included", async () => {
  harness.reset();
  await read();
  const calls = harness.calls("github");
  assert.ok(calls.length >= 7, "identity, memberships, three searches and the enrichment reads all happened");
  const unbounded = calls.filter((call) => !call.hasDeadline).map((call) => new URL(call.url).pathname);
  assert.deepEqual(unbounded, [], "upstreamFetch bounds every stage, not only the pool that passes its own signal");
});
