import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  RECOVERY_GRACE_MS,
  RECOVERY_COOLDOWN_MS,
  runCiRecovery,
} from "./ci-recovery.mjs";

const NOW = Date.parse("2026-10-12T02:00:00Z");
const REPO = "OpenCoven/coven-cave";
const SHA = "a".repeat(40),
  BASE = "b".repeat(40),
  MERGE = "c".repeat(40);
const OLD = new Date(NOW - RECOVERY_COOLDOWN_MS - 1).toISOString();
const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers });
function pull(number = 42, overrides = {}) {
  return {
    number,
    state: "open",
    draft: false,
    created_at: OLD,
    updated_at: OLD,
    html_url: `https://github.com/${REPO}/pull/${number}`,
    head: { ref: `fix/unit-${number}`, sha: SHA, repo: { full_name: REPO } },
    base: { ref: "main", sha: BASE, repo: { full_name: REPO } },
    mergeable: true,
    merge_commit_sha: MERGE,
    ...overrides,
  };
}
function run(overrides = {}) {
  return {
    id: 9001,
    status: "completed",
    conclusion: "cancelled",
    event: "pull_request",
    created_at: OLD,
    updated_at: OLD,
    head_sha: SHA,
    run_attempt: 1,
    path: ".github/workflows/ci.yml",
    display_title: `CI pull_request ${SHA}`,
    pull_requests: [
      { number: 42, head: { sha: SHA }, base: { ref: "main", sha: BASE } },
    ],
    ...overrides,
  };
}
function fixture({
  pulls = [pull()],
  runs = [run()],
  source = workflow,
  override,
} = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const req = {
      path: u.pathname + u.search,
      method: init.method ?? "GET",
      body: init.body && JSON.parse(init.body),
    };
    requests.push(req);
    const intercepted = await override?.(req, requests);
    if (intercepted) return intercepted;
    if (u.pathname.endsWith("/pulls")) return json(pulls);
    if (/\/pulls\/\d+$/.test(u.pathname))
      return json(
        pulls.find((p) => String(p.number) === u.pathname.split("/").at(-1)),
      );
    if (u.pathname.endsWith("/actions/workflows/ci.yml/runs"))
      return json({ total_count: runs.length, workflow_runs: runs });
    if (/\/actions\/runs\/\d+$/.test(u.pathname))
      return json(
        runs.find((r) => String(r.id) === u.pathname.split("/").at(-1)),
      );
    if (u.pathname.endsWith("/git/ref/heads/main"))
      return json({
        ref: "refs/heads/main",
        object: { type: "commit", sha: BASE },
      });
    if (u.pathname.endsWith("/git/ref/pull/42/merge"))
      return json({
        ref: "refs/pull/42/merge",
        object: { type: "commit", sha: MERGE },
      });
    if (u.pathname.endsWith(`/git/commits/${MERGE}`))
      return json({ sha: MERGE, parents: [{ sha: BASE }, { sha: SHA }] });
    if (u.pathname.endsWith("/contents/.github/workflows/ci.yml"))
      return json({
        encoding: "base64",
        content: Buffer.from(source).toString("base64"),
      });
    if (/\/actions\/runs\/\d+\/rerun$/.test(u.pathname))
      return new Response(null, { status: 201 });
    throw new Error(`unexpected request ${req.method} ${req.path}`);
  };
  return { requests, fetchImpl };
}
function options(f, apply = false) {
  return {
    apply,
    now: NOW,
    env: {
      GITHUB_REPOSITORY: REPO,
      GITHUB_TOKEN: "synthetic",
      GITHUB_API_URL: "https://api.github.test",
    },
    fetchImpl: f.fetchImpl,
    log() {},
  };
}
const mutations = (f) => f.requests.filter((r) => r.method !== "GET");

for (const event of [
  "workflow_dispatch",
  "repository_dispatch",
  "schedule",
  "push",
]) {
  test(`${event} success is not this PR's eligible run`, async () => {
    const f = fixture({ runs: [run({ event, conclusion: "success" })] });
    const result = await runCiRecovery(options(f, true));
    assert.equal(result.skipped[0].reason, "missing_eligible_pr_run");
    assert.deepEqual(result.attention, [42]);
    assert.deepEqual(mutations(f), []);
  });
}
test("report mode proposes a whole eligible run without mutating", async () => {
  const f = fixture();
  const result = await runCiRecovery(options(f));
  assert.equal(result.recoveries[0].runId, 9001);
  assert.equal(result.recoveries[0].rerunRequested, false);
  assert.deepEqual(mutations(f), []);
});
test("apply reruns the entire PR run and never dispatches, approves, or edits the PR", async () => {
  const f = fixture();
  const result = await runCiRecovery(options(f, true));
  assert.equal(result.recoveries[0].rerunRequested, true);
  assert.equal(result.recoveries[0].sha, SHA);
  assert.deepEqual(
    mutations(f).map(({ path, method }) => ({ path, method })),
    [{ path: `/repos/${REPO}/actions/runs/9001/rerun`, method: "POST" }],
  );
});
test("an ineligible newer run cannot hide a cancelled eligible PR run", async () => {
  const f = fixture({
    runs: [
      run({
        id: 9002,
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: new Date(NOW - 1000).toISOString(),
      }),
      run(),
    ],
  });
  const result = await runCiRecovery(options(f));
  assert.equal(result.recoveries[0].runId, 9001);
});
for (const [name, changes, reason] of [
  ["already rerun", { run_attempt: 2 }, "recovery_already_attempted"],
  [
    "recent cancellation",
    { updated_at: new Date(NOW - 1000).toISOString() },
    "recovery_cooldown",
  ],
  ["approval", { conclusion: "action_required" }, "approval_required"],
  ["startup", { conclusion: "startup_failure" }, "startup_failure"],
  ["unknown verdict", { conclusion: null }, "unknown_run_conclusion"],
  ["running", { status: "in_progress", conclusion: null }, "ci_in_progress"],
  ["queued", { status: "queued", conclusion: null }, "ci_waiting"],
  ["pending", { status: "pending", conclusion: null }, "ci_waiting"],
  ["success", { conclusion: "success" }, "ci_present"],
  ["test failure", { conclusion: "failure" }, "ci_present"],
])
  test(`${name} is not blindly retried`, async () => {
    const f = fixture({ runs: [run(changes)] });
    const result = await runCiRecovery(options(f, true));
    assert.equal(result.skipped[0].reason, reason);
    assert.deepEqual(mutations(f), []);
  });
test("an old queued run names the stalled-run action", async () => {
  const f = fixture({ runs: [run({ status: "queued", conclusion: null })] });
  const result = await runCiRecovery(options(f));
  assert.deepEqual(result.attention, [42]);
  assert.match(result.skipped[0].nextStep, /queue|runner|concurrency/i);
});
for (const [label, change] of [
  ["draft", { draft: true }],
  ["closed", { state: "closed" }],
  [
    "young",
    { updated_at: new Date(NOW - RECOVERY_GRACE_MS + 1).toISOString() },
  ],
  [
    "fork",
    { head: { ref: "feature", sha: SHA, repo: { full_name: "other/fork" } } },
  ],
])
  test(`${label} PR is untouched`, async () => {
    const f = fixture({ pulls: [pull(42, change)] });
    const r = await runCiRecovery(options(f, true));
    assert.equal(r.recoveries.length, 0);
    assert.deepEqual(mutations(f), []);
  });
for (const [label, changes] of [
  ["another head", { head_sha: "d".repeat(40) }],
  [
    "another PR",
    {
      pull_requests: [
        { number: 43, head: { sha: SHA }, base: { ref: "main", sha: BASE } },
      ],
    },
  ],
  ["unbound", { pull_requests: [] }],
])
  test(`${label} run cannot cover or recover this PR`, async () => {
    const f = fixture({ runs: [run(changes)] });
    const r = await runCiRecovery(options(f, true));
    assert.equal(r.skipped[0].reason, "missing_eligible_pr_run");
    assert.deepEqual(mutations(f), []);
  });
test("a newer successful eligible run supersedes the cancellation", async () => {
  const f = fixture({
    runs: [
      run(),
      run({
        id: 9002,
        created_at: new Date(NOW - 1000).toISOString(),
        conclusion: "success",
      }),
    ],
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.skipped[0].reason, "ci_present");
  assert.deepEqual(mutations(f), []);
});
for (const [label, override, reason] of [
  [
    "head changes",
    (q) =>
      /\/pulls\/42$/.test(q.path)
        ? json(
            pull(42, {
              head: {
                ref: "fix/unit-42",
                sha: "d".repeat(40),
                repo: { full_name: REPO },
              },
            }),
          )
        : null,
    "head_changed",
  ],
  [
    "draft changes",
    (q) =>
      /\/pulls\/42$/.test(q.path) ? json(pull(42, { draft: true })) : null,
    "draft",
  ],
  [
    "base moves",
    (q) =>
      q.path.endsWith("/git/ref/heads/main")
        ? json({
            ref: "refs/heads/main",
            object: { type: "commit", sha: "d".repeat(40) },
          })
        : null,
    "base_changed",
  ],
  [
    "stale merge parents",
    (q) =>
      q.path.endsWith(`/git/commits/${MERGE}`)
        ? json({ sha: MERGE, parents: [{ sha: "d".repeat(40) }, { sha: SHA }] })
        : null,
    "merge_snapshot_stale",
  ],
  [
    "merge ref drifts",
    (q) =>
      q.path.endsWith("/git/ref/pull/42/merge")
        ? json({
            ref: "refs/pull/42/merge",
            object: { type: "commit", sha: "d".repeat(40) },
          })
        : null,
    "merge_snapshot_stale",
  ],
  [
    "run is already rerunning",
    (q) =>
      q.path.endsWith("/actions/runs/9001")
        ? json(run({ status: "queued", run_attempt: 2 }))
        : null,
    "run_changed",
  ],
])
  test(`${label} stops the rerun`, async () => {
    const f = fixture({ override });
    const r = await runCiRecovery(options(f, true));
    assert.equal(r.skipped[0].reason, reason);
    assert.deepEqual(mutations(f), []);
  });
test("a fresh base after a stale pull base field is checked against the live ref", async () => {
  const f = fixture({
    pulls: [
      pull(42, {
        base: { ref: "main", sha: "d".repeat(40), repo: { full_name: REPO } },
      }),
    ],
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.recoveries[0].rerunRequested, true);
});
for (const source of [
  "name: CI\non: workflow_dispatch\n",
  workflow.replaceAll(
    "node scripts/check-merge-tree-freshness.mjs",
    "echo ignored",
  ),
  workflow.replaceAll(
    "HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    "HEAD_SHA: stale",
  ),
]) {
  test("missing PR trigger or freshness guard refuses automation", async () => {
    const f = fixture({ source });
    const r = await runCiRecovery(options(f, true));
    assert.equal(r.skipped[0].reason, "workflow_contract_partial");
    assert.deepEqual(mutations(f), []);
  });
}
test("head is revalidated after slow workflow and merge reads", async () => {
  let reads = 0;
  const f = fixture({
    override: (q) =>
      /\/pulls\/42$/.test(q.path) && ++reads > 1
        ? json(pull(42, { state: "closed" }))
        : null,
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.skipped[0].reason, "pull_closed");
  assert.deepEqual(mutations(f), []);
});
test("another eligible run arriving during preflight prevents a rerun", async () => {
  let lists = 0;
  const f = fixture({
    override: (q) =>
      q.path.includes("/actions/workflows/ci.yml/runs") && ++lists > 1
        ? json({
            total_count: 2,
            workflow_runs: [
              run(),
              run({
                id: 9002,
                created_at: new Date(NOW - 1000).toISOString(),
                status: "in_progress",
                conclusion: null,
              }),
            ],
          })
        : null,
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.skipped[0].reason, "run_changed");
  assert.deepEqual(mutations(f), []);
});
test("API refusal fails closed and identifies the affected PR", async () => {
  const f = fixture({
    override: (q) =>
      q.path.endsWith("/rerun") ? json({ message: "denied" }, 403) : null,
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.degraded, true);
  assert.deepEqual(r.faults, [42]);
  assert.equal(r.recoveries.length, 0);
});
test("one unreadable candidate does not abandon disjoint candidates", async () => {
  const other = run({
    id: 9000,
    pull_requests: [
      { number: 41, head: { sha: SHA }, base: { ref: "main", sha: BASE } },
    ],
  });
  const f = fixture({
    pulls: [pull(41), pull()],
    runs: [other, run()],
    override: (q) => (q.path.endsWith("/pulls/41") ? json({}, 503) : null),
  });
  const r = await runCiRecovery(options(f, true));
  assert.deepEqual(r.faults, [41]);
  assert.ok(r.recoveries.some((x) => x.number === 42));
});

test("a swallowed freshness failure cannot authorize recovery", async () => {
  const source = workflow.replaceAll(
    'node scripts/check-merge-tree-freshness.mjs --pr "$PR_NUMBER" --head "$HEAD_SHA"',
    'node scripts/check-merge-tree-freshness.mjs --pr "$PR_NUMBER" --head "$HEAD_SHA" || true',
  );
  const f = fixture({ source });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.skipped[0].reason, "workflow_contract_partial");
  assert.deepEqual(mutations(f), []);
});
test("missing attempt freshness enforcement cannot authorize recovery", async () => {
  const f = fixture({
    source: workflow.replaceAll(
      '--run-attempt "$RUN_ATTEMPT"',
      '--run-attempt "1"',
    ),
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.skipped[0].reason, "workflow_contract_partial");
  assert.deepEqual(mutations(f), []);
});
test("base drift at the final read prevents mutation", async () => {
  let reads = 0;
  const f = fixture({
    override: (q) =>
      q.path.endsWith("/git/ref/heads/main") && ++reads > 1
        ? json({
            ref: "refs/heads/main",
            object: { type: "commit", sha: "d".repeat(40) },
          })
        : null,
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.skipped[0].reason, "base_changed");
  assert.deepEqual(mutations(f), []);
});
test("a newer eligible run on a later page supersedes cancellation", async () => {
  const f = fixture({
    override: (q) =>
      q.path.includes("/runs?")
        ? q.path.includes("page=2")
          ? json({
              total_count: 2,
              workflow_runs: [
                run({
                  id: 9002,
                  conclusion: "success",
                  created_at: new Date(NOW - 1000).toISOString(),
                }),
              ],
            })
          : json({ total_count: 2, workflow_runs: [run()] }, 200, {
              link: `<https://api.github.test/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=100&page=2>; rel="next"`,
            })
        : null,
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.skipped[0].reason, "ci_present");
  assert.deepEqual(mutations(f), []);
});
test("PR pagination cannot forward credentials to another host", async () => {
  const f = fixture({
    override: (q) =>
      q.path.includes("/pulls?")
        ? json([], 200, {
            link: '<https://evil.test/repos/OpenCoven/coven-cave/pulls?page=2>; rel="next"',
          })
        : null,
  });
  await assert.rejects(runCiRecovery(options(f, true)), /pagination/);
  assert.equal(f.requests.length, 1);
});
test("run pagination cannot forward credentials outside the workflow endpoint", async () => {
  const f = fixture({
    override: (q) =>
      q.path.includes("/runs?")
        ? json({ total_count: 101, workflow_runs: [run()] }, 200, {
            link: '<https://evil.test/runs?page=2>; rel="next"',
          })
        : null,
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.degraded, true);
  assert.deepEqual(mutations(f), []);
});
test("truncated run inventory never implies no other run exists", async () => {
  const f = fixture({
    override: (q) =>
      q.path.includes("/runs?")
        ? json({ total_count: 101, workflow_runs: [run()] })
        : null,
  });
  const r = await runCiRecovery(options(f, true));
  assert.equal(r.degraded, true);
  assert.deepEqual(mutations(f), []);
});
for (const invalid of [
  { run_attempt: undefined },
  { updated_at: "invalid" },
  { pull_requests: null },
  { head_sha: "invalid" },
])
  test("malformed run evidence fails closed", async () => {
    const f = fixture({ runs: [run(invalid)] });
    const r = await runCiRecovery(options(f, true));
    assert.equal(r.degraded, true);
    assert.deepEqual(mutations(f), []);
  });
