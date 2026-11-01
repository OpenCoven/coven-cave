// fetchMergedPrsForDay under every upstream anomaly (#6359).
//
// The daily report must never lose its day-in-review section because GitHub
// had a bad minute. The module keeps one same-day cache (ten-minute window)
// and falls back to it on any failure. The matrix proves that fallback —
// every anomaly after a good answer serves the same day's items — and the
// self-healing half: the fallback is a read of the last good answer, never a
// remembered failure, so the first call after GitHub recovers is live and a
// fresh answer replaces the stale one.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../testing/scratch-cave-home.ts";
import type { MergedPr } from "../daily-report-facts.ts";

const home = isolateCaveHome("github-merged-anomalies");
const TOKEN = "ghp_mergedonly_never_dispatched_1234567890abcdef";
process.env.GITHUB_PAT = TOKEN;
process.env.GITHUB_USERNAME = "fallback-login";
delete process.env.GITHUB_TOKEN;

const CACHE_TTL_MS = 10 * 60_000;
const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;

// The module reads globalThis.fetch, so the harness is installed for real.
const harness = installUpstreamAnomalyFetch();
const { fetchMergedPrsForDay } = await import("./github-merged.ts");
test.after(() => {
  harness.restore();
  Date.now = realNow;
  home.cleanup();
});

// A fixed local day for the report; the merges below sit inside it.
const day = new Date(2026, 0, 15, 12, 0, 0);
const mergedAt = (hour: number) => new Date(2026, 0, 15, hour, 0, 0).toISOString();
const yesterdayAt = new Date(2026, 0, 14, 23, 0, 0).toISOString();

let serving: Array<{ number: number; title: string; mergedAt: string }> = [
  { number: 6355, title: "Register the other startup workers", mergedAt: mergedAt(9) },
  { number: 6350, title: "Drain the GitHub watcher", mergedAt: mergedAt(14) },
];

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (url.pathname === "/user") return Response.json({ login: "octocat" });
  if (url.pathname === "/search/issues") {
    assert.match(url.searchParams.get("q") ?? "", /author:octocat/, "the search is scoped to the authenticated login");
    return Response.json({
      total_count: serving.length + 1,
      items: [
        ...serving.map((pr) => ({
          number: pr.number,
          title: pr.title,
          html_url: `https://github.com/OpenCoven/coven-cave/pull/${pr.number}`,
          repository_url: "https://api.github.com/repos/OpenCoven/coven-cave",
          pull_request: { merged_at: pr.mergedAt },
        })),
        // Inside the UTC search window but outside the local day: filtered out.
        {
          number: 1,
          title: "Yesterday",
          html_url: "https://github.com/OpenCoven/coven-cave/pull/1",
          repository_url: "https://api.github.com/repos/OpenCoven/coven-cave",
          pull_request: { merged_at: yesterdayAt },
        },
      ],
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const expected = () =>
  [...serving]
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
    .map<MergedPr>((pr) => ({
      repo: "OpenCoven/coven-cave",
      number: pr.number,
      title: pr.title,
      url: `https://github.com/OpenCoven/coven-cave/pull/${pr.number}`,
      mergedAt: pr.mergedAt,
    }));

const stepPastCache = () => {
  clock += CACHE_TTL_MS + 1;
};

let lastGood: MergedPr[] | null = null;

const staleDayServed = (outcome: MatrixOutcome) => {
  assert.ok(lastGood, "the matrix starts with a good answer");
  assert.deepEqual(outcome.value, lastGood, "a failure after a good answer serves the stale same-day items");
};

test("fetchMergedPrsForDay across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    beforeEach: stepPastCache,
    invoke: () => fetchMergedPrsForDay(day),
    healthy: (outcome) => {
      assert.deepEqual(outcome.value, expected());
      lastGood = outcome.value as MergedPr[];
    },
    degraded: {
      default: staleDayServed,
    },
  });
});

test("a failure is not remembered past the heal: the stale day is served, then the next call is live", async () => {
  stepPastCache();
  harness.reset();
  const good = await fetchMergedPrsForDay(day);
  assert.deepEqual(good, expected());
  assert.equal(harness.calls("github").length, 2, "identity, then one search page");

  harness.reset();
  assert.deepEqual(await fetchMergedPrsForDay(day), good);
  assert.equal(harness.calls("github").length, 0, "inside the window the good answer is served without a call");

  stepPastCache();
  harness.inject("github", { kind: "http", status: 503 });
  harness.reset();
  assert.deepEqual(await fetchMergedPrsForDay(day), good, "the outage serves the same day's last good items");
  assert.ok(harness.calls("github").length >= 1, "the outage was observed live, not assumed from a cache");

  // GitHub recovers with a new merge on the same day.
  serving = [...serving, { number: 6359, title: "Upstream anomaly matrix", mergedAt: mergedAt(16) }];
  harness.heal("github");
  harness.reset();
  const healed = await fetchMergedPrsForDay(day);
  assert.deepEqual(healed, expected(), "the first call after the heal is live and replaces the stale answer");
  assert.equal(healed?.[0]?.number, 6359);
  assert.equal(harness.calls("github").length, 2);

  harness.reset();
  assert.deepEqual(await fetchMergedPrsForDay(day), healed);
  assert.equal(harness.calls("github").length, 0, "the fresh answer is then held for the window");
});

test("a failure with no good answer for that day is null, never an error, and is not cached", async () => {
  const otherDay = new Date(2026, 0, 16, 12, 0, 0);
  harness.inject("github", { kind: "network" });
  harness.reset();
  assert.equal(await fetchMergedPrsForDay(otherDay), null, "another day has no stale items to fall back on");
  assert.equal(harness.calls("github").length, 2, "identity failed, the username fallback was tried, and the search failed");

  harness.heal("github");
  harness.reset();
  assert.deepEqual(await fetchMergedPrsForDay(otherDay), [], "the healed call is live: the day simply has no merges in range");
  assert.equal(harness.calls("github").length, 2);
});

test("a revoked token still answers through the configured username", async () => {
  const otherDay = new Date(2026, 0, 17, 12, 0, 0);
  harness.inject("github", { kind: "auth-revoked" });
  harness.reset();
  assert.equal(await fetchMergedPrsForDay(otherDay), null);
  const search = harness.calls("github").find((call) => call.url.includes("/search/issues"));
  assert.ok(search, "identity failed, so the search fell back to GITHUB_USERNAME");
  assert.match(decodeURIComponent(search.url), /author:fallback-login/);
  harness.heal("github");
});

test("every GitHub call carries a deadline", () => {
  for (const call of harness.calls("github")) assert.equal(call.hasDeadline, true, call.url);
  harness.assertAllDeclared();
});
