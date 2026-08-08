import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECOVERY_COOLDOWN_MS,
  RECOVERY_GRACE_MS,
  runCiRecovery,
} from "./ci-recovery.mjs";

const NOW = Date.parse("2026-08-08T18:00:00Z");
const REPOSITORY = "OpenCoven/coven-cave";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pull({
  number = 42,
  createdAt = new Date(NOW - RECOVERY_GRACE_MS - 1).toISOString(),
  sha = "a".repeat(40),
  branch = "fix/cave-unit",
  repository = REPOSITORY,
  draft = false,
} = {}) {
  return {
    number,
    draft,
    created_at: createdAt,
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    head: {
      ref: branch,
      sha,
      repo: { full_name: repository },
    },
  };
}

function workflowRun({
  id = 9001,
  status = "completed",
  event = "pull_request",
  createdAt = new Date(NOW - RECOVERY_GRACE_MS - 1).toISOString(),
} = {}) {
  return {
    id,
    status,
    event,
    created_at: createdAt,
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
  };
}

function githubFixture({ pulls, runsBySha = {}, jobsByRun = {} }) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const request = {
      method: init.method ?? "GET",
      path: `${parsed.pathname}${parsed.search}`,
      body: init.body ? JSON.parse(init.body) : null,
    };
    requests.push(request);

    if (parsed.pathname.endsWith("/pulls")) return jsonResponse(pulls);
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/runs")) {
      const sha = parsed.searchParams.get("head_sha");
      return jsonResponse({ workflow_runs: runsBySha[sha] ?? [] });
    }
    const jobs = parsed.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if (jobs) {
      return jsonResponse({
        total_count: jobsByRun[Number(jobs[1])] ?? 0,
        jobs: [],
      });
    }
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/dispatches")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${request.method} ${request.path}`);
  };
  return { fetchImpl, requests };
}

function options(fetchImpl, apply = false, overrides = {}) {
  return {
    apply,
    env: {
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_TOKEN: "test-token",
    },
    fetchImpl,
    now: NOW,
    log: () => {},
    ...overrides,
  };
}

test("report-only mode identifies an aged PR with no CI run without dispatching", async () => {
  const pr = pull();
  const fixture = githubFixture({ pulls: [pr] });
  const messages = [];

  const result = await runCiRecovery(
    options(fixture.fetchImpl, false, { log: (message) => messages.push(message) }),
  );

  assert.equal(result.mode, "report-only");
  assert.deepEqual(result.recoveries, [
    {
      number: pr.number,
      reason: "missing_ci_run",
      ref: pr.head.ref,
      sha: pr.head.sha,
      url: pr.html_url,
      dispatched: false,
    },
  ]);
  assert.equal(
    fixture.requests.some((request) => request.method === "POST"),
    false,
    "the default diagnostic path must be read-only",
  );
  assert.match(messages.join("\n"), /#42 missing_ci_run .*fix\/cave-unit/);
});

test("apply dispatches one fresh CI run for a qualifying same-repository head", async () => {
  const pr = pull();
  const fixture = githubFixture({ pulls: [pr] });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.equal(result.recoveries[0].dispatched, true);
  assert.deepEqual(
    fixture.requests.filter((request) => request.method === "POST"),
    [
      {
        method: "POST",
        path: `/repos/${REPOSITORY}/actions/workflows/ci.yml/dispatches`,
        body: { ref: pr.head.ref },
      },
    ],
  );
});

test("existing CI, young PRs, drafts, and fork heads are never dispatched", async () => {
  const healthy = pull({ number: 1, sha: "1".repeat(40) });
  const young = pull({
    number: 2,
    sha: "2".repeat(40),
    createdAt: new Date(NOW - RECOVERY_GRACE_MS + 1).toISOString(),
  });
  const draft = pull({ number: 3, sha: "3".repeat(40), draft: true });
  const fork = pull({ number: 4, sha: "4".repeat(40), repository: "contributor/fork" });
  const fixture = githubFixture({
    pulls: [healthy, young, draft, fork],
    runsBySha: {
      [healthy.head.sha]: [workflowRun()],
    },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.deepEqual(result.recoveries, []);
  assert.deepEqual(
    result.skipped.map(({ number, reason }) => ({ number, reason })),
    [
      { number: 1, reason: "ci_present" },
      { number: 2, reason: "grace_period" },
      { number: 3, reason: "draft" },
      { number: 4, reason: "fork_head" },
    ],
  );
  assert.equal(fixture.requests.some((request) => request.method === "POST"), false);
});

test("an aged queued run with zero jobs is recovered once", async () => {
  const pr = pull();
  const stalled = workflowRun({ id: 77, status: "queued" });
  const fixture = githubFixture({
    pulls: [pr],
    runsBySha: { [pr.head.sha]: [stalled] },
    jobsByRun: { 77: 0 },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.equal(result.recoveries[0].reason, "stalled_empty_run");
  assert.equal(result.recoveries[0].dispatched, true);
});

test("a recent recovery dispatch enforces the cooldown even when it has no jobs", async () => {
  const pr = pull();
  const recovery = workflowRun({
    id: 88,
    status: "queued",
    event: "workflow_dispatch",
    createdAt: new Date(NOW - RECOVERY_COOLDOWN_MS + 1).toISOString(),
  });
  const fixture = githubFixture({
    pulls: [pr],
    runsBySha: { [pr.head.sha]: [recovery] },
    jobsByRun: { 88: 0 },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.deepEqual(result.recoveries, []);
  assert.equal(result.skipped[0].reason, "recovery_cooldown");
  assert.equal(fixture.requests.some((request) => request.method === "POST"), false);
});

test("GitHub REST failures fail closed and never dispatch", async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET" });
    return jsonResponse({ message: "service unavailable" }, 503);
  };

  await assert.rejects(
    runCiRecovery(options(fetchImpl, true)),
    /failed to list open pull requests \(HTTP 503\)/,
  );
  assert.equal(requests.some((request) => request.method === "POST"), false);
});

test("pull pagination never forwards the token to a cross-origin Link URL", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return new Response("[]", {
      status: 200,
      headers: {
        "content-type": "application/json",
        link: '<https://attacker.example/pulls?page=2>; rel="next"',
      },
    });
  };

  await assert.rejects(
    runCiRecovery(options(fetchImpl, true)),
    /pull request pagination URL escaped the GitHub API repository endpoint/,
  );
  assert.deepEqual(requests, [
    `https://api.github.test/repos/${REPOSITORY}/pulls?state=open&per_page=100`,
  ]);
});
