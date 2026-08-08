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
  updatedAt = createdAt,
  sha = "a".repeat(40),
  branch = "fix/cave-unit",
  repository = REPOSITORY,
  draft = false,
  state = "open",
} = {}) {
  return {
    number,
    draft,
    state,
    created_at: createdAt,
    updated_at: updatedAt,
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
    const pullDetail = parsed.pathname.match(/\/pulls\/(\d+)$/);
    if (pullDetail) {
      return jsonResponse(pulls.find((candidate) => candidate.number === Number(pullDetail[1])));
    }
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
        body: { ref: pr.head.ref, inputs: { expected_sha: pr.head.sha } },
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

test("an old PR with a freshly updated head remains inside the grace period", async () => {
  const freshHead = pull({
    createdAt: new Date(NOW - RECOVERY_GRACE_MS * 10).toISOString(),
    updatedAt: new Date(NOW - RECOVERY_GRACE_MS + 1).toISOString(),
  });
  const fixture = githubFixture({ pulls: [freshHead] });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.deepEqual(result.recoveries, []);
  assert.deepEqual(result.skipped, [{ number: freshHead.number, reason: "grace_period" }]);
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

test("apply completes every candidate read before dispatching any recovery", async () => {
  const first = pull({ number: 1, sha: "1".repeat(40), branch: "fix/first" });
  const second = pull({ number: 2, sha: "2".repeat(40), branch: "fix/second" });
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({ method: init.method ?? "GET", path: parsed.pathname });
    if (parsed.pathname.endsWith("/pulls")) return jsonResponse([first, second]);
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/runs")) {
      if (parsed.searchParams.get("head_sha") === first.head.sha) {
        return jsonResponse({ workflow_runs: [] });
      }
      return jsonResponse({ message: "service unavailable" }, 503);
    }
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/dispatches")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${parsed.pathname}`);
  };

  await assert.rejects(
    runCiRecovery(options(fetchImpl, true)),
    /failed to list CI runs for a pull request head \(HTTP 503\)/,
  );
  assert.equal(requests.some((request) => request.method === "POST"), false);
});

test("apply skips a recovery when the pull request head moves before dispatch", async () => {
  const original = pull();
  const moved = pull({
    updatedAt: new Date(NOW - 1).toISOString(),
    sha: "b".repeat(40),
  });
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({ method: init.method ?? "GET", path: parsed.pathname });
    if (parsed.pathname.endsWith("/pulls")) return jsonResponse([original]);
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/runs")) {
      return jsonResponse({ workflow_runs: [] });
    }
    if (parsed.pathname.endsWith(`/pulls/${original.number}`)) return jsonResponse(moved);
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/dispatches")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${parsed.pathname}`);
  };

  const result = await runCiRecovery(options(fetchImpl, true));

  assert.deepEqual(result.recoveries, []);
  assert.deepEqual(result.skipped, [{ number: original.number, reason: "head_changed" }]);
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
