import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTRACT_PARTIAL,
  NOT_DISPATCHABLE,
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
  conclusion = status === "completed" ? "success" : null,
  event = "pull_request",
  createdAt = new Date(NOW - RECOVERY_GRACE_MS - 1).toISOString(),
  headSha = "a".repeat(40),
  displayTitle = `CI ${event} ${headSha}`,
} = {}) {
  return {
    id,
    status,
    conclusion,
    event,
    created_at: createdAt,
    head_sha: headSha,
    display_title: displayTitle,
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
  };
}

const GUARDED_RUN_NAME = "CI ${{ github.event_name }} ${{ inputs.expected_sha || github.sha }}";
const GUARDED_CONCURRENCY =
  "ci-pr-${{ github.event.pull_request.number || inputs.expected_pr_number || github.run_id }}";
const PREVIOUS_GUARDED_CONCURRENCY =
  "ci-${{ github.event.pull_request.head.sha || inputs.expected_sha || github.sha }}";
const GUARDED_JOB_IF =
  "github.event_name != 'workflow_dispatch' || github.sha == inputs.expected_sha";
const GUARDED_SUBORDINATE_JOB_IFS = {
  paths: GUARDED_JOB_IF,
  ios: `needs.paths.outputs.ios == 'true' && (${GUARDED_JOB_IF})`,
};
const SHA_MISMATCH_STEP = [
  "    steps:",
  "      - name: Refuse recovery SHA mismatch",
  "        env:",
  "          EXPECTED_SHA: ${{ inputs.expected_sha }}",
  "          ACTUAL_SHA: ${{ github.sha }}",
  "        run: |",
  "          set -euo pipefail",
  '          if [ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ] && [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then',
  '            echo "::error::Recovery SHA mismatch: expected $EXPECTED_SHA but actual workflow SHA is $ACTUAL_SHA."',
  "            exit 1",
  "          fi",
];
const GUARDED_CI_WORKFLOW = [
  "name: CI",
  `run-name: ${GUARDED_RUN_NAME}`,
  "on:",
  "  workflow_dispatch:",
  "    inputs:",
  "      expected_sha:",
  "        required: true",
  "        type: string",
  "      expected_pr_number:",
  "        required: true",
  "        type: string",
  "concurrency:",
  `  group: ${GUARDED_CONCURRENCY}`,
  "jobs:",
  "  pr-checks:",
  ...SHA_MISMATCH_STEP,
  ...Object.entries(GUARDED_SUBORDINATE_JOB_IFS).flatMap(([name, condition]) => [
    `  ${name}:`,
    `    if: ${condition}`,
  ]),
  "  build:",
  "    if: always()",
  ...SHA_MISMATCH_STEP,
  "",
].join("\n");
const PREVIOUS_GUARDED_CI_WORKFLOW = [
  "name: CI",
  `run-name: ${GUARDED_RUN_NAME}`,
  "on:",
  "  workflow_dispatch:",
  "    inputs:",
  "      expected_sha:",
  "        required: true",
  "        type: string",
  "concurrency:",
  `  group: ${PREVIOUS_GUARDED_CONCURRENCY}`,
  "jobs:",
  "  build:",
  `    if: ${GUARDED_JOB_IF}`,
  "",
].join("\n");

function githubFixture({ pulls, runsBySha = {}, jobsByRun = {}, workflowsBySha = {} }) {
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
    if (parsed.pathname.endsWith("/contents/.github/workflows/ci.yml")) {
      const sha = parsed.searchParams.get("ref");
      const source = workflowsBySha[sha] ?? GUARDED_CI_WORKFLOW;
      return jsonResponse({ encoding: "base64", content: Buffer.from(source).toString("base64") });
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
        body: {
          ref: pr.head.ref,
          inputs: { expected_sha: pr.head.sha, expected_pr_number: String(pr.number) },
        },
      },
    ],
  );
});

test("apply preserves expected_sha for the previous complete guarded workflow", async () => {
  const pr = pull();
  const fixture = githubFixture({
    pulls: [pr],
    workflowsBySha: {
      [pr.head.sha]: PREVIOUS_GUARDED_CI_WORKFLOW,
    },
  });

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

test("apply omits expected_sha only for a legacy head workflow without that input", async () => {
  const pr = pull();
  const fixture = githubFixture({
    pulls: [pr],
    workflowsBySha: {
      [pr.head.sha]: "name: CI\non:\n  workflow_dispatch:\n",
    },
  });

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
  assert.equal(
    fixture.requests.some(
      (request) =>
        request.method === "GET" &&
        request.path.endsWith(`/contents/.github/workflows/ci.yml?ref=${pr.head.sha}`),
    ),
    true,
  );
});

test("a partial guard contract is skipped without blocking the other candidates", async () => {
  // The safety property is unchanged: a partial contract is ambiguous rather
  // than un-dispatchable, so the exact-SHA guard may not be honoured and THIS
  // head is never dispatched. What changed is blast radius — it used to abort
  // the whole apply, so one un-rebased branch disabled recovery for every other
  // open PR (runs 31393882802 and 31618670601 died exactly here).
  const partial = pull({ number: 1, sha: "e".repeat(40), branch: "fix/partial" });
  const healthy = pull({ number: 2, sha: "f".repeat(40), branch: "fix/healthy" });
  const fixture = githubFixture({
    pulls: [partial, healthy],
    workflowsBySha: {
      [partial.head.sha]: GUARDED_CI_WORKFLOW.replace(`run-name: ${GUARDED_RUN_NAME}\n`, ""),
      [healthy.head.sha]: GUARDED_CI_WORKFLOW,
    },
  });
  const messages = [];

  const result = await runCiRecovery(
    options(fixture.fetchImpl, true, { log: (message) => messages.push(message) }),
  );

  assert.deepEqual(
    result.recoveries.map((recovery) => recovery.number),
    [healthy.number],
  );
  assert.deepEqual(result.skipped, [{ number: partial.number, reason: CONTRACT_PARTIAL }]);
  // The ambiguous head is never dispatched — only the healthy one is.
  assert.deepEqual(
    fixture.requests.filter((request) => request.method === "POST"),
    [
      {
        method: "POST",
        path: `/repos/${REPOSITORY}/actions/workflows/ci.yml/dispatches`,
        body: {
          ref: healthy.head.ref,
          inputs: { expected_sha: healthy.head.sha, expected_pr_number: String(healthy.number) },
        },
      },
    ],
  );
  // A misconfigured contract still has to reach a human.
  assert.equal(result.degraded, true);
  assert.equal(messages.some((message) => message.includes("needs attention")), true);
});

test("an expected_pr_number-only contract is skipped and never dispatched", async () => {
  const pr = pull();
  const expectedPrNumberOnlyWorkflow = [
    "name: CI",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      expected_pr_number:",
    "        required: true",
    "        type: string",
    "jobs:",
    "  build:",
    "    if: ${{ inputs.expected_pr_number }}",
    "",
  ].join("\n");
  const fixture = githubFixture({
    pulls: [pr],
    workflowsBySha: { [pr.head.sha]: expectedPrNumberOnlyWorkflow },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.deepEqual(result.recoveries, []);
  assert.deepEqual(result.skipped, [{ number: pr.number, reason: CONTRACT_PARTIAL }]);
  assert.equal(result.degraded, true);
  assert.equal(fixture.requests.some((request) => request.method === "POST"), false);
});

test("a required job missing the expected SHA failure is skipped, never dispatched", async () => {
  const pr = pull();
  const fixture = githubFixture({
    pulls: [pr],
    workflowsBySha: {
      [pr.head.sha]: GUARDED_CI_WORKFLOW.replace(
        "      - name: Refuse recovery SHA mismatch",
        "      - name: Start validation",
      ),
    },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.deepEqual(result.recoveries, []);
  assert.deepEqual(result.skipped, [{ number: pr.number, reason: CONTRACT_PARTIAL }]);
  assert.equal(result.degraded, true);
  assert.equal(fixture.requests.some((request) => request.method === "POST"), false);
});

test("an un-dispatchable head is skipped without raising the attention flag", async () => {
  // A branch whose ci.yml predates dispatch support is normal, not a
  // misconfiguration: it must not turn the scheduled run red every ten minutes.
  const stale = pull({ number: 4646, sha: "c".repeat(40), branch: "codex/stale-workflow" });
  const fixture = githubFixture({
    pulls: [stale],
    workflowsBySha: { [stale.head.sha]: "name: CI\non:\n  pull_request:\n" },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.deepEqual(result.skipped, [{ number: stale.number, reason: NOT_DISPATCHABLE }]);
  assert.equal(result.degraded, false);
});

test("an un-dispatchable head is skipped without blocking the other candidates", async () => {
  // The head listed FIRST is the un-dispatchable one, because that is the case
  // that used to abort everything: its ci.yml predates workflow_dispatch, so it
  // can never be dispatched by anyone, and throwing for it stranded every other
  // eligible PR in the repository (cave-qibp6).
  const stale = pull({ number: 4646, sha: "c".repeat(40), branch: "codex/stale-workflow" });  const healthy = pull({ number: 4643, sha: "d".repeat(40), branch: "codex/current-workflow" });
  const fixture = githubFixture({
    pulls: [stale, healthy],
    workflowsBySha: {
      [stale.head.sha]: "name: CI\non:\n  pull_request:\n",
      [healthy.head.sha]: GUARDED_CI_WORKFLOW,
    },
  });
  const messages = [];

  const result = await runCiRecovery(
    options(fixture.fetchImpl, true, { log: (message) => messages.push(message) }),
  );

  assert.deepEqual(
    result.recoveries.map((recovery) => recovery.number),
    [healthy.number],
  );
  assert.deepEqual(result.skipped, [
    { number: stale.number, reason: "workflow_not_dispatchable" },
  ]);
  assert.deepEqual(
    fixture.requests.filter((request) => request.method === "POST"),
    [
      {
        method: "POST",
        path: `/repos/${REPOSITORY}/actions/workflows/ci.yml/dispatches`,
        body: {
          ref: healthy.head.ref,
          inputs: { expected_sha: healthy.head.sha, expected_pr_number: String(healthy.number) },
        },
      },
    ],
  );
  // A dropped candidate has to be visible; a silent skip reads as full coverage.
  assert.equal(
    messages.some((message) => message.includes("#4646 skipped workflow_not_dispatchable")),
    true,
  );
  assert.equal(messages.some((message) => message.includes("1 skipped")), true);
});



test("one unreadable pull request does not strand the rest of the scan", async () => {
  // A 404 on a deleted/garbage-collected head, or one flaky 5xx, used to
  // propagate out of the scan loop and end the run. Every other open PR with
  // missing CI then stayed missing — the same "recovery never fired" report,
  // from a different cause.
  const broken = pull({ number: 11, sha: "1".repeat(40), branch: "fix/broken" });
  const healthy = pull({ number: 12, sha: "2".repeat(40), branch: "fix/healthy" });
  const fixture = githubFixture({ pulls: [broken, healthy] });
  const failing = async (url, init) => {
    const parsed = new URL(url);
    if (
      parsed.pathname.endsWith("/actions/workflows/ci.yml/runs") &&
      parsed.searchParams.get("head_sha") === broken.head.sha
    ) {
      return new Response("", { status: 502 });
    }
    return fixture.fetchImpl(url, init);
  };

  const result = await runCiRecovery(options(failing, true));

  assert.deepEqual(
    result.recoveries.map((recovery) => recovery.number),
    [healthy.number],
  );
  assert.deepEqual(result.skipped, [
    {
      number: broken.number,
      reason: "error: failed to list CI runs for a pull request head (HTTP 502)",
    },
  ]);
  assert.equal(result.degraded, true);
});

test("one refused dispatch does not abandon the dispatches queued behind it", async () => {
  const refused = pull({ number: 21, sha: "3".repeat(40), branch: "fix/refused" });
  const healthy = pull({ number: 22, sha: "4".repeat(40), branch: "fix/healthy" });
  const fixture = githubFixture({ pulls: [refused, healthy] });
  const failing = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (body?.ref === refused.head.ref) return new Response("", { status: 403 });
    return fixture.fetchImpl(url, init);
  };

  const result = await runCiRecovery(options(failing, true));

  assert.deepEqual(
    result.recoveries.map((recovery) => recovery.number),
    [healthy.number],
  );
  assert.deepEqual(result.skipped, [
    { number: refused.number, reason: "error: failed to dispatch CI recovery (HTTP 403)" },
  ]);
  assert.equal(result.degraded, true);
});

test("a legacy dispatchable head is still dispatched without inputs", async () => {
  const legacy = pull({ number: 7, sha: "b".repeat(40) });
  const fixture = githubFixture({
    pulls: [legacy],
    workflowsBySha: { [legacy.head.sha]: "name: CI\non:\n  workflow_dispatch:\n" },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.equal(result.recoveries[0].dispatched, true);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(
    fixture.requests.filter((request) => request.method === "POST")[0].body,
    { ref: legacy.head.ref },
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
    if (parsed.pathname.endsWith(`/pulls/${first.number}`)) return jsonResponse(first);
    if (parsed.pathname.endsWith(`/pulls/${second.number}`)) return jsonResponse(second);
    if (parsed.pathname.endsWith("/contents/.github/workflows/ci.yml")) {
      return jsonResponse({
        encoding: "base64",
        content: Buffer.from(GUARDED_CI_WORKFLOW).toString("base64"),
      });
    }
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/dispatches")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${parsed.pathname}`);
  };

  const result = await runCiRecovery(options(fetchImpl, true));

  // The ordering invariant is unchanged: no mutation is issued until every
  // candidate read has finished. What changed is that a failed read now costs
  // that ONE candidate instead of the whole scan.
  const firstPost = requests.findIndex((request) => request.method === "POST");
  const lastRead = requests.findLastIndex((request) => request.method === "GET");
  assert.notEqual(firstPost, -1);
  assert.equal(firstPost > lastRead, true);
  assert.deepEqual(
    result.recoveries.map((recovery) => recovery.number),
    [first.number],
  );
  assert.deepEqual(result.skipped, [
    {
      number: second.number,
      reason: "error: failed to list CI runs for a pull request head (HTTP 503)",
    },
  ]);
});

test("apply inspects every exact-head workflow contract before dispatching any recovery", async () => {
  const first = pull({ number: 1, sha: "1".repeat(40), branch: "fix/first" });
  const second = pull({ number: 2, sha: "2".repeat(40), branch: "fix/second" });
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({ method: init.method ?? "GET", path: parsed.pathname });
    if (parsed.pathname.endsWith("/pulls")) return jsonResponse([first, second]);
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/runs")) {
      return jsonResponse({ workflow_runs: [] });
    }
    if (parsed.pathname.endsWith(`/pulls/${first.number}`)) return jsonResponse(first);
    if (parsed.pathname.endsWith(`/pulls/${second.number}`)) return jsonResponse(second);
    if (parsed.pathname.endsWith("/contents/.github/workflows/ci.yml")) {
      if (parsed.searchParams.get("ref") === first.head.sha) {
        return jsonResponse({
          encoding: "base64",
          content: Buffer.from(GUARDED_CI_WORKFLOW).toString("base64"),
        });
      }
      return jsonResponse({ message: "service unavailable" }, 503);
    }
    if (parsed.pathname.endsWith("/actions/workflows/ci.yml/dispatches")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${parsed.pathname}`);
  };

  const result = await runCiRecovery(options(fetchImpl, true));

  const firstPost = requests.findIndex((request) => request.method === "POST");
  const lastRead = requests.findLastIndex((request) => request.method === "GET");
  assert.notEqual(firstPost, -1);
  assert.equal(firstPost > lastRead, true);
  assert.deepEqual(
    result.recoveries.map((recovery) => recovery.number),
    [first.number],
  );
  assert.deepEqual(result.skipped, [
    {
      number: second.number,
      reason: "error: failed to inspect the CI workflow contract (HTTP 503)",
    },
  ]);
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

test("a completed dispatch for a different expected SHA does not cover the current head", async () => {
  const current = pull({ sha: "b".repeat(40) });
  const mismatched = workflowRun({
    event: "workflow_dispatch",
    headSha: current.head.sha,
    displayTitle: `CI workflow_dispatch ${"a".repeat(40)}`,
  });
  const fixture = githubFixture({
    pulls: [current],
    runsBySha: { [current.head.sha]: [mismatched] },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, true));

  assert.deepEqual(result.recoveries, [
    {
      number: current.number,
      reason: "missing_ci_run",
      ref: current.head.ref,
      sha: current.head.sha,
      url: current.html_url,
      dispatched: true,
    },
  ]);
  assert.deepEqual(
    fixture.requests.filter((request) => request.method === "POST"),
    [
      {
        method: "POST",
        path: `/repos/${REPOSITORY}/actions/workflows/ci.yml/dispatches`,
        body: {
          ref: current.head.ref,
          inputs: { expected_sha: current.head.sha, expected_pr_number: String(current.number) },
        },
      },
    ],
  );
});

test("a dispatch with a malformed stamped expected SHA does not cover the current head", async () => {
  const current = pull({ sha: "b".repeat(40) });
  const malformed = workflowRun({
    event: "workflow_dispatch",
    headSha: current.head.sha,
    displayTitle: "CI workflow_dispatch deadbeef",
  });
  const fixture = githubFixture({
    pulls: [current],
    runsBySha: { [current.head.sha]: [malformed] },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, false));

  assert.equal(result.recoveries[0].reason, "missing_ci_run");
});

test("an unstamped legacy dispatch remains valid CI coverage", async () => {
  const current = pull();
  const legacy = workflowRun({
    event: "workflow_dispatch",
    headSha: current.head.sha,
    displayTitle: "Legacy recovery run",
  });
  const fixture = githubFixture({
    pulls: [current],
    runsBySha: { [current.head.sha]: [legacy] },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, false));

  assert.deepEqual(result.recoveries, []);
  assert.equal(result.skipped[0].reason, "recovery_cooldown");
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

test("an approval-gated run is not CI coverage and is recovered", async () => {
  // GitHub parks a first-time-contributor run behind manual approval: the run
  // reports status=completed with conclusion=action_required and ZERO jobs, so
  // the PR shows no checks at all. Reading only `status` mistook that for
  // finished CI and wedged Copilot-authored PRs indefinitely (cave-qshvl).
  const pr = pull();
  const gated = workflowRun({
    id: 9100,
    status: "completed",
    conclusion: "action_required",
    headSha: pr.head.sha,
  });
  const fixture = githubFixture({ pulls: [pr], runsBySha: { [pr.head.sha]: [gated] } });

  const result = await runCiRecovery(options(fixture.fetchImpl, false));

  assert.equal(result.recoveries.length, 1, "an approval-gated head must be recoverable");
  assert.equal(result.recoveries[0].reason, "approval_gated_run");
});

test("a completed run that actually ran is still coverage, including a failure", async () => {
  // The fix must not turn every completed run into a recovery candidate. A
  // FAILED run reported a verdict, so CI covered this head and re-dispatching
  // would just re-run a known failure.
  //
  // `cancelled` is deliberately NOT in this list — see the two tests below. It
  // was here originally (cave-qshvl) on the reasoning that a newer push
  // supersedes it, which is true only when a newer run actually exists.
  for (const conclusion of ["success", "failure", "timed_out"]) {
    const pr = pull();
    const ran = workflowRun({ id: 9200, status: "completed", conclusion, headSha: pr.head.sha });
    const fixture = githubFixture({ pulls: [pr], runsBySha: { [pr.head.sha]: [ran] } });

    const result = await runCiRecovery(options(fixture.fetchImpl, false));

    assert.deepEqual(
      result.recoveries,
      [],
      `conclusion=${conclusion} is coverage and must not be recovered`,
    );
  }
});

test("a cancelled run that is the NEWEST for a static head is recovered", async () => {
  // The wedge cave-geaji fixes. Nothing is coming to replace this run: the head
  // has not moved, so the required context reports `cancelled` rather than
  // `success` forever and the PR has no path to green.
  //
  // Live case: #4514 head 02f74118ff carried exactly one run, cancelled, and
  // `pnpm ci:recovery` reported "0 eligible" while the PR sat blocked.
  const pr = pull();
  const cancelled = workflowRun({
    id: 9300,
    status: "completed",
    conclusion: "cancelled",
    headSha: pr.head.sha,
  });
  const fixture = githubFixture({ pulls: [pr], runsBySha: { [pr.head.sha]: [cancelled] } });

  const result = await runCiRecovery(options(fixture.fetchImpl, false));

  assert.equal(result.recoveries.length, 1, "a cancelled newest run must be recoverable");
  assert.equal(result.recoveries[0].reason, "cancelled_latest_run");
});

test("a head still cancelled after a recovery dispatch is not recovered again", async () => {
  // The loop cave-f22tp fixes. Recovery already ran on this head and the head
  // is STILL sitting on a cancellation, so dispatching repeats whatever did not
  // work. The cooldown does not save us: it bounds the rate, not the repetition,
  // so a head that keeps ending up cancelled draws one dispatch per cooldown
  // forever.
  //
  // Live case: #4618 head 11aceeb89 collected three cancelled runs and no
  // verdict — each dispatch cancelled the run it was rescuing (shared
  // concurrency group), and each cancellation then read as the wedge above.
  const pr = pull();
  const dispatched = workflowRun({
    id: 9401,
    status: "completed",
    conclusion: "cancelled",
    headSha: pr.head.sha,
    event: "workflow_dispatch",
    createdAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
  });
  const cancelled = workflowRun({
    id: 9402,
    status: "completed",
    conclusion: "cancelled",
    headSha: pr.head.sha,
  });
  const fixture = githubFixture({
    pulls: [pr],
    runsBySha: { [pr.head.sha]: [cancelled, dispatched] },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, false));

  assert.equal(result.recoveries.length, 0, "a second recovery on the same head must not fire");
  assert.equal(result.skipped[0].reason, "recovery_already_attempted");
});

test("a cancelled run underneath a NEWER run is left alone", async () => {
  // The case the original reasoning describes and gets right: something newer
  // is already running for this head, so the cancellation was a supersession
  // and dispatching again would fight it.
  const pr = pull();
  const cancelled = workflowRun({
    id: 9400,
    status: "completed",
    conclusion: "cancelled",
    headSha: pr.head.sha,
    // Both NOW-relative and outside the grace window, so this exercises the
    // supersession rule rather than incidentally landing in `ci_queued`.
    createdAt: new Date(NOW - RECOVERY_GRACE_MS - 2_000).toISOString(),
  });
  const newer = workflowRun({
    id: 9401,
    status: "in_progress",
    conclusion: null,
    headSha: pr.head.sha,
    createdAt: new Date(NOW - RECOVERY_GRACE_MS - 1_000).toISOString(),
  });
  const fixture = githubFixture({
    pulls: [pr],
    runsBySha: { [pr.head.sha]: [cancelled, newer] },
  });

  const result = await runCiRecovery(options(fixture.fetchImpl, false));

  assert.deepEqual(
    result.recoveries,
    [],
    "a superseded cancellation must not trigger a redundant dispatch",
  );
});

test("one real run alongside an approval-gated one still counts as coverage", async () => {
  // Only when EVERY run is gated is the head genuinely uncovered. A gated run
  // sitting beside a real one must not trigger a redundant dispatch.
  const pr = pull();
  const gated = workflowRun({ id: 9300, status: "completed", conclusion: "action_required", headSha: pr.head.sha });
  const real = workflowRun({ id: 9301, status: "completed", conclusion: "success", headSha: pr.head.sha });
  const fixture = githubFixture({ pulls: [pr], runsBySha: { [pr.head.sha]: [gated, real] } });

  const result = await runCiRecovery(options(fixture.fetchImpl, false));

  assert.deepEqual(result.recoveries, []);
});
