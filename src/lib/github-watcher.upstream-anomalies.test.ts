// tickGithubWatcher under every upstream anomaly (#6359).
//
// The watcher polls each watched repository, delivers newly opened PRs to the
// inbox and persists a poll cursor. The matrix drives one tick at a time
// against a real (isolated) subscription store and inbox, and proves that a
// degraded poll notifies nothing, moves no cursor, and — the self-healing
// half — leaves no stuck single-flight read, so the tick after GitHub
// recovers polls again, delivers what was opened meanwhile, and advances.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "./testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "./testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "./testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-watcher-anomalies");
process.env.COVEN_GITHUB_SUBSCRIPTIONS_PATH = path.join(home.root, "github-subscriptions.json");
const TOKEN = "ghp_watcheronly_never_dispatched_abcdef0123456789";
process.env.GITHUB_PAT = TOKEN;
delete process.env.GITHUB_TOKEN;
delete globalThis.__githubWatcher;

const REPO = "OpenCoven/coven-cave";

// The watcher reads globalThis.fetch, so the harness is installed for real.
const harness = installUpstreamAnomalyFetch();
const { tickGithubWatcher } = await import("./github-watcher.ts");
const { loadSubscriptions, patchSubscriptions } = await import("./github-subscriptions.ts");
const { loadInbox } = await import("./cave-inbox.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

await patchSubscriptions({ enabled: true, repos: [REPO], events: { prOpened: true, ciCompleted: true } });

// Every healthy poll sees one more open PR than the last, so a landed tick is
// observable as the cursor reaching that PR and (after the first poll) its
// notification arriving in the inbox.
let opened = 0;
const createdAt = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
const openPrs = () =>
  Array.from({ length: opened }, (_, index) => {
    const number = index + 1;
    return {
      number,
      title: `Synthetic change ${number}`,
      html_url: `https://github.com/${REPO}/pull/${number}`,
      created_at: createdAt(number),
      draft: false,
      user: { login: "octocat" },
    };
  }).reverse();

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer and nowhere else");
  if (url.pathname === `/repos/${REPO}/pulls`) {
    assert.equal(url.searchParams.get("state"), "open");
    return Response.json(openPrs());
  }
  if (url.pathname === `/repos/${REPO}/actions/runs`) {
    assert.equal(url.searchParams.get("status"), "completed");
    return Response.json({ total_count: 0, workflow_runs: [] });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

type Outcome = { cursor: string | null; titles: string[] };

async function snapshot(): Promise<Outcome> {
  const subs = await loadSubscriptions();
  const inbox = await loadInbox();
  return {
    cursor: subs.cursors[REPO]?.prOpenedAt ?? null,
    titles: inbox.items.map((item) => item.title),
  };
}

async function tick(): Promise<Outcome> {
  if (harness.anomalyFor("github") === null) opened += 1;
  await tickGithubWatcher();
  return snapshot();
}

let lastGood: Outcome = await snapshot();

const nothingMoved = (outcome: MatrixOutcome) => {
  assert.deepEqual(outcome.value, lastGood, "a degraded poll notifies nothing and moves no cursor");
};

test("tickGithubWatcher across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: tick,
    healthy: (outcome) => {
      const value = outcome.value as Outcome;
      assert.equal(value.cursor, createdAt(opened), "the cursor advanced to the newest open PR");
      if (lastGood.cursor === null) {
        // The first poll of a repository establishes the cursor without a backlog.
        assert.deepEqual(value.titles, []);
      } else {
        assert.deepEqual(value.titles, [...lastGood.titles, `PR opened in ${REPO}: #${opened} Synthetic change ${opened}`], "the PR opened since the last good poll was delivered once");
      }
      lastGood = value;
    },
    degraded: { default: nothingMoved },
  });
});

test("a failure is not remembered past the heal: the single flight is released and the next tick delivers", async () => {
  harness.inject("github", { kind: "http", status: 503 });
  harness.reset();
  assert.deepEqual(await tick(), lastGood);
  assert.ok(harness.calls("github").length >= 1, "the degraded poll reached GitHub");
  assert.equal(globalThis.__githubWatcher?.read, undefined, "the failed tick released its single-flight read");

  harness.heal("github");
  harness.reset();
  const healed = await tick();
  assert.equal(harness.calls("github").length, 2, "the next tick polled PRs and runs again");
  assert.equal(healed.cursor, createdAt(opened));
  assert.equal(healed.titles.at(-1), `PR opened in ${REPO}: #${opened} Synthetic change ${opened}`);
  lastGood = healed;
});

test("a poll that fails on PRs still polls completed runs and persists the retained cursor", async () => {
  harness.reset();
  harness.healthy("github", (request) => {
    const url = new URL(request.url);
    if (url.pathname === `/repos/${REPO}/pulls`) throw new TypeError("fetch failed");
    return Response.json({ total_count: 0, workflow_runs: [] });
  });
  await tickGithubWatcher();
  assert.equal(harness.calls("github").length, 2, "one repository's failing read does not skip its other read");
  assert.deepEqual(await snapshot(), lastGood);
});

test("every poll carries a deadline", () => {
  for (const call of harness.calls("github")) assert.equal(call.hasDeadline, true, call.url);
  harness.assertAllDeclared();
});
